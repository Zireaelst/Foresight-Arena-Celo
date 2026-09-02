// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {Outcome} from "../src/interfaces/IOutcomeResolver.sol";
import {ISortedOracles} from "../src/interfaces/ISortedOracles.sol";
import {MentoPriceResolver} from "../src/resolvers/MentoPriceResolver.sol";

/// @notice Fork test against the live Mento oracle on Celo mainnet.
///
/// This is the check that the interface in `ISortedOracles.sol` matches the contract
/// that is actually deployed -- a mock can only prove the resolver agrees with itself.
/// Skipped automatically when no mainnet RPC is configured, so `forge test` stays
/// green offline.
///
/// Run with:  CELO_RPC_URL=https://forno.celo.org forge test --match-contract MentoFork -vv
contract MentoForkTest is Test {
    /// @dev Celo Registry `getAddressForString("SortedOracles")`, verified on mainnet.
    address internal constant SORTED_ORACLES = 0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33;
    /// @dev cUSD; for the classic Mento feeds the rate feed id is the stable token address.
    address internal constant CUSD = 0x765DE816845861e75A25fCA122bb6898B8B1282a;

    MentoPriceResolver internal resolver;
    bool internal forked;

    function setUp() public {
        try vm.envString("CELO_RPC_URL") returns (string memory rpc) {
            vm.createSelectFork(rpc);
            forked = true;
        } catch {
            forked = false;
        }
        resolver = new MentoPriceResolver(ISortedOracles(SORTED_ORACLES));
    }

    function _config(uint256 thresholdFixed, MentoPriceResolver.Comparator cmp)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            MentoPriceResolver.Config({
                rateFeedId: CUSD,
                thresholdFixed: thresholdFixed,
                comparator: cmp,
                maxStaleness: 6 hours
            })
        );
    }

    function test_liveOracleIsReadableAndFresh() public {
        if (!forked) {
            emit log("skipped: set CELO_RPC_URL to run the fork test");
            return;
        }

        ISortedOracles oracles = ISortedOracles(SORTED_ORACLES);
        assertGt(oracles.numRates(CUSD), 0, "no reporters on the cUSD feed");

        (uint256 numerator, uint256 denominator) = oracles.medianRate(CUSD);
        assertGt(denominator, 0);
        uint256 reportedAt = oracles.medianTimestamp(CUSD);
        assertGt(reportedAt, 0);
        assertLt(block.timestamp - reportedAt, 6 hours, "live median is stale");

        emit log_named_uint("CELO/cUSD median numerator", numerator);
        emit log_named_uint("denominator", denominator);
        emit log_named_uint("age (seconds)", block.timestamp - reportedAt);
    }

    /// @dev A threshold of zero is always cleared and one of 1e40 never is, whatever the
    ///      price happens to be on the forked block -- so this asserts real behaviour
    ///      without pinning the test to a price that will drift.
    function test_resolvesAgainstLiveMedian() public {
        if (!forked) {
            emit log("skipped: set CELO_RPC_URL to run the fork test");
            return;
        }

        assertEq(
            uint8(resolver.resolve(_config(1, MentoPriceResolver.Comparator.AtOrAbove))),
            uint8(Outcome.Yes),
            "live median should clear a dust threshold"
        );
        assertEq(
            uint8(resolver.resolve(_config(1e40, MentoPriceResolver.Comparator.AtOrAbove))),
            uint8(Outcome.No),
            "live median should not clear an absurd threshold"
        );
        assertEq(
            uint8(resolver.resolve(_config(1e40, MentoPriceResolver.Comparator.AtOrBelow))),
            uint8(Outcome.Yes)
        );
    }
}
