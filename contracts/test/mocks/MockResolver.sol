// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOutcomeResolver, Outcome} from "../../src/interfaces/IOutcomeResolver.sol";

/// @dev Resolver whose answer the test controls directly, so pool mechanics can be
///      exercised without standing up an oracle.
contract MockResolver is IOutcomeResolver {
    Outcome public next = Outcome.Yes;
    bool public rejectConfig;

    error ConfigRejected();

    function setNext(Outcome outcome) external {
        next = outcome;
    }

    function setRejectConfig(bool reject) external {
        rejectConfig = reject;
    }

    function resolve(bytes calldata) external view returns (Outcome) {
        return next;
    }

    function validateConfig(bytes calldata) external view {
        if (rejectConfig) revert ConfigRejected();
    }

    function describe(bytes calldata) external pure returns (string memory) {
        return "mock";
    }
}
