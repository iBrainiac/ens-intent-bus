// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title IntentEscrow
/// @notice Users publish trade intents via ENS text records and deposit funds here.
///         Off-chain agents monitor, verify the ENS record, and execute swaps via Uniswap.
contract IntentEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant AGENT_FEE_BPS = 30; // 0.3%

    enum IntentStatus {
        Pending,
        Executed,
        Cancelled
    }

    struct Intent {
        address user;
        bytes32 ensNode;     // namehash of the user's ENS name — agent verifies text record matches
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint64 expiry;
        IntentStatus status;
    }

    mapping(uint256 => Intent) public intents;
    uint256 public nextIntentId;

    address public immutable UNISWAP_ROUTER;

    event IntentCreated(
        uint256 indexed intentId,
        address indexed user,
        bytes32 ensNode,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint64 expiry
    );
    event IntentExecuted(uint256 indexed intentId, address indexed agent, uint256 amountOut, uint256 agentFee);
    event IntentCancelled(uint256 indexed intentId);

    error IntentNotPending();
    error IntentExpired();
    error NotIntentOwner();
    error InsufficientOutput();
    error SwapFailed();

    constructor(address _uniswapRouter) {
        UNISWAP_ROUTER = _uniswapRouter;
    }

    /// @notice Deposit tokens and create an intent. Also set your ENS text record:
    ///         key = "uni-ens.intent", value = intentId (as string)
    function deposit(
        bytes32 ensNode,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint64 expiry
    ) external nonReentrant returns (uint256 intentId) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        intentId = nextIntentId++;
        intents[intentId] = Intent({
            user: msg.sender,
            ensNode: ensNode,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            expiry: expiry,
            status: IntentStatus.Pending
        });

        emit IntentCreated(intentId, msg.sender, ensNode, tokenIn, tokenOut, amountIn, minAmountOut, expiry);
    }

    /// @notice Called by an agent after verifying the ENS text record matches this intentId.
    ///         swapData is calldata for the Uniswap router, constructed off-chain via Uniswap API.
    function execute(uint256 intentId, bytes calldata swapData) external nonReentrant {
        Intent storage intent = intents[intentId];

        if (intent.status != IntentStatus.Pending) revert IntentNotPending();
        if (block.timestamp > intent.expiry) revert IntentExpired();

        // CEI: flip state before external calls
        intent.status = IntentStatus.Executed;

        uint256 balanceBefore = IERC20(intent.tokenOut).balanceOf(address(this));

        IERC20(intent.tokenIn).forceApprove(UNISWAP_ROUTER, intent.amountIn);
        (bool success,) = UNISWAP_ROUTER.call(swapData);
        if (!success) revert SwapFailed();

        // Clear approval in case router didn't consume full amount
        IERC20(intent.tokenIn).forceApprove(UNISWAP_ROUTER, 0);

        uint256 amountOut = IERC20(intent.tokenOut).balanceOf(address(this)) - balanceBefore;
        if (amountOut < intent.minAmountOut) revert InsufficientOutput();

        uint256 agentFee = (amountOut * AGENT_FEE_BPS) / 10_000;

        IERC20(intent.tokenOut).safeTransfer(msg.sender, agentFee);
        IERC20(intent.tokenOut).safeTransfer(intent.user, amountOut - agentFee);

        emit IntentExecuted(intentId, msg.sender, amountOut, agentFee);
    }

    /// @notice User cancels their intent and retrieves deposited tokens.
    ///         Can only cancel before expiry or after expiry (no time restriction — user is always in control).
    function cancel(uint256 intentId) external nonReentrant {
        Intent storage intent = intents[intentId];

        if (intent.status != IntentStatus.Pending) revert IntentNotPending();
        if (msg.sender != intent.user) revert NotIntentOwner();

        intent.status = IntentStatus.Cancelled;
        IERC20(intent.tokenIn).safeTransfer(intent.user, intent.amountIn);

        emit IntentCancelled(intentId);
    }

    function getIntent(uint256 intentId) external view returns (Intent memory) {
        return intents[intentId];
    }
}
