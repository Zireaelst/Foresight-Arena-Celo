// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {Outcome} from "../src/interfaces/IOutcomeResolver.sol";
import {ISortedOracles} from "../src/interfaces/ISortedOracles.sol";
import {MentoPriceResolver} from "../src/resolvers/MentoPriceResolver.sol";
import {ChainMetricResolver} from "../src/resolvers/ChainMetricResolver.sol";
import {AttestedScoreResolver} from "../src/resolvers/AttestedScoreResolver.sol";
import {MockSortedOracles} from "./mocks/MockSortedOracles.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract MentoPriceResolverTest is Test {
    MockSortedOracles internal oracles;
    MentoPriceResolver internal resolver;

    address internal constant FEED = address(0xBEEF);
    uint64 internal constant MAX_STALENESS = 30 minutes;

    function setUp() public {
        vm.warp(1_700_000_000);
        oracles = new MockSortedOracles();
        resolver = new MentoPriceResolver(ISortedOracles(address(oracles)));
    }

    function _config(uint256 thresholdFixed, MentoPriceResolver.Comparator cmp)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            MentoPriceResolver.Config({
                rateFeedId: FEED,
                thresholdFixed: thresholdFixed,
                comparator: cmp,
                maxStaleness: MAX_STALENESS
            })
        );
    }

    /// @dev Mento reports rate = numerator/denominator with denominator = 1e24 (Fixidity).
    function _setPrice(uint256 priceFixed) internal {
        oracles.setRate(priceFixed, 1e24, block.timestamp, 1);
    }

    function test_atOrAbove_yesWhenPriceClearsThreshold() public {
        _setPrice(0.09e24);
        assertEq(
            uint8(resolver.resolve(_config(0.08e24, MentoPriceResolver.Comparator.AtOrAbove))),
            uint8(Outcome.Yes)
        );
    }

    function test_atOrAbove_noWhenPriceIsBelow() public {
        _setPrice(0.07e24);
        assertEq(
            uint8(resolver.resolve(_config(0.08e24, MentoPriceResolver.Comparator.AtOrAbove))),
            uint8(Outcome.No)
        );
    }

    function test_boundaryIsInclusive() public {
        _setPrice(0.08e24);
        assertEq(
            uint8(resolver.resolve(_config(0.08e24, MentoPriceResolver.Comparator.AtOrAbove))),
            uint8(Outcome.Yes),
            "exactly at the threshold counts as at-or-above"
        );
        assertEq(
            uint8(resolver.resolve(_config(0.08e24, MentoPriceResolver.Comparator.AtOrBelow))),
            uint8(Outcome.Yes),
            "and as at-or-below"
        );
    }

    function test_atOrBelow_isTheExactComplement() public {
        _setPrice(0.07e24);
        assertEq(
            uint8(resolver.resolve(_config(0.08e24, MentoPriceResolver.Comparator.AtOrBelow))),
            uint8(Outcome.Yes)
        );
    }

    function test_voidsOnStaleMedian() public {
        oracles.setRate(0.09e24, 1e24, block.timestamp - MAX_STALENESS - 1, 1);
        assertEq(
            uint8(resolver.resolve(_config(0.08e24, MentoPriceResolver.Comparator.AtOrAbove))),
            uint8(Outcome.Void),
            "a median nobody has refreshed must not settle real money"
        );
    }

    function test_voidsWhenNoReporters() public {
        oracles.setRate(0.09e24, 1e24, block.timestamp, 0);
        assertEq(
            uint8(resolver.resolve(_config(0.08e24, MentoPriceResolver.Comparator.AtOrAbove))),
            uint8(Outcome.Void)
        );
    }

    function test_voidsOnZeroDenominator() public {
        oracles.setRate(0.09e24, 0, block.timestamp, 1);
        assertEq(
            uint8(resolver.resolve(_config(0.08e24, MentoPriceResolver.Comparator.AtOrAbove))),
            uint8(Outcome.Void)
        );
    }

    function test_validateConfig_rejectsBadInput() public {
        vm.expectRevert(MentoPriceResolver.EmptyRateFeed.selector);
        resolver.validateConfig(
            abi.encode(
                MentoPriceResolver.Config(address(0), 1e24, MentoPriceResolver.Comparator.AtOrAbove, 1)
            )
        );
        vm.expectRevert(MentoPriceResolver.ZeroThreshold.selector);
        resolver.validateConfig(
            abi.encode(MentoPriceResolver.Config(FEED, 0, MentoPriceResolver.Comparator.AtOrAbove, 1))
        );
        vm.expectRevert(MentoPriceResolver.ZeroStaleness.selector);
        resolver.validateConfig(
            abi.encode(MentoPriceResolver.Config(FEED, 1e24, MentoPriceResolver.Comparator.AtOrAbove, 0))
        );
        vm.expectRevert(MentoPriceResolver.ThresholdOutOfRange.selector);
        resolver.validateConfig(
            abi.encode(MentoPriceResolver.Config(FEED, 1e41, MentoPriceResolver.Comparator.AtOrAbove, 1))
        );
    }

    /// @dev The comparison cross-multiplies instead of dividing, so it must stay exact
    ///      for any in-range rate and threshold.
    function testFuzz_matchesExactRationalComparison(uint256 numerator, uint256 threshold) public {
        numerator = bound(numerator, 1, 1e30);
        threshold = bound(threshold, 1, 1e30);
        oracles.setRate(numerator, 1e24, block.timestamp, 1);

        bool expectedYes = numerator >= threshold; // denominator == 1e24 on both sides
        Outcome got = resolver.resolve(_config(threshold, MentoPriceResolver.Comparator.AtOrAbove));
        assertEq(uint8(got), uint8(expectedYes ? Outcome.Yes : Outcome.No));
    }
}

