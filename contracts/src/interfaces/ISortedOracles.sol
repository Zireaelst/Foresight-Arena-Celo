// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Subset of Mento's SortedOracles used by {MentoPriceResolver}.
/// @dev Celo mainnet: 0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33 (resolved from the
///      Celo Registry at 0x000000000000000000000000000000000000ce10 via
///      `getAddressForString("SortedOracles")`). Rates are fixed point: the value is
///      `numerator / denominator`, and the denominator is Fixidity's 1e24.
interface ISortedOracles {
    function medianRate(address rateFeedId) external view returns (uint256 numerator, uint256 denominator);
    function medianTimestamp(address rateFeedId) external view returns (uint256);
    function numRates(address rateFeedId) external view returns (uint256);
}
