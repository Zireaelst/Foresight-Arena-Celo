// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOutcomeResolver, Outcome} from "../interfaces/IOutcomeResolver.sol";
import {ISortedOracles} from "../interfaces/ISortedOracles.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title MentoPriceResolver -- settlement for the "Fiyat Nobetcisi" agent
/// @notice Answers "is the price of <rate feed> at or above/below <threshold>?" by
///         reading Mento's SortedOracles directly. Nothing off-chain is trusted: the
///         same call any observer can make is the call that settles the market.
///
/// @dev Timing caveat, stated plainly: SortedOracles exposes the *current* median, not
///      a historical snapshot. A market therefore settles against the median at the
///      moment `resolve` is first called on or after `resolvesAt`. Markets should be
///      phrased as "at settlement time", not "at exactly 12:00 UTC".
contract MentoPriceResolver is IOutcomeResolver {
    /// @dev Comparison applied to the median rate.
    enum Comparator {
        AtOrAbove,
        AtOrBelow
    }

    struct Config {
        /// @dev Mento rate feed id (for the classic feeds this is the stable token address).
        address rateFeedId;
        /// @dev Threshold in the same fixed-point scale the oracle reports, i.e. scaled by 1e24.
        uint256 thresholdFixed;
        Comparator comparator;
        /// @dev Reject a median older than this many seconds; the market voids instead.
        uint64 maxStaleness;
    }

    ISortedOracles public immutable sortedOracles;

    error EmptyRateFeed();
    error ZeroThreshold();
    error ZeroStaleness();
    error ThresholdOutOfRange();

    /// @dev Keeps `thresholdFixed * denominator` inside uint256 during comparison.
    uint256 internal constant MAX_THRESHOLD_FIXED = 1e40;

    constructor(ISortedOracles sortedOracles_) {
        sortedOracles = sortedOracles_;
    }

    /// @inheritdoc IOutcomeResolver
    function validateConfig(bytes calldata config) external pure {
        Config memory c = abi.decode(config, (Config));
        if (c.rateFeedId == address(0)) revert EmptyRateFeed();
        if (c.thresholdFixed == 0) revert ZeroThreshold();
        if (c.thresholdFixed > MAX_THRESHOLD_FIXED) revert ThresholdOutOfRange();
        if (c.maxStaleness == 0) revert ZeroStaleness();
    }

    /// @inheritdoc IOutcomeResolver
    function resolve(bytes calldata config) external view returns (Outcome) {
        Config memory c = abi.decode(config, (Config));

        // No reporters, or the median has gone stale -> refuse to settle rather than
        // settle on a number nobody is standing behind.
        if (sortedOracles.numRates(c.rateFeedId) == 0) return Outcome.Void;
        uint256 reportedAt = sortedOracles.medianTimestamp(c.rateFeedId);
        if (reportedAt == 0 || block.timestamp - reportedAt > c.maxStaleness) return Outcome.Void;

        (uint256 numerator, uint256 denominator) = sortedOracles.medianRate(c.rateFeedId);
        if (denominator == 0) return Outcome.Void;

        // Compare in the oracle's own scale: median >= threshold  <=>  num * 1e24 >= threshold * den.
        // Cross-multiplying avoids a division and its rounding entirely.
        uint256 scaledMedian = numerator * 1e24;
        uint256 scaledThreshold = c.thresholdFixed * denominator;

        // Both comparators are inclusive, so a median sitting exactly on the threshold
        // answers YES either way. Note this is NOT `!atOrAbove` -- that would be a
        // strictly-below test and would flip the boundary case.
        bool yes = c.comparator == Comparator.AtOrAbove
            ? scaledMedian >= scaledThreshold
            : scaledMedian <= scaledThreshold;
        return yes ? Outcome.Yes : Outcome.No;
    }

    /// @inheritdoc IOutcomeResolver
    function describe(bytes calldata config) external pure returns (string memory) {
        Config memory c = abi.decode(config, (Config));
        return string.concat(
            "Mento median rate for feed ",
            Strings.toHexString(c.rateFeedId),
            c.comparator == Comparator.AtOrAbove ? " >= " : " <= ",
            Strings.toString(c.thresholdFixed),
            " (1e24-scaled) at settlement"
        );
    }

    function encodeConfig(Config memory c) external pure returns (bytes memory) {
        return abi.encode(c);
    }

}