contract ChainMetricResolverTest is Test {
    ChainMetricResolver internal resolver;
    MockUSDC internal token;

    function setUp() public {
        resolver = new ChainMetricResolver();
        token = new MockUSDC();
        token.mint(address(this), 1_000e6);
    }

    function _config(address target, bytes memory callData, uint256 threshold, ChainMetricResolver.Comparator cmp)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(ChainMetricResolver.Config(target, callData, threshold, cmp));
    }

    function test_readsRealOnChainMetric() public view {
        bytes memory config = _config(
            address(token),
            abi.encodeWithSignature("totalSupply()"),
            500e6,
            ChainMetricResolver.Comparator.AtOrAbove
        );
        assertEq(uint8(resolver.resolve(config)), uint8(Outcome.Yes));
    }

    function test_belowThresholdIsNo() public view {
        bytes memory config = _config(
            address(token),
            abi.encodeWithSignature("totalSupply()"),
            5_000e6,
            ChainMetricResolver.Comparator.AtOrAbove
        );
        assertEq(uint8(resolver.resolve(config)), uint8(Outcome.No));
    }

    function test_revertingTargetVoidsInsteadOfBubblingUp() public view {
        // Unknown selector on a real contract: the staticcall reverts.
        bytes memory config = _config(
            address(token), abi.encodeWithSignature("noSuchFunction()"), 1, ChainMetricResolver.Comparator.AtOrAbove
        );
        assertEq(
            uint8(resolver.resolve(config)),
            uint8(Outcome.Void),
            "a broken data source must refund, never strand the market"
        );
    }

    function test_nonWordReturnVoids() public view {
        // `name()` returns a dynamic string, not a single word.
        bytes memory config = _config(
            address(token), abi.encodeWithSignature("name()"), 1, ChainMetricResolver.Comparator.AtOrAbove
        );
        assertEq(uint8(resolver.resolve(config)), uint8(Outcome.Void));
    }

    function test_gasGriefingTargetVoidsWithinTheCap() public {
        GasBurner burner = new GasBurner();
        bytes memory config = _config(
            address(burner), abi.encodeWithSignature("burn()"), 1, ChainMetricResolver.Comparator.AtOrAbove
        );
        uint256 gasBefore = gasleft();
        assertEq(uint8(resolver.resolve(config)), uint8(Outcome.Void));
        uint256 used = gasBefore - gasleft();
        assertLt(used, 400_000, "an unbounded target must not be able to burn the caller's gas");
    }

    function test_boundaryIsInclusiveBothWays() public view {
        bytes memory selector = abi.encodeWithSignature("totalSupply()");
        uint256 exact = token.totalSupply();
        assertEq(
            uint8(resolver.resolve(_config(address(token), selector, exact, ChainMetricResolver.Comparator.AtOrAbove))),
            uint8(Outcome.Yes)
        );
        assertEq(
            uint8(resolver.resolve(_config(address(token), selector, exact, ChainMetricResolver.Comparator.AtOrBelow))),
            uint8(Outcome.Yes)
        );
    }

    function test_validateConfig_rejectsNonContractAndShortCalldata() public {
        vm.expectRevert(ChainMetricResolver.EmptyTarget.selector);
        resolver.validateConfig(
            _config(makeAddr("eoa"), hex"12345678", 1, ChainMetricResolver.Comparator.AtOrAbove)
        );
        vm.expectRevert(ChainMetricResolver.EmptyCallData.selector);
        resolver.validateConfig(_config(address(token), hex"1234", 1, ChainMetricResolver.Comparator.AtOrAbove));
    }
}

contract AttestedScoreResolverTest is Test {
    AttestedScoreResolver internal resolver;
    address internal attestor = makeAddr("scoreAttestor");
    bytes32 internal constant EVENT_KEY = keccak256("2026-09-10 home team wins");

    function setUp() public {
        resolver = new AttestedScoreResolver(attestor);
    }

    function _config() internal pure returns (bytes memory) {
        return abi.encode(AttestedScoreResolver.Config(EVENT_KEY));
    }

    function test_unattestedStaysUnresolvedSoSettlementCanBeRetried() public view {
        assertEq(uint8(resolver.resolve(_config())), uint8(Outcome.Unresolved));
    }

    function test_attestationIsReportedVerbatim() public {
        vm.prank(attestor);
        resolver.attest(EVENT_KEY, Outcome.Yes, keccak256("payload"), "https://api.example/fixture/1");
        assertEq(uint8(resolver.resolve(_config())), uint8(Outcome.Yes));
    }

    function test_onlyAttestorMayPublish() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(AttestedScoreResolver.NotAttestor.selector);
        resolver.attest(EVENT_KEY, Outcome.Yes, bytes32(0), "");
    }

    function test_writeOnce_soHistoryCannotBeRewritten() public {
        vm.startPrank(attestor);
        resolver.attest(EVENT_KEY, Outcome.Yes, bytes32(0), "src");
        vm.expectRevert(AttestedScoreResolver.AlreadyAttested.selector);
        resolver.attest(EVENT_KEY, Outcome.No, bytes32(0), "src");
        vm.stopPrank();
    }

    function test_cannotAttestUnresolved() public {
        vm.prank(attestor);
        vm.expectRevert(AttestedScoreResolver.InvalidOutcome.selector);
        resolver.attest(EVENT_KEY, Outcome.Unresolved, bytes32(0), "");
    }
}

/// @dev Consumes every drop of gas it is given, to prove READ_GAS_LIMIT contains it.
contract GasBurner {
    function burn() external pure returns (uint256 x) {
        while (true) {
            x = uint256(keccak256(abi.encode(x)));
        }
    }
}
