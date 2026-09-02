// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISortedOracles} from "../../src/interfaces/ISortedOracles.sol";

/// @dev Mirrors the shape of Mento's SortedOracles: a Fixidity-scaled rate plus the
///      freshness metadata {MentoPriceResolver} checks before it will settle.
contract MockSortedOracles is ISortedOracles {
    uint256 public rateNumerator;
    uint256 public rateDenominator = 1e24;
    uint256 public reportedAt;
    uint256 public reporters;

    function setRate(uint256 numerator, uint256 denominator, uint256 timestamp, uint256 count) external {
        rateNumerator = numerator;
        rateDenominator = denominator;
        reportedAt = timestamp;
        reporters = count;
    }

    function medianRate(address) external view returns (uint256, uint256) {
        return (rateNumerator, rateDenominator);
    }

    function medianTimestamp(address) external view returns (uint256) {
        return reportedAt;
    }

    function numRates(address) external view returns (uint256) {
        return reporters;
    }
}
