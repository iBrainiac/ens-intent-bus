// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IntentEscrow} from "../src/IntentEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork tests against Base Mainnet.
///         Run with: forge test --match-contract IntentEscrowForkTest -vv --fork-url $BASE_RPC_URL
contract IntentEscrowForkTest is Test {
    // Base Mainnet — Universal Router v4
    address constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;

    // Base Mainnet tokens
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint24  constant WETH_USDC_FEE = 500; // 0.05% pool — deepest WETH/USDC liquidity on Base

    // Universal Router special recipient: resolves to msg.sender of execute() = our escrow
    address constant MSG_SENDER = 0x0000000000000000000000000000000000000001;

    // Universal Router command byte for V3_SWAP_EXACT_IN
    bytes1 constant CMD_V3_SWAP_EXACT_IN = 0x00;

    IntentEscrow escrow;

    address user  = makeAddr("user");
    address agent = makeAddr("agent");
    bytes32 ensNode = keccak256(abi.encodePacked("alice.eth"));

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));
        escrow = new IntentEscrow(UNIVERSAL_ROUTER);
    }

    // ─────────────────────────────────────────────────────────────────
    // Happy path: full deposit → execute → user gets USDC, agent gets fee
    // ─────────────────────────────────────────────────────────────────

    function test_executeSwapWethToUsdc() public {
        uint256 amountIn     = 0.01 ether;  // 0.01 WETH
        uint256 minAmountOut = 10e6;         // expect at least 10 USDC (~$10)
        uint64  expiry       = uint64(block.timestamp + 1 hours);

        deal(WETH, user, amountIn);

        // User deposits WETH
        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), amountIn);
        uint256 intentId = escrow.deposit(ensNode, WETH, USDC, amountIn, minAmountOut, expiry);
        vm.stopPrank();

        assertEq(IERC20(WETH).balanceOf(address(escrow)), amountIn, "escrow should hold WETH");

        bytes memory routerCalldata = _buildV3SwapCalldata(amountIn, minAmountOut);

        uint256 userUsdcBefore  = IERC20(USDC).balanceOf(user);
        uint256 agentUsdcBefore = IERC20(USDC).balanceOf(agent);

        vm.prank(agent);
        escrow.execute(intentId, routerCalldata);

        uint256 userGained  = IERC20(USDC).balanceOf(user)  - userUsdcBefore;
        uint256 agentGained = IERC20(USDC).balanceOf(agent) - agentUsdcBefore;
        uint256 totalOut    = userGained + agentGained;

        console2.log("WETH in        :", amountIn);
        console2.log("USDC total out :", totalOut);
        console2.log("User received  :", userGained);
        console2.log("Agent fee      :", agentGained);

        assertGt(userGained,  0, "user received no USDC");
        assertGt(agentGained, 0, "agent received no fee");
        assertGe(totalOut, minAmountOut, "output below minAmountOut");

        // Fee is exactly AGENT_FEE_BPS of total output (±1 wei rounding)
        uint256 expectedFee = (totalOut * escrow.AGENT_FEE_BPS()) / 10_000;
        assertApproxEqAbs(agentGained, expectedFee, 1, "fee split incorrect");

        // WETH fully consumed
        assertEq(IERC20(WETH).balanceOf(address(escrow)), 0, "WETH not fully consumed");

        // Intent state
        assertEq(
            uint8(escrow.getIntent(intentId).status),
            uint8(IntentEscrow.IntentStatus.Executed),
            "intent not marked Executed"
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // Slippage guard: execute reverts when output < minAmountOut
    // ─────────────────────────────────────────────────────────────────

    function test_executeRevertsWhenSlippageExceeded() public {
        uint256 amountIn     = 0.01 ether;
        uint256 minAmountOut = 999_999e6; // absurdly high — will never be met
        uint64  expiry       = uint64(block.timestamp + 1 hours);

        deal(WETH, user, amountIn);

        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), amountIn);
        uint256 intentId = escrow.deposit(ensNode, WETH, USDC, amountIn, minAmountOut, expiry);
        vm.stopPrank();

        // Router swap will succeed but output won't meet minAmountOut
        // The swap itself reverts due to amountOutMinimum in the router calldata
        bytes memory routerCalldata = _buildV3SwapCalldata(amountIn, minAmountOut);

        vm.prank(agent);
        vm.expectRevert();
        escrow.execute(intentId, routerCalldata);

        // Intent must still be Pending so user can cancel and recover funds
        assertEq(
            uint8(escrow.getIntent(intentId).status),
            uint8(IntentEscrow.IntentStatus.Pending),
            "intent should still be Pending after revert"
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // Double execution: second execute() reverts
    // ─────────────────────────────────────────────────────────────────

    function test_cannotExecuteTwice() public {
        uint256 amountIn     = 0.01 ether;
        uint256 minAmountOut = 10e6;
        uint64  expiry       = uint64(block.timestamp + 1 hours);

        deal(WETH, user, amountIn);

        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), amountIn);
        uint256 intentId = escrow.deposit(ensNode, WETH, USDC, amountIn, minAmountOut, expiry);
        vm.stopPrank();

        bytes memory routerCalldata = _buildV3SwapCalldata(amountIn, minAmountOut);

        vm.prank(agent);
        escrow.execute(intentId, routerCalldata);

        vm.prank(agent);
        vm.expectRevert(IntentEscrow.IntentNotPending.selector);
        escrow.execute(intentId, routerCalldata);
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal: build Universal Router V3_SWAP_EXACT_IN calldata
    //
    // Uses payerIsUser: false — the escrow pre-transfers tokens to the
    // router in execute(), so the router swaps from its own balance.
    // MSG_SENDER as recipient sends USDC back to the escrow (the caller).
    // ─────────────────────────────────────────────────────────────────

    function _buildV3SwapCalldata(
        uint256 amountIn,
        uint256 amountOutMin
    ) internal view returns (bytes memory) {
        bytes memory path = abi.encodePacked(WETH, WETH_USDC_FEE, USDC);

        bytes memory swapInput = abi.encode(
            MSG_SENDER,  // recipient: resolves to escrow (the caller of execute())
            amountIn,
            amountOutMin,
            path,
            false        // payerIsUser: false — tokens already in router balance
        );

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = swapInput;

        return abi.encodeWithSignature(
            "execute(bytes,bytes[],uint256)",
            abi.encodePacked(CMD_V3_SWAP_EXACT_IN),
            inputs,
            block.timestamp + 300
        );
    }
}
