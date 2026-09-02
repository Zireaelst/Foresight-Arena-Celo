// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ForesightPool} from "../src/ForesightPool.sol";
import {ChainMetricResolver} from "../src/resolvers/ChainMetricResolver.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice Stands up a complete arena on a local anvil node so the agent layer can be
///         exercised end to end without spending anything. Not for any public network.
contract LocalDemo is Script {
    function run() external {
        address agentWallet = vm.envAddress("AGENT_WALLET");

        vm.startBroadcast();

        MockUSDC usdc = new MockUSDC();
        ForesightPool pool = new ForesightPool(IERC20(address(usdc)), msg.sender);
        ChainMetricResolver resolver = new ChainMetricResolver();

        pool.setResolverApproval(address(resolver), true);
        pool.registerAgent(agentWallet, 1);
        usdc.mint(agentWallet, 50e6);
        usdc.mint(msg.sender, 50e6);

        // "Will USDC total supply be at or above 1 unit at settlement?" -- trivially true,
        // which is what we want: the assertion under test is the agent plumbing, not the
        // forecast.
        bytes memory config = abi.encode(
            ChainMetricResolver.Config({
                target: address(usdc),
                callData: abi.encodeWithSignature("totalSupply()"),
                threshold: 1e6,
                comparator: ChainMetricResolver.Comparator.AtOrAbove
            })
        );

        uint256 marketId = pool.createMarket(
            "Will the stake token's total supply be at or above 1 unit at settlement?",
            address(resolver),
            config,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );

        // Seed the opposite side so the book is two-sided and settles for real.
        usdc.approve(address(pool), 1e6);
        pool.stake(marketId, ForesightPool.Side.No, 1e6);

        vm.stopBroadcast();

        console2.log("USDC                ", address(usdc));
        console2.log("ForesightPool       ", address(pool));
        console2.log("ChainMetricResolver ", address(resolver));
        console2.log("marketId            ", marketId);
    }
}
