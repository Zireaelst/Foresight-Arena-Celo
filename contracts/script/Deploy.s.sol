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
import {TestnetSortedOracles} from "../src/testnet/TestnetSortedOracles.sol";
import {TestnetUSDC} from "../src/testnet/TestnetUSDC.sol";

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
        bool isTestnet = chainId == CeloAddresses.SEPOLIA_CHAIN_ID;

        // Celo Sepolia's USDC is a real Circle FiatToken with no public mint, so nobody
        // but Circle can obtain it -- which would make the open, human-facing half of the
        // demo impossible. On testnet we therefore settle in a faucet-backed stand-in;
        // on mainnet, always real USDC. STAKE_TOKEN overrides either.
        address stakeToken = vm.envOr("STAKE_TOKEN", isTestnet ? address(0) : CeloAddresses.usdc(chainId));

        // Mento's SortedOracles exists on Celo Sepolia but is not maintained there (its
        // cUSD median is over a year stale), so the price resolver would void every
        // testnet market. On Sepolia we therefore deploy a clearly-labelled stand-in and
        // point the resolver at it; on mainnet the resolver always points at real Mento.
        address oracles = isTestnet ? address(0) : CeloAddresses.sortedOracles(chainId);

        console2.log("chainId       ", chainId);
        console2.log("owner         ", owner);
        console2.log("stakeToken    ", stakeToken);
        console2.log(
            "priceFeed     ", isTestnet ? "TestnetSortedOracles (deployed below)" : "Mento SortedOracles"
        );
        console2.log("scoreAttestor ", scoreAttestor);

        vm.startBroadcast();

        if (isTestnet && stakeToken == address(0)) {
            TestnetUSDC testnetUsdc = new TestnetUSDC();
            stakeToken = address(testnetUsdc);
            console2.log("TestnetUSDC          ", stakeToken, "(TESTNET STAND-IN, open faucet)");
        }

        if (isTestnet) {
            TestnetSortedOracles testnetOracles = new TestnetSortedOracles(owner);
            oracles = address(testnetOracles);
            console2.log("TestnetSortedOracles ", oracles, "(TESTNET STAND-IN, owner-written)");
        }

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

        // One machine-readable record of what is deployed where, so the agent layer and
        // the dashboard read addresses from the deployment rather than from a README that
        // someone has to remember to update.
        _writeDeployment(
            Deployment({
                chainId: chainId,
                owner: owner,
                stakeToken: stakeToken,
                priceFeed: oracles,
                scoreAttestor: scoreAttestor,
                pool: address(pool),
                priceResolver: address(priceResolver),
                chainResolver: address(chainResolver),
                scoreResolver: address(scoreResolver)
            })
        );
    }

    /// @dev Grouped into a struct because the script's locals otherwise overflow the
    ///      EVM's 16-slot stack window.
    struct Deployment {
        uint256 chainId;
        address owner;
        address stakeToken;
        address priceFeed;
        address scoreAttestor;
        address pool;
        address priceResolver;
        address chainResolver;
        address scoreResolver;
    }

    function _writeDeployment(Deployment memory d) internal {
        string memory json = "deployment";
        vm.serializeUint(json, "chainId", d.chainId);
        vm.serializeAddress(json, "owner", d.owner);
        vm.serializeAddress(json, "stakeToken", d.stakeToken);
        vm.serializeAddress(json, "priceFeed", d.priceFeed);
        vm.serializeAddress(json, "scoreAttestor", d.scoreAttestor);
        vm.serializeAddress(json, "foresightPool", d.pool);
        vm.serializeAddress(json, "mentoPriceResolver", d.priceResolver);
        vm.serializeAddress(json, "chainMetricResolver", d.chainResolver);
        string memory out = vm.serializeAddress(json, "attestedScoreResolver", d.scoreResolver);

        string memory path = string.concat("./deployments/", vm.toString(d.chainId), ".json");
        vm.writeJson(out, path);
        console2.log("wrote", path);
    }
}
