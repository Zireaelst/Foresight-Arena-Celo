// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ISortedOracles} from "../interfaces/ISortedOracles.sol";

/// @title TestnetSortedOracles -- a stand-in price feed for Celo Sepolia ONLY
///
/// @notice Mento's SortedOracles is deployed on Celo Sepolia but is not maintained there:
///         as of this writing its cUSD median was last reported at unix 1755614497, well
///         over a year stale. {MentoPriceResolver} correctly refuses to settle against a
///         stale median, so every price market on testnet would void -- which would make
///         the Fiyat Nobetcisi agent impossible to demonstrate end to end.
///
///         This contract fills that hole for testnet and nothing else. It presents the
///         exact `ISortedOracles` surface, so the resolver, the agent, and the dashboard
///         all run unmodified against it; only the address they are pointed at differs.
///
/// @dev The trust model here is deliberately worse than the real thing and must never be
///      confused with it: a single owner writes the rate. That is acceptable on a network
///      where the stake token is a faucet toy, and unacceptable anywhere else, so
///      {ForesightPool} on mainnet must point its price resolver at Mento's own
///      SortedOracles (see CeloAddresses.MAINNET_SORTED_ORACLES). The deploy script
///      enforces this by only deploying this contract when `block.chainid` is Sepolia.
contract TestnetSortedOracles is ISortedOracles, Ownable {
    /// @dev Fixidity's scale, as used by Mento: a rate is `numerator / denominator`.
    uint256 public constant FIXIDITY = 1e24;

    struct Rate {
        uint256 numerator;
        uint256 denominator;
        uint256 reportedAt;
        uint256 reporters;
    }

    /// @dev Keyed by rate feed id, exactly as Mento keys it, so a market's resolver
    ///      config is portable between this feed and the real one.
    mapping(address => Rate) private _rates;

    event RateReported(address indexed rateFeedId, uint256 numerator, uint256 denominator, uint256 reporters);

    error ZeroDenominator();
    error NoReporters();

    constructor(address owner_) Ownable(owner_) {}

    /// @notice Publish a rate. `reportedAt` is set to now, so freshness cannot be faked
    ///         backwards or forwards -- the staleness check in the resolver stays real.
    function report(address rateFeedId, uint256 numerator, uint256 denominator, uint256 reporters)
        external
        onlyOwner
    {
        if (denominator == 0) revert ZeroDenominator();
        if (reporters == 0) revert NoReporters();
        _rates[rateFeedId] = Rate({
            numerator: numerator, denominator: denominator, reportedAt: block.timestamp, reporters: reporters
        });
        emit RateReported(rateFeedId, numerator, denominator, reporters);
    }

    /// @notice Convenience form: publish a price expressed against the Fixidity scale.
    function reportPrice(address rateFeedId, uint256 priceFixed, uint256 reporters) external onlyOwner {
        if (reporters == 0) revert NoReporters();
        _rates[rateFeedId] = Rate({
            numerator: priceFixed, denominator: FIXIDITY, reportedAt: block.timestamp, reporters: reporters
        });
        emit RateReported(rateFeedId, priceFixed, FIXIDITY, reporters);
    }

    function medianRate(address rateFeedId) external view returns (uint256, uint256) {
        Rate storage r = _rates[rateFeedId];
        return (r.numerator, r.denominator);
    }

    function medianTimestamp(address rateFeedId) external view returns (uint256) {
        return _rates[rateFeedId].reportedAt;
    }

    function numRates(address rateFeedId) external view returns (uint256) {
        return _rates[rateFeedId].reporters;
    }
}
