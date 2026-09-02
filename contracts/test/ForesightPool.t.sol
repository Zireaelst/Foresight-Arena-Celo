// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ForesightPool} from "../src/ForesightPool.sol";
import {Outcome} from "../src/interfaces/IOutcomeResolver.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockResolver} from "./mocks/MockResolver.sol";

contract ForesightPoolTest is Test {
    ForesightPool internal pool;
    MockUSDC internal usdc;
    MockResolver internal resolver;

    address internal owner = makeAddr("owner");
    address internal agentA = makeAddr("agentA"); // Fiyat Nobetcisi
    address internal agentB = makeAddr("agentB"); // Zincir Nabzi
    address internal human = makeAddr("human");

    uint64 internal closesAt;
    uint64 internal resolvesAt;

    function setUp() public {
        vm.warp(1_700_000_000);

        usdc = new MockUSDC();
        resolver = new MockResolver();
        pool = new ForesightPool(IERC20(address(usdc)), owner);

        vm.startPrank(owner);
        pool.setResolverApproval(address(resolver), true);
        pool.registerAgent(agentA, 1);
        pool.registerAgent(agentB, 2);
        vm.stopPrank();

        closesAt = uint64(block.timestamp + 1 hours);
        resolvesAt = uint64(block.timestamp + 2 hours);

        address[3] memory funded = [agentA, agentB, human];
        for (uint256 i = 0; i < funded.length; i++) {
            usdc.mint(funded[i], 100e6);
            vm.prank(funded[i]);
            usdc.approve(address(pool), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _createMarket() internal returns (uint256) {
        vm.prank(owner);
        return pool.createMarket("Will CELO be at or above $1 at settlement?", address(resolver), "", closesAt, resolvesAt);
    }

    function _stake(address who, uint256 id, ForesightPool.Side side, uint256 amount) internal {
        vm.prank(who);
        pool.stake(id, side, amount);
    }

    // ------------------------------------------------------------------
    // construction & access control
    // ------------------------------------------------------------------

    function test_constructor_rejectsNon6DecimalToken() public {
        // MockResolver is not a token at all; use a token that reports 18 decimals.
        Decimals18 token = new Decimals18();
        vm.expectRevert(abi.encodeWithSelector(ForesightPool.UnexpectedDecimals.selector, uint8(18)));
        new ForesightPool(IERC20(address(token)), owner);
    }

    function test_createMarket_allowsOwnerAndRegisteredAgents() public {
        _createMarket();

        vm.prank(agentA);
        uint256 id = pool.createMarket("agent-authored", address(resolver), "", closesAt, resolvesAt);
        assertEq(pool.getMarket(id).creator, agentA);
        assertEq(pool.marketCount(), 2);
    }

    function test_createMarket_rejectsUnregisteredCaller() public {
        vm.prank(human);
        vm.expectRevert(ForesightPool.NotMarketCreator.selector);
        pool.createMarket("q", address(resolver), "", closesAt, resolvesAt);
    }

    function test_createMarket_rejectsUnapprovedResolver() public {
        MockResolver rogue = new MockResolver();
        vm.prank(owner);
        vm.expectRevert(ForesightPool.ResolverNotApproved.selector);
        pool.createMarket("q", address(rogue), "", closesAt, resolvesAt);
    }

    function test_createMarket_rejectsShortTradingWindow() public {
        vm.prank(owner);
        vm.expectRevert(ForesightPool.TradingWindowTooShort.selector);
        pool.createMarket("q", address(resolver), "", uint64(block.timestamp + 1 minutes), resolvesAt);
    }

    function test_createMarket_rejectsResolveBeforeClose() public {
        vm.prank(owner);
        vm.expectRevert(ForesightPool.ResolveBeforeClose.selector);
        pool.createMarket("q", address(resolver), "", closesAt, closesAt - 1);
    }

    function test_createMarket_propagatesResolverConfigRejection() public {
        resolver.setRejectConfig(true);
        vm.prank(owner);
        vm.expectRevert(MockResolver.ConfigRejected.selector);
        pool.createMarket("q", address(resolver), hex"dead", closesAt, resolvesAt);
    }

    // ------------------------------------------------------------------
    // pari-mutuel payout maths
    // ------------------------------------------------------------------

    function test_pariMutuel_losingPoolIsDistributedProRata() public {
        uint256 id = _createMarket();

        // YES pool = 1.5 USDC (two stakers), NO pool = 1.0 USDC (one staker).
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        _stake(agentB, id, ForesightPool.Side.Yes, 0.5e6);
        _stake(human, id, ForesightPool.Side.No, 1e6);

        resolver.setNext(Outcome.Yes);
        vm.warp(resolvesAt);
        pool.resolve(id);

        // Total 2.5 USDC over a 1.5 USDC winning pool: each winner gets stake * 5/3.
        uint256 beforeA = usdc.balanceOf(agentA);
        vm.prank(agentA);
        uint256 payoutA = pool.claim(id);
        assertEq(payoutA, 1_666_666); // 1e6 * 2.5e6 / 1.5e6, floored
        assertEq(usdc.balanceOf(agentA) - beforeA, payoutA);

        vm.prank(agentB);
        uint256 payoutB = pool.claim(id);
        assertEq(payoutB, 833_333); // 0.5e6 * 2.5e6 / 1.5e6, floored

        // The loser gets nothing but the call still succeeds and clears their exposure.
        vm.prank(human);
        assertEq(pool.claim(id), 0);
        assertEq(pool.openExposure(human), 0);

        // Payouts never exceed what was staked; only floor-division dust is left behind.
        assertLe(payoutA + payoutB, 2.5e6);
        assertEq(usdc.balanceOf(address(pool)), 2.5e6 - payoutA - payoutB);
        assertLt(usdc.balanceOf(address(pool)), 10);
    }

    function test_previewPayout_matchesClaim() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        _stake(human, id, ForesightPool.Side.No, 0.25e6);

        resolver.setNext(Outcome.Yes);
        vm.warp(resolvesAt);
        pool.resolve(id);

        uint256 preview = pool.previewPayout(id, agentA);
        vm.prank(agentA);
        assertEq(pool.claim(id), preview);
        assertEq(pool.previewPayout(id, agentA), 0, "preview clears after claiming");
    }

    function test_hedgedAccountIsPaidOnlyForTheWinningLeg() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        _stake(agentA, id, ForesightPool.Side.No, 1e6);
        _stake(human, id, ForesightPool.Side.No, 1e6);

        resolver.setNext(Outcome.No);
        vm.warp(resolvesAt);
        pool.resolve(id);

        // NO pool is 2 of 3 total; agentA holds half of it.
        vm.prank(agentA);
        assertEq(pool.claim(id), 1.5e6);
        assertEq(pool.openExposure(agentA), 0, "both legs clear the exposure");
    }

    // ------------------------------------------------------------------
    // symbolic balance limits
    // ------------------------------------------------------------------

    function test_positionCap_isEnforcedCumulatively() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 0.6e6);

        vm.prank(agentA);
        vm.expectRevert(
            abi.encodeWithSelector(ForesightPool.PositionCapExceeded.selector, uint256(1.1e6), uint256(1e6))
        );
        pool.stake(id, ForesightPool.Side.Yes, 0.5e6);
    }

    function test_exposureCap_agentTierIsTenUnits() public {
        assertEq(pool.exposureCapOf(agentA), 10e6);

        // Ten separate 1-unit positions exhaust the agent cap.
        for (uint256 i = 0; i < 10; i++) {
            uint256 id = _createMarket();
            _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        }
        assertEq(pool.openExposure(agentA), 10e6);

        uint256 extra = _createMarket();
        vm.prank(agentA);
        vm.expectRevert(
            abi.encodeWithSelector(ForesightPool.ExposureCapExceeded.selector, uint256(10e6 + 1), uint256(10e6))
        );
        pool.stake(extra, ForesightPool.Side.Yes, 1);
    }

    function test_exposureCap_humanTierIsFiveUnits() public {
        assertEq(pool.exposureCapOf(human), 5e6);

        for (uint256 i = 0; i < 5; i++) {
            uint256 id = _createMarket();
            _stake(human, id, ForesightPool.Side.Yes, 1e6);
        }

        uint256 extra = _createMarket();
        vm.prank(human);
        vm.expectRevert(
            abi.encodeWithSelector(ForesightPool.ExposureCapExceeded.selector, uint256(5e6 + 1), uint256(5e6))
        );
        pool.stake(extra, ForesightPool.Side.Yes, 1);
    }

    function test_exposureIsFreedOnClaimSoCapitalRecycles() public {
        uint256 id = _createMarket();
        _stake(human, id, ForesightPool.Side.Yes, 1e6);
        _stake(agentA, id, ForesightPool.Side.No, 1e6);
        assertEq(pool.openExposure(human), 1e6);

        resolver.setNext(Outcome.Yes);
        vm.warp(resolvesAt);
        pool.resolve(id);
        vm.prank(human);
        pool.claim(id);

        assertEq(pool.openExposure(human), 0);
    }

    function test_deregisteredAgentFallsBackToHumanCap() public {
        vm.prank(owner);
        pool.deregisterAgent(agentA);
        assertEq(pool.exposureCapOf(agentA), 5e6);
    }

    // ------------------------------------------------------------------
    // settlement paths
    // ------------------------------------------------------------------

    function test_oneSidedBook_voidsAndRefundsInFull() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);

        resolver.setNext(Outcome.Yes); // ignored: nobody took the other side
        vm.warp(resolvesAt);
        assertEq(uint8(pool.resolve(id)), uint8(Outcome.Void));

        uint256 before = usdc.balanceOf(agentA);
        vm.prank(agentA);
        assertEq(pool.claim(id), 1e6);
        assertEq(usdc.balanceOf(agentA) - before, 1e6);
    }

    function test_resolverVoid_refundsBothSides() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        _stake(human, id, ForesightPool.Side.No, 0.4e6);

        resolver.setNext(Outcome.Void);
        vm.warp(resolvesAt);
        pool.resolve(id);

        vm.prank(agentA);
        assertEq(pool.claim(id), 1e6);
        vm.prank(human);
        assertEq(pool.claim(id), 0.4e6);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function test_resolve_revertsWhenResolverIsUndecided() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        _stake(human, id, ForesightPool.Side.No, 1e6);

        resolver.setNext(Outcome.Unresolved);
        vm.warp(resolvesAt);
        vm.expectRevert(ForesightPool.ResolverUndecided.selector);
        pool.resolve(id);

        // Retrying later succeeds once the data source has an answer.
        resolver.setNext(Outcome.No);
        pool.resolve(id);
        assertEq(uint8(pool.getMarket(id).outcome), uint8(Outcome.No));
    }

    function test_resolve_isPermissionless() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        _stake(human, id, ForesightPool.Side.No, 1e6);

        vm.warp(resolvesAt);
        vm.prank(makeAddr("passerby"));
        pool.resolve(id);
        assertEq(uint8(pool.getMarket(id).outcome), uint8(Outcome.Yes));
    }

    function test_resolve_revertsBeforeResolveTime() public {
        uint256 id = _createMarket();
        vm.warp(resolvesAt - 1);
        vm.expectRevert(ForesightPool.TooEarlyToResolve.selector);
        pool.resolve(id);
    }

    function test_resolve_isSingleShot() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        _stake(human, id, ForesightPool.Side.No, 1e6);
        vm.warp(resolvesAt);
        pool.resolve(id);

        resolver.setNext(Outcome.No);
        vm.expectRevert(ForesightPool.AlreadyResolved.selector);
        pool.resolve(id);
    }

    function test_voidMarket_byCreatorAndOwnerOnly() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);

        vm.prank(human);
        vm.expectRevert(ForesightPool.NotMarketCreator.selector);
        pool.voidMarket(id);

        vm.prank(owner);
        pool.voidMarket(id);

        vm.prank(agentA);
        assertEq(pool.claim(id), 1e6);
    }

    // ------------------------------------------------------------------
    // staking guards
    // ------------------------------------------------------------------

    function test_stake_rejectedAfterClose() public {
        uint256 id = _createMarket();
        vm.warp(closesAt);
        vm.prank(agentA);
        vm.expectRevert(ForesightPool.MarketClosed.selector);
        pool.stake(id, ForesightPool.Side.Yes, 1e6);
    }

    function test_stake_rejectsZeroAmount() public {
        uint256 id = _createMarket();
        vm.prank(agentA);
        vm.expectRevert(ForesightPool.ZeroAmount.selector);
        pool.stake(id, ForesightPool.Side.Yes, 0);
    }

    function test_stake_rejectsUnknownMarket() public {
        vm.prank(agentA);
        vm.expectRevert(ForesightPool.UnknownMarket.selector);
        pool.stake(42, ForesightPool.Side.Yes, 1e6);
    }

    function test_claim_isSingleShot() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        vm.warp(resolvesAt);
        pool.resolve(id);

        vm.prank(agentA);
        pool.claim(id);
        vm.prank(agentA);
        vm.expectRevert(ForesightPool.NothingToClaim.selector);
        pool.claim(id);
    }

    function test_claim_revertsBeforeSettlement() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        vm.prank(agentA);
        vm.expectRevert(ForesightPool.NotResolved.selector);
        pool.claim(id);
    }

    // ------------------------------------------------------------------
    // pause semantics: staking halts, money already in never gets stuck
    // ------------------------------------------------------------------

    function test_pause_blocksStakingButNotSettlementOrClaims() public {
        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, 1e6);
        _stake(human, id, ForesightPool.Side.No, 1e6);

        vm.prank(owner);
        pool.pause();

        vm.prank(agentB);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.stake(id, ForesightPool.Side.Yes, 1e6);

        vm.warp(resolvesAt);
        pool.resolve(id); // settlement still works
        vm.prank(agentA);
        assertEq(pool.claim(id), 2e6); // and so does withdrawing
    }

    function test_onlyOwnerAdminSurface() public {
        vm.startPrank(human);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, human));
        pool.registerAgent(human, 9);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, human));
        pool.setResolverApproval(address(resolver), false);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, human));
        pool.pause();
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // fuzz: the pool is a pure redistribution vault
    // ------------------------------------------------------------------

    /// @dev The core solvency property: whatever the split, total payouts never exceed
    ///      total stakes. Any shortfall is floor-division dust, bounded by one unit per
    ///      claimant.
    function testFuzz_payoutsNeverExceedStakes(uint96 yesA, uint96 yesB, uint96 noC, bool yesWins) public {
        yesA = uint96(bound(yesA, 1, 1e6));
        yesB = uint96(bound(yesB, 1, 1e6));
        noC = uint96(bound(noC, 1, 1e6));

        uint256 id = _createMarket();
        _stake(agentA, id, ForesightPool.Side.Yes, yesA);
        _stake(agentB, id, ForesightPool.Side.Yes, yesB);
        _stake(human, id, ForesightPool.Side.No, noC);

        uint256 totalStaked = uint256(yesA) + yesB + noC;
        assertEq(usdc.balanceOf(address(pool)), totalStaked);

        resolver.setNext(yesWins ? Outcome.Yes : Outcome.No);
        vm.warp(resolvesAt);
        pool.resolve(id);

        uint256 paid;
        address[3] memory claimants = [agentA, agentB, human];
        for (uint256 i = 0; i < claimants.length; i++) {
            vm.prank(claimants[i]);
            paid += pool.claim(id);
            assertEq(pool.openExposure(claimants[i]), 0);
        }

        assertLe(paid, totalStaked, "pool paid out more than was staked");
        assertLe(totalStaked - paid, claimants.length, "dust exceeds one unit per claimant");
        assertEq(usdc.balanceOf(address(pool)), totalStaked - paid);
    }
}

/// @dev Minimal 18-decimal token for the constructor guard test.
contract Decimals18 {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}
