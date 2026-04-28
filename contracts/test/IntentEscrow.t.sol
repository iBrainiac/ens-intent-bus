// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntentEscrow} from "../src/IntentEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract IntentEscrowTest is Test {
    IntentEscrow public escrow;

    // Mainnet addresses
    address constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    address user = makeAddr("user");
    address agent = makeAddr("agent");
    bytes32 ensNode = keccak256("alice.eth");

    uint64 expiry;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MAINNET_RPC_URL", string("https://eth.llamarpc.com")));
        escrow = new IntentEscrow(UNIVERSAL_ROUTER);
        expiry = uint64(block.timestamp + 1 hours);

        deal(WETH, user, 10 ether);
    }

    function test_depositCreatesIntent() public {
        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), 1 ether);

        uint256 intentId = escrow.deposit(ensNode, WETH, USDC, 1 ether, 100e6, expiry);
        vm.stopPrank();

        IntentEscrow.Intent memory intent = escrow.getIntent(intentId);

        assertEq(intent.user, user);
        assertEq(intent.ensNode, ensNode);
        assertEq(intent.tokenIn, WETH);
        assertEq(intent.tokenOut, USDC);
        assertEq(intent.amountIn, 1 ether);
        assertEq(uint8(intent.status), uint8(IntentEscrow.IntentStatus.Pending));
        assertEq(IERC20(WETH).balanceOf(address(escrow)), 1 ether);
    }

    function test_cancelReturnsTokens() public {
        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), 1 ether);
        uint256 intentId = escrow.deposit(ensNode, WETH, USDC, 1 ether, 100e6, expiry);

        uint256 balBefore = IERC20(WETH).balanceOf(user);
        escrow.cancel(intentId);
        vm.stopPrank();

        assertEq(IERC20(WETH).balanceOf(user), balBefore + 1 ether);
        assertEq(uint8(escrow.getIntent(intentId).status), uint8(IntentEscrow.IntentStatus.Cancelled));
    }

    function test_cancelRevertsIfNotOwner() public {
        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), 1 ether);
        uint256 intentId = escrow.deposit(ensNode, WETH, USDC, 1 ether, 100e6, expiry);
        vm.stopPrank();

        vm.prank(agent);
        vm.expectRevert(IntentEscrow.NotIntentOwner.selector);
        escrow.cancel(intentId);
    }

    function test_cancelRevertsIfAlreadyCancelled() public {
        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), 1 ether);
        uint256 intentId = escrow.deposit(ensNode, WETH, USDC, 1 ether, 100e6, expiry);
        escrow.cancel(intentId);

        vm.expectRevert(IntentEscrow.IntentNotPending.selector);
        escrow.cancel(intentId);
        vm.stopPrank();
    }

    function test_executeRevertsOnExpiredIntent() public {
        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), 1 ether);
        uint256 intentId = escrow.deposit(ensNode, WETH, USDC, 1 ether, 100e6, uint64(block.timestamp + 1));
        vm.stopPrank();

        vm.warp(block.timestamp + 2);

        vm.prank(agent);
        vm.expectRevert(IntentEscrow.IntentExpired.selector);
        escrow.execute(intentId, "");
    }

    function test_intentIdIncrements() public {
        vm.startPrank(user);
        IERC20(WETH).approve(address(escrow), 3 ether);

        uint256 id0 = escrow.deposit(ensNode, WETH, USDC, 1 ether, 0, expiry);
        uint256 id1 = escrow.deposit(ensNode, WETH, USDC, 1 ether, 0, expiry);
        uint256 id2 = escrow.deposit(ensNode, WETH, USDC, 1 ether, 0, expiry);
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
    }
}
