import {chainNow, type ChainContext} from './chain.js';
import type {PoolClient} from './pool.js';
import type {ReputationClient} from './reputation.js';
import {scoreFromSettlement} from './reputation.js';
import {Outcome, Side, type AgentBudget, type ForesightAgent, type MarketView, type SettlementReport} from './types.js';

export interface RunnerOptions {
  ctx: ChainContext;
  pool: PoolClient;
  reputation: ReputationClient;
  stakeToken: `0x${string}`;
  budget: AgentBudget;
  /** When true, everything is computed and logged but nothing is broadcast. */
  dryRun?: boolean;
  log?: (message: string, data?: unknown) => void;
}

export interface CycleResult {
  researched: number;
  staked: number;
  resolved: number;
  claimed: number;
  feedback: number;
  skipped: {marketId: bigint; reason: string}[];
}

/**
 * Drives one agent through one full cycle of the loop:
 *
 *   research -> position -> settle -> reputation
 *
 * The runner, not the agent, owns everything that costs money. An agent can be as
 * confident as it likes; the caps enforced here (and again in the contract) are what keep
 * balances symbolic.
 */
export class AgentRunner {
  private readonly log: (message: string, data?: unknown) => void;
  /** Remembers which side the agent took, so settlement can score the call. */
  private readonly calls = new Map<string, {side: Side; rationale: string; sources: string[]}>();

  constructor(
    private readonly agent: ForesightAgent,
    private readonly options: RunnerOptions,
  ) {
    this.log = options.log ?? ((m, d) => console.log(`[${this.agent.name}] ${m}`, d ?? ''));
  }

  async runCycle(): Promise<CycleResult> {
    const result: CycleResult = {researched: 0, staked: 0, resolved: 0, claimed: 0, feedback: 0, skipped: []};
    const markets = await this.options.pool.listMarkets();
    const now = await chainNow(this.options.ctx);

    for (let market of markets) {
      if (!this.agent.isInScope(market)) continue;

      if (market.outcome === Outcome.Unresolved && now < market.closesAt) {
        const took = await this.tryPosition(market, result);
        if (took) result.staked++;
        result.researched++;
      } else if (market.outcome === Outcome.Unresolved && now >= market.resolvesAt) {
        if (await this.trySettle(market)) {
          result.resolved++;
          // Re-read: the in-memory copy still says Unresolved, and claiming in the same
          // cycle is the difference between one round trip and one whole cycle of delay.
          market = await this.options.pool.getMarket(market.id);
        }
      }

      if (market.outcome !== Outcome.Unresolved) {
        const report = await this.tryClaim(market);
        if (report) {
          result.claimed++;
          if (await this.tryReputation(report)) result.feedback++;
        }
      }
    }

    return result;
  }

  // -- step 1 + 2: research, then position ------------------------------

  private async tryPosition(market: MarketView, result: CycleResult): Promise<boolean> {
    const research = await this.agent.research(market);
    const intent = await this.agent.position(market, research);

    if (intent.kind === 'pass') {
      result.skipped.push({marketId: market.id, reason: intent.reason});
      return false;
    }

    if (research.confidence < this.options.budget.minConfidence) {
      result.skipped.push({
        marketId: market.id,
        reason: `confidence ${research.confidence.toFixed(2)} below floor ${this.options.budget.minConfidence}`,
      });
      return false;
    }

    const amount = await this.clampStake(market, intent.side, intent.amount);
    if (amount <= 0n) {
      result.skipped.push({marketId: market.id, reason: 'no headroom left under the exposure caps'});
      return false;
    }

    this.log(`stake ${amount} on ${Side[intent.side]} of market ${market.id}`, {
      rationale: research.rationale,
      sources: research.sources,
    });

    if (this.options.dryRun) return false;

    await this.options.pool.ensureAllowance(this.options.stakeToken, amount);
    await this.options.pool.stake(market.id, intent.side, amount);
    this.calls.set(market.id.toString(), {
      side: intent.side,
      rationale: research.rationale,
      sources: research.sources,
    });
    return true;
  }

  /**
   * Reduces a requested stake to what is actually permissible.
   *
   * Three ceilings apply and the smallest wins: the local budget, the pool's per-position
   * cap net of what the agent already holds, and the pool's exposure cap net of the
   * agent's open exposure. The contract enforces the last two as well -- clamping here
   * just means the transaction does not have to revert to find that out.
   */
  private async clampStake(market: MarketView, side: Side, requested: bigint): Promise<bigint> {
    const {pool, ctx, budget} = this.options;
    const [limits, existing, exposure, balance] = await Promise.all([
      pool.onChainLimits(ctx.account),
      pool.stakeOf(market.id, ctx.account, side),
      pool.openExposure(ctx.account),
      pool.balanceOf(this.options.stakeToken),
    ]);

    const positionHeadroom = min(budget.maxStakePerPosition, limits.maxPerPosition) - existing;
    const exposureHeadroom = min(budget.maxOpenExposure, limits.maxExposure) - exposure;

    return maxOfZero(min(min(requested, positionHeadroom), min(exposureHeadroom, balance)));
  }

  // -- step 3: settle ----------------------------------------------------

  private async trySettle(market: MarketView): Promise<boolean> {
    this.log(`resolving market ${market.id}`);
    if (this.options.dryRun) return false;
    try {
      await this.options.pool.resolve(market.id);
      return true;
    } catch (error) {
      // Expected when the data source has no answer yet (ResolverUndecided). The next
      // cycle retries; nothing is lost by waiting.
      this.log(`market ${market.id} not settleable yet`, describeError(error));
      return false;
    }
  }

  private async tryClaim(market: MarketView): Promise<SettlementReport | null> {
    const {pool, ctx} = this.options;
    if (await pool.hasClaimed(market.id, ctx.account)) return null;

    const [yesStake, noStake] = await Promise.all([
      pool.stakeOf(market.id, ctx.account, Side.Yes),
      pool.stakeOf(market.id, ctx.account, Side.No),
    ]);
    const staked = yesStake + noStake;
    if (staked === 0n) return null;

    const payout = await pool.previewPayout(market.id, ctx.account);
    this.log(`claiming market ${market.id}: staked ${staked}, payout ${payout}`);
    if (this.options.dryRun) return null;

    await pool.claim(market.id);

    const call = this.calls.get(market.id.toString());
    const side = call?.side ?? (yesStake >= noStake ? Side.Yes : Side.No);
    const calledCorrectly =
      market.outcome === Outcome.Yes ? side === Side.Yes : market.outcome === Outcome.No ? side === Side.No : false;

    return {marketId: market.id, outcome: market.outcome, payout, staked, calledCorrectly};
  }

  // -- step 4: reputation ------------------------------------------------

  private async tryReputation(report: SettlementReport): Promise<boolean> {
    const agentId = this.agent.agentId;
    if (agentId === undefined) {
      this.log('skipping reputation write: agent is not registered in the ERC-8004 Identity Registry yet');
      return false;
    }

    const call = this.calls.get(report.marketId.toString());
    await this.options.reputation.giveFeedback({
      agentId,
      score: scoreFromSettlement(report),
      marketId: report.marketId,
      outcome: report.outcome,
      calledCorrectly: report.calledCorrectly,
      payout: report.payout,
      staked: report.staked,
      rationale: call?.rationale ?? '(rationale not recorded in this process)',
      sources: call?.sources ?? [],
    });

    await this.agent.onSettled?.(report);
    return true;
  }
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function maxOfZero(a: bigint): bigint {
  return a > 0n ? a : 0n;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0]! : String(error);
}
