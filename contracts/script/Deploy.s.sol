// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IntentEscrow} from "../src/IntentEscrow.sol";

contract DeployScript is Script {
    // Uniswap Universal Router v4 — addresses are per-chain.
    // Mainnet: 0x66a9893cc07d91d95644aedd05d03f95e1dba8af
    // Base:    0x6ff5693b99212da76ad316178a184ab56d299b43
    // See https://docs.uniswap.org for other chains.
    address constant UNIVERSAL_ROUTER_MAINNET = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        address router = vm.envOr("UNIVERSAL_ROUTER", UNIVERSAL_ROUTER_MAINNET);
        IntentEscrow escrow = new IntentEscrow(router);
        console.log("IntentEscrow deployed:", address(escrow));
        console.log("Universal Router:     ", router);

        vm.stopBroadcast();
    }
}
