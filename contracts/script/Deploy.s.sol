// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ForesightPool} from "../src/ForesightPool.sol";
import {ISortedOracles} from "../src/interfaces/ISortedOracles.sol";
import {MentoPriceResolver} from "../src/resolvers/MentoPriceResolver.sol";
import {ChainMetricResolver} from "../src/resolvers/ChainMetricResolver.sol";
import {AttestedScoreResolver} from "../src/resolvers/AttestedScoreResolver.sol";
import {CeloAddresses} from "../src/config/CeloAddresses.sol";

/// @notice Deploys the Foresight Arena contract layer and wires the three showcase
///         resolvers into the pool.
///
/// Testnet first, per the project guardrails:
///
///   forge script script/Deploy.s.sol --rpc-url celo_sepolia --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY
///
/// Mainnet is the same command with `--rpc-url celo`, and must not be run until a
/// second pair of eyes has reviewed this layer (CLAUDE.md, "Sert kurallar").
contract Deploy is Script {
    function run() external {
        uint256 chainId = block.chainid;

        address owner = vm.envOr("POOL_OWNER", msg.sender);
        address scoreAttestor = vm.envOr("SCORE_ATTESTOR", owner);
        address stakeToken = vm.envOr("STAKE_TOKEN", CeloAddresses.usdc(chainId));
        address oracles = CeloAddresses.sortedOracles(chainId);

        console2.log("chainId       ", chainId);
        console2.log("owner         ", owner);
        console2.log("stakeToken    ", stakeToken);
        console2.log("sortedOracles ", oracles);
        console2.log("scoreAttestor ", scoreAttestor);

        vm.startBroadcast();

        ForesightPool pool = new ForesightPool(IERC20(stakeToken), owner);
        MentoPriceResolver priceResolver = new MentoPriceResolver(ISortedOracles(oracles));
        ChainMetricResolver chainResolver = new ChainMetricResolver();
        AttestedScoreResolver scoreResolver = new AttestedScoreResolver(scoreAttestor);

        // Only meaningful when the broadcaster is the pool owner. When ownership is a
        // multisig, skip this and approve the resolvers from the multisig instead.
        if (owner == msg.sender) {
            pool.setResolverApproval(address(priceResolver), true);
            pool.setResolverApproval(address(chainResolver), true);
            pool.setResolverApproval(address(scoreResolver), true);
        }

        vm.stopBroadcast();

        console2.log("ForesightPool        ", address(pool));
        console2.log("MentoPriceResolver   ", address(priceResolver));
        console2.log("ChainMetricResolver  ", address(chainResolver));
        console2.log("AttestedScoreResolver", address(scoreResolver));

        if (owner != msg.sender) {
            console2.log("NOTE: owner != broadcaster; approve the three resolvers from the owner account.");
        }
    }
}
