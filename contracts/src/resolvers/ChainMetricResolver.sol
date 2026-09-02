// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOutcomeResolver, Outcome} from "../interfaces/IOutcomeResolver.sol";

/// @title ChainMetricResolver -- settlement for the "Zincir Nabzi" agent
/// @notice Answers questions about Celo's own state -- "will this contract's
///         `totalSupply()` be at or above X?" -- by making the read itself. The market
///         creator supplies a target contract, the calldata for a `view` function that
///         returns a single `uint256`, and a threshold.
///
/// @dev The target is arbitrary and chosen by whoever opened the market, so the honesty
///      of the answer is exactly the honesty of the question. That is acceptable here
///      because the config is public before anyone stakes: a staker who dislikes the
///      metric simply does not take the other side. What this contract does guarantee
///      is that it cannot be used to attack the pool -- the call is `staticcall`, gas
///      capped, and any failure settles to `Void` (full refund) rather than reverting
///      and stranding the market.
contract ChainMetricResolver is IOutcomeResolver {
    enum Comparator {
        AtOrAbove,
        AtOrBelow
    }

    struct Config {
        address target;
        bytes callData;
        uint256 threshold;
        Comparator comparator;
    }

    /// @notice Gas ceiling for the metric read. Generous for a storage read, far below
    ///         anything that could grief `ForesightPool.resolve`.
    uint256 public constant READ_GAS_LIMIT = 200_000;

    error EmptyTarget();
    error EmptyCallData();

    /// @inheritdoc IOutcomeResolver
    function validateConfig(bytes calldata config) external view {
        Config memory c = abi.decode(config, (Config));
        if (c.target == address(0) || c.target.code.length == 0) revert EmptyTarget();
        // A bare 4-byte selector is the shortest legitimate read.
        if (c.callData.length < 4) revert EmptyCallData();
    }

    /// @inheritdoc IOutcomeResolver
    function resolve(bytes calldata config) external view returns (Outcome) {
        Config memory c = abi.decode(config, (Config));

        (bool ok, bytes memory ret) = c.target.staticcall{gas: READ_GAS_LIMIT}(c.callData);
        // Anything other than a clean single-word return is undecidable, not a "No".
        if (!ok || ret.length != 32) return Outcome.Void;

        uint256 metric = abi.decode(ret, (uint256));
        // Both comparators are inclusive; a metric exactly on the threshold answers YES
        // either way. Deliberately not `!atOrAbove`, which would be strictly-below.
        bool yes = c.comparator == Comparator.AtOrAbove ? metric >= c.threshold : metric <= c.threshold;
        return yes ? Outcome.Yes : Outcome.No;
    }

    /// @inheritdoc IOutcomeResolver
    function describe(bytes calldata config) external pure returns (string memory) {
        Config memory c = abi.decode(config, (Config));
        return string.concat(
            "On-chain read of a single uint256, compared ",
            c.comparator == Comparator.AtOrAbove ? "at-or-above" : "at-or-below",
            " the configured threshold. Target and calldata are public in the market config."
        );
    }

    function encodeConfig(Config memory c) external pure returns (bytes memory) {
        return abi.encode(c);
    }
}
