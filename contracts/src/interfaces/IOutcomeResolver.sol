// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Outcome of a market. `Unresolved` means "not settled yet"; `Void` means
///         "no winner, refund everyone" (used for one-sided books and cancellations).
enum Outcome {
    Unresolved,
    Yes,
    No,
    Void
}

/// @notice A resolver turns an objective, data-fed question into a YES/NO outcome.
///
/// Foresight Arena v1 accepts ONLY objective questions (see CLAUDE.md guardrails):
/// every market points at a resolver contract plus an opaque `config` blob that the
/// resolver knows how to decode. There is no human arbiter and no dispute window --
/// if a resolver cannot decide, it returns `Outcome.Void` and stakes are refunded.
///
/// @dev `resolve` is `view` on purpose: the pool calls it during settlement and must
///      not hand control flow to an untrusted contract that can re-enter.
interface IOutcomeResolver {
    /// @param config Resolver-specific parameters, ABI-encoded by the market creator.
    /// @return The settled outcome, or `Outcome.Void` when the data source cannot decide.
    function resolve(bytes calldata config) external view returns (Outcome);

    /// @notice Reverts if `config` is malformed. Called once at market creation so a
    ///         broken market can never be opened for staking.
    function validateConfig(bytes calldata config) external view;

    /// @notice Human-readable description of what `config` resolves, for the dashboard.
    function describe(bytes calldata config) external view returns (string memory);
}
