// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IOutcomeResolver, Outcome} from "./interfaces/IOutcomeResolver.sol";

/// @title ForesightPool -- pari-mutuel forecasting pools for autonomous agents on Celo
/// @notice Agents (and, from Phase 5, humans) stake a stablecoin on YES or NO of an
///         objective question. At settlement the losing pool is distributed to the
///         winning pool pro-rata, so a winner receives
///
///             payout = stake * (yesPool + noPool) / winningPool
///
///         There is no house, no maker/taker and no fee: the contract is a pure
///         redistribution vault. Whatever is staked is what can be paid out.
///
/// @dev Deliberate v1 scope limits (see CLAUDE.md "Sert kurallar"):
///      - Balances are symbolic. Per-position and per-account exposure caps are
///        enforced on-chain, not merely by convention.
///      - Only objective, data-fed questions. Settlement is delegated to an
///        `IOutcomeResolver`; no human arbiter, no dispute window.
///      - A one-sided book (nobody took the other side) settles to `Void` and
///        everyone is refunded, rather than paying a "winner" who risked nothing.
contract ForesightPool is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @dev Indices into the per-account stake array. Keep the numeric values stable:
    ///      `stakes[marketId][account][uint8(side)]`.
    enum Side {
        No,
        Yes
    }

    struct Market {
        address creator;
        address resolver;
        uint64 closesAt; // staking stops
        uint64 resolvesAt; // settlement may be attempted
        Outcome outcome;
        uint128 yesPool;
        uint128 noPool;
        string question;
        bytes resolverConfig;
    }

    // ---------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------

    /// @notice Stake token. Locked to a 6-decimal stablecoin (USDC on Celo) so the
    ///         symbolic-balance constants below are unambiguous.
    IERC20 public immutable stakeToken;

    /// @notice Maximum a single account may hold on a single side of a single market.
    uint256 public constant MAX_STAKE_PER_POSITION = 1e6; // 1.00 USDC

    /// @notice Maximum simultaneous unsettled exposure for a registered agent wallet.
    uint256 public constant MAX_OPEN_EXPOSURE_AGENT = 10e6; // 10.00 USDC

    /// @notice Maximum simultaneous unsettled exposure for a human participant.
    uint256 public constant MAX_OPEN_EXPOSURE_HUMAN = 5e6; // 5.00 USDC

    /// @notice Shortest allowed gap between market creation and close, so a market
    ///         cannot be opened and closed inside one block to grief stakers.
    uint64 public constant MIN_TRADING_WINDOW = 5 minutes;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    Market[] private _markets;

    /// @dev marketId => account => [noStake, yesStake]
    mapping(uint256 => mapping(address => uint128[2])) private _stakes;

    /// @dev marketId => account => already claimed
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    /// @notice Total staked-and-unclaimed amount per account, across all markets.
    mapping(address => uint256) public openExposure;

    /// @notice ERC-8004 agent id for a registered agent wallet. Zero means "not an agent",
    ///         which is the human tier: lower exposure cap, no market-creation rights.
    mapping(address => uint256) public agentIdOf;

    /// @notice Resolver contracts the team has vetted. A market may only point at one of these.
    mapping(address => bool) public isApprovedResolver;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event AgentRegistered(address indexed wallet, uint256 indexed agentId);
    event AgentDeregistered(address indexed wallet, uint256 indexed agentId);
    event ResolverApprovalSet(address indexed resolver, bool approved);
    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        address indexed resolver,
        uint64 closesAt,
        uint64 resolvesAt,
        string question
    );
    event Staked(uint256 indexed marketId, address indexed account, Side side, uint256 amount);
    event MarketResolved(uint256 indexed marketId, Outcome outcome, uint256 yesPool, uint256 noPool);
    event Claimed(uint256 indexed marketId, address indexed account, uint256 payout);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error UnexpectedDecimals(uint8 actual);
    error NotMarketCreator();
    error UnknownMarket();
    error ResolverNotApproved();
    error TradingWindowTooShort();
    error ResolveBeforeClose();
    error MarketClosed();
    error TooEarlyToResolve();
    error AlreadyResolved();
    error NotResolved();
    error ZeroAmount();
    error PositionCapExceeded(uint256 attempted, uint256 cap);
    error ExposureCapExceeded(uint256 attempted, uint256 cap);
    error NothingToClaim();
    error ResolverUndecided();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(IERC20 stakeToken_, address owner_) Ownable(owner_) {
        uint8 decimals_ = IERC20Metadata(address(stakeToken_)).decimals();
        // The symbolic-limit constants above are written in 6-decimal units.
        if (decimals_ != 6) revert UnexpectedDecimals(decimals_);
        stakeToken = stakeToken_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Grant an agent wallet the agent tier (higher exposure cap, may create markets).
    /// @param agentId The wallet's ERC-8004 Identity Registry token id. Must be non-zero.
    function registerAgent(address wallet, uint256 agentId) external onlyOwner {
        require(agentId != 0, "agentId=0");
        agentIdOf[wallet] = agentId;
        emit AgentRegistered(wallet, agentId);
    }

    function deregisterAgent(address wallet) external onlyOwner {
        uint256 previous = agentIdOf[wallet];
        delete agentIdOf[wallet];
        emit AgentDeregistered(wallet, previous);
    }

    /// @notice Whitelist a resolver contract. This is the on-chain enforcement of the
    ///         "objective questions only" guardrail: agents may open markets freely, but
    ///         only against settlement logic the team has reviewed.
    function setResolverApproval(address resolver, bool approved) external onlyOwner {
        isApprovedResolver[resolver] = approved;
        emit ResolverApprovalSet(resolver, approved);
    }

    /// @notice Halt new staking. Claims and settlement stay open by design, so a pause
    ///         can never strand funds that are already staked.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Market lifecycle
    // ---------------------------------------------------------------------

    /// @notice Open a market. Callable by the owner or by any registered agent wallet.
    function createMarket(
        string calldata question,
        address resolver,
        bytes calldata resolverConfig,
        uint64 closesAt,
        uint64 resolvesAt
    ) external whenNotPaused returns (uint256 marketId) {
        if (msg.sender != owner() && agentIdOf[msg.sender] == 0) revert NotMarketCreator();
        if (!isApprovedResolver[resolver]) revert ResolverNotApproved();
        if (closesAt < block.timestamp + MIN_TRADING_WINDOW) revert TradingWindowTooShort();
        if (resolvesAt < closesAt) revert ResolveBeforeClose();

        // Fail loudly at creation rather than silently voiding at settlement.
        IOutcomeResolver(resolver).validateConfig(resolverConfig);

        marketId = _markets.length;
        _markets.push(
            Market({
                creator: msg.sender,
                resolver: resolver,
                closesAt: closesAt,
                resolvesAt: resolvesAt,
                outcome: Outcome.Unresolved,
                yesPool: 0,
                noPool: 0,
                question: question,
                resolverConfig: resolverConfig
            })
        );

        emit MarketCreated(marketId, msg.sender, resolver, closesAt, resolvesAt, question);
    }

    /// @notice Take a position. Requires a prior ERC-20 approval for `amount`.
    function stake(uint256 marketId, Side side, uint256 amount) external nonReentrant whenNotPaused {
        Market storage m = _market(marketId);
        if (block.timestamp >= m.closesAt) revert MarketClosed();
        if (m.outcome != Outcome.Unresolved) revert AlreadyResolved();
        if (amount == 0) revert ZeroAmount();

        uint256 newPosition = uint256(_stakes[marketId][msg.sender][uint8(side)]) + amount;
        if (newPosition > MAX_STAKE_PER_POSITION) {
            revert PositionCapExceeded(newPosition, MAX_STAKE_PER_POSITION);
        }

        uint256 cap = exposureCapOf(msg.sender);
        uint256 newExposure = openExposure[msg.sender] + amount;
        if (newExposure > cap) revert ExposureCapExceeded(newExposure, cap);

        // All three casts are bounded well below uint128: `newPosition` is capped by
        // MAX_STAKE_PER_POSITION (1e6) above, and each pool is the sum of such positions,
        // which cannot reach 2^128 with any realistic participant count.
        // forge-lint: disable-next-line(unsafe-typecast)
        _stakes[marketId][msg.sender][uint8(side)] = uint128(newPosition);
        openExposure[msg.sender] = newExposure;
        if (side == Side.Yes) {
            // forge-lint: disable-next-line(unsafe-typecast)
            m.yesPool += uint128(amount);
        } else {
            // forge-lint: disable-next-line(unsafe-typecast)
            m.noPool += uint128(amount);
        }

        // Pull last: all accounting above is done against checked arithmetic.
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(marketId, msg.sender, side, amount);
    }

    /// @notice Settle a market. Permissionless -- anyone may trigger settlement once the
    ///         market's data is available, which keeps the pool alive even if every agent
    ///         goes offline.
    function resolve(uint256 marketId) external nonReentrant returns (Outcome outcome) {
        Market storage m = _market(marketId);
        if (m.outcome != Outcome.Unresolved) revert AlreadyResolved();
        if (block.timestamp < m.resolvesAt) revert TooEarlyToResolve();

        // A one-sided book has no counterparty risk to redistribute. Refund rather than
        // hand a free "win" to whoever showed up alone.
        if (m.yesPool == 0 || m.noPool == 0) {
            outcome = Outcome.Void;
        } else {
            outcome = IOutcomeResolver(m.resolver).resolve(m.resolverConfig);
            if (outcome == Outcome.Unresolved) revert ResolverUndecided();
        }

        m.outcome = outcome;
        emit MarketResolved(marketId, outcome, m.yesPool, m.noPool);
    }

    /// @notice Cancel an unsettled market. Stakers are refunded in full via `claim`.
    /// @dev Escape hatch for a market whose question turns out to be ambiguous or whose
    ///      data source dies. Restricted to the creator and the team.
    function voidMarket(uint256 marketId) external {
        Market storage m = _market(marketId);
        if (msg.sender != m.creator && msg.sender != owner()) revert NotMarketCreator();
        if (m.outcome != Outcome.Unresolved) revert AlreadyResolved();

        m.outcome = Outcome.Void;
        emit MarketResolved(marketId, Outcome.Void, m.yesPool, m.noPool);
    }

    /// @notice Withdraw winnings (or a refund, for a voided market).
    function claim(uint256 marketId) external nonReentrant returns (uint256 payout) {
        Market storage m = _market(marketId);
        if (m.outcome == Outcome.Unresolved) revert NotResolved();
        if (hasClaimed[marketId][msg.sender]) revert NothingToClaim();

        uint128[2] storage position = _stakes[marketId][msg.sender];
        uint256 noStake = position[uint8(Side.No)];
        uint256 yesStake = position[uint8(Side.Yes)];
        uint256 staked = noStake + yesStake;
        if (staked == 0) revert NothingToClaim();

        hasClaimed[marketId][msg.sender] = true;
        openExposure[msg.sender] -= staked;

        if (m.outcome == Outcome.Void) {
            payout = staked;
        } else {
            uint256 winningStake = m.outcome == Outcome.Yes ? yesStake : noStake;
            if (winningStake == 0) {
                // Lost the whole position; the stake stays in the pool for the winners.
                emit Claimed(marketId, msg.sender, 0);
                return 0;
            }
            uint256 winningPool = m.outcome == Outcome.Yes ? m.yesPool : m.noPool;
            // Floor division. Sub-wei dust accumulates in the contract rather than
            // letting the last claimer fail on a rounded-up transfer.
            payout = Math.mulDiv(winningStake, uint256(m.yesPool) + m.noPool, winningPool);
        }

        stakeToken.safeTransfer(msg.sender, payout);
        emit Claimed(marketId, msg.sender, payout);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    function stakeOf(uint256 marketId, address account, Side side) external view returns (uint256) {
        return _stakes[marketId][account][uint8(side)];
    }

    /// @notice Exposure cap for `account`: the agent tier if it holds an ERC-8004 id,
    ///         otherwise the (lower) human tier.
    function exposureCapOf(address account) public view returns (uint256) {
        return agentIdOf[account] == 0 ? MAX_OPEN_EXPOSURE_HUMAN : MAX_OPEN_EXPOSURE_AGENT;
    }

    /// @notice What `account` would receive from `claim` right now. Zero before settlement.
    function previewPayout(uint256 marketId, address account) external view returns (uint256) {
        Market storage m = _market(marketId);
        if (m.outcome == Outcome.Unresolved || hasClaimed[marketId][account]) return 0;

        uint256 noStake = _stakes[marketId][account][uint8(Side.No)];
        uint256 yesStake = _stakes[marketId][account][uint8(Side.Yes)];
        if (m.outcome == Outcome.Void) return noStake + yesStake;

        uint256 winningStake = m.outcome == Outcome.Yes ? yesStake : noStake;
        if (winningStake == 0) return 0;
        uint256 winningPool = m.outcome == Outcome.Yes ? m.yesPool : m.noPool;
        return Math.mulDiv(winningStake, uint256(m.yesPool) + m.noPool, winningPool);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _market(uint256 marketId) private view returns (Market storage) {
        if (marketId >= _markets.length) revert UnknownMarket();
        return _markets[marketId];
    }
}
