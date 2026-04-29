// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IntentEscrow} from "../src/IntentEscrow.sol";

contract DeployScript is Script {
    // Uniswap Universal Router — addresses are per-chain.
    // Ethereum Mainnet: 0x66a9893cc07d91d95644aedd05d03f95e1dba8af
    // Base Mainnet:     0x6ff5693b99212da76ad316178a184ab56d299b43
    address constant UNIVERSAL_ROUTER_BASE = 0x6fF5693b99212Da76ad316178A184AB56D299b43;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        address router = vm.envOr("UNIVERSAL_ROUTER", UNIVERSAL_ROUTER_BASE);
        IntentEscrow escrow = new IntentEscrow(router);
        console.log("IntentEscrow deployed:", address(escrow));
        console.log("Universal Router:     ", router);

        vm.stopBroadcast();
    }
}
