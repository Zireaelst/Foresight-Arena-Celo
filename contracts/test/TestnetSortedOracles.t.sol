// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {Outcome} from "../src/interfaces/IOutcomeResolver.sol";
import {ISortedOracles} from "../src/interfaces/ISortedOracles.sol";
import {MentoPriceResolver} from "../src/resolvers/MentoPriceResolver.sol";
import {TestnetSortedOracles} from "../src/testnet/TestnetSortedOracles.sol";

/// @notice The testnet stand-in has to be a drop-in for Mento's SortedOracles: the whole
///         point is that the resolver, the agent and the dashboard run unmodified against
///         it. These tests pin the parts {MentoPriceResolver} actually depends on.
contract TestnetSortedOraclesTest is Test {
    TestnetSortedOracles internal oracles;
    MentoPriceResolver internal resolver;

    address internal constant OWNER = address(0xA11CE);
    address internal constant FEED = address(0xFEED);

    function setUp() public {
        vm.warp(1_700_000_000);
        oracles = new TestnetSortedOracles(OWNER);
        resolver = new MentoPriceResolver(ISortedOracles(address(oracles)));
    }

    function _config(uint256 thresholdFixed, MentoPriceResolver.Comparator cmp, uint64 staleness)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            MentoPriceResolver.Config({
                rateFeedId: FEED, thresholdFixed: thresholdFixed, comparator: cmp, maxStaleness: staleness
            })
        );
    }

    function test_onlyOwnerMayReport() public {
        vm.expectRevert();
        oracles.reportPrice(FEED, 1e24, 1);
    }

    function test_unreportedFeedVoidsRatherThanSettling() public {
        // An unwritten feed has zero reporters, which the resolver must treat as
        // undecidable -- not as a price of zero.
        assertEq(
            uint8(resolver.resolve(_config(1e24, MentoPriceResolver.Comparator.AtOrAbove, 3600))),
            uint8(Outcome.Void)
        );
    }

    function test_reportedPriceSettlesThroughTheResolver() public {
        vm.prank(OWNER);
        oracles.reportPrice(FEED, 15e23, 2); // 1.5

        assertEq(
            uint8(resolver.resolve(_config(1e24, MentoPriceResolver.Comparator.AtOrAbove, 3600))),
            uint8(Outcome.Yes),
            "1.5 >= 1.0 is YES"
        );
        assertEq(
            uint8(resolver.resolve(_config(2e24, MentoPriceResolver.Comparator.AtOrAbove, 3600))),
            uint8(Outcome.No),
            "1.5 >= 2.0 is NO"
        );
    }

    /// @dev Freshness must stay real: `report` stamps block.timestamp, so a stand-in
    ///      cannot be used to fake a fresh median for a stale price.
    function test_stalenessIsNotFakeable() public {
        vm.prank(OWNER);
        oracles.reportPrice(FEED, 15e23, 2);
        assertEq(oracles.medianTimestamp(FEED), block.timestamp);

        vm.warp(block.timestamp + 7200);
        assertEq(
            uint8(resolver.resolve(_config(1e24, MentoPriceResolver.Comparator.AtOrAbove, 3600))),
            uint8(Outcome.Void),
            "a two-hour-old median past a one-hour limit must void"
        );
    }

    function testFuzz_reportRoundTrips(uint128 numerator, uint128 reporters) public {
        vm.assume(reporters > 0);
        vm.prank(OWNER);
        oracles.report(FEED, numerator, 1e24, reporters);

        (uint256 gotNum, uint256 gotDen) = oracles.medianRate(FEED);
        assertEq(gotNum, numerator);
        assertEq(gotDen, 1e24);
        assertEq(oracles.numRates(FEED), reporters);
    }
}
