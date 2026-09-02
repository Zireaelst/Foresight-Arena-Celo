// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOutcomeResolver, Outcome} from "../interfaces/IOutcomeResolver.sol";

/// @title AttestedScoreResolver -- settlement for the "Skor Kahini" agent
/// @notice Sports results have no on-chain source, so this resolver is the one place in
///         Foresight Arena where an off-chain reader is trusted. It is kept deliberately
///         narrow: a named attestor publishes an outcome for a specific event key, and
///         the resolver only ever reports what was published.
///
/// @dev Honest accounting of the trust model, since the project claims "no human
///      arbiter": this is not arbitration -- the attestor does not judge, it transcribes
///      a public scoreline from a public API, and it must publish the source URI and a
///      hash of the payload it read alongside the outcome. Anyone can check the
///      transcription against the same API. Markets using this resolver should say so.
contract AttestedScoreResolver is IOutcomeResolver {
    struct Config {
        /// @dev Identifies the sporting event and the exact YES condition, e.g.
        ///      keccak256("2026-09-10 TUR-vs-XXX; YES = home team wins").
        bytes32 eventKey;
    }

    struct Attestation {
        Outcome outcome;
        uint64 publishedAt;
        bytes32 payloadHash;
        string sourceURI;
    }

    address public immutable attestor;

    mapping(bytes32 => Attestation) public attestations;

    event OutcomeAttested(
        bytes32 indexed eventKey, Outcome outcome, bytes32 payloadHash, string sourceURI
    );

    error NotAttestor();
    error EmptyEventKey();
    error AlreadyAttested();
    error InvalidOutcome();

    constructor(address attestor_) {
        attestor = attestor_;
    }

    /// @notice Publish the result of an event. Write-once per event key: an attestor that
    ///         could rewrite history after stakes are placed would be an arbiter.
    function attest(bytes32 eventKey, Outcome outcome, bytes32 payloadHash, string calldata sourceURI)
        external
    {
        if (msg.sender != attestor) revert NotAttestor();
        if (outcome == Outcome.Unresolved) revert InvalidOutcome();
        if (attestations[eventKey].outcome != Outcome.Unresolved) revert AlreadyAttested();

        attestations[eventKey] =
            Attestation({outcome: outcome, publishedAt: uint64(block.timestamp), payloadHash: payloadHash, sourceURI: sourceURI});
        emit OutcomeAttested(eventKey, outcome, payloadHash, sourceURI);
    }

    /// @inheritdoc IOutcomeResolver
    function validateConfig(bytes calldata config) external pure {
        Config memory c = abi.decode(config, (Config));
        if (c.eventKey == bytes32(0)) revert EmptyEventKey();
    }

    /// @inheritdoc IOutcomeResolver
    function resolve(bytes calldata config) external view returns (Outcome) {
        Config memory c = abi.decode(config, (Config));
        // Returns Outcome.Unresolved when nothing has been published yet, which makes
        // ForesightPool.resolve revert so settlement can simply be retried later. If the
        // attestor never publishes at all, the market's escape hatch is voidMarket().
        return attestations[c.eventKey].outcome;
    }

    /// @inheritdoc IOutcomeResolver
    function describe(bytes calldata config) external view returns (string memory) {
        Config memory c = abi.decode(config, (Config));
        Attestation storage a = attestations[c.eventKey];
        if (a.outcome == Outcome.Unresolved) return "Awaiting attestation from the named score attestor.";
        return string.concat("Attested from source: ", a.sourceURI);
    }

    function encodeConfig(Config memory c) external pure returns (bytes memory) {
        return abi.encode(c);
    }
}
