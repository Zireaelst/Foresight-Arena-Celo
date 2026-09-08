import {chainNow, type ChainContext} from './chain.js';
import type {PoolClient} from './pool.js';
import {Outcome, Side, type AgentBudget, type ForesightAgent, type MarketView, type SettlementReport} from './types.js';

export interface RunnerOptions {
  ctx: ChainContext;
  pool: PoolClient;
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
  /** Settled markets this cycle, for the scorekeeper to score. The runner does not write
   *  reputation itself -- see the note on {@link AgentRunner}. */
  settlements: SettlementReport[];
  skipped: {marketId: bigint; reason: string}[];
}

/**
 * Drives one agent through one cycle:
 *
 *   research -> position -> settle -> claim
 *
 * The runner, not the agent, owns everything that costs money. An agent can be as
 * confident as it likes; the caps enforced here (and again in the contract) are what keep
 * balances symbolic.
 *
 * Reputation is deliberately NOT written here. The ERC-8004 Reputation Registry rejects
 * feedback from an agent's own wallet ("Self-feedback not allowed"), so an agent cannot
 * grade itself even if it wanted to. That job belongs to the independent scorekeeper
 * (src/ops/scorekeeper.ts), which derives every score from public chain state.
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
    const result: CycleResult = {researched: 0, staked: 0, resolved: 0, claimed: 0, settlements: [], skipped: []};
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
          result.settlements.push(report);
          await this.agent.onSettled?.(report);
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
