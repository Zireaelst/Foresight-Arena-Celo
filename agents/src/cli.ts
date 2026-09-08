import {PoolClient} from './core/pool.js';
import {AgentRunner} from './core/runner.js';
import {isPlaceholder} from './core/attribution.js';
import type {AgentBudget, ForesightAgent} from './core/types.js';
import {PriceSentinel} from './agents/price-sentinel/index.js';
import {ChainPulse} from './agents/chain-pulse/index.js';
import {ScoreOracle} from './agents/score-oracle/index.js';
import {PurchasedScoreFeed} from './agents/score-oracle/marketFeed.js';
import {ScoreConsensus} from './agents/score-oracle/consensus.js';
import {DataMarketBuyer} from './x402/buyer.js';
import {AGENT_ROLES, contextFor, privateKeyFor, requireAddress, type Role} from './ops/wallets.js';

/**
 * Runs one cycle of the loop for one agent, or for all three.
 *
 *   npm run run:chain               # dry run against Celo Sepolia
 *   DRY_RUN=false npm run run:all
 *
 * Each agent runs from its OWN wallet and its own ERC-8004 identity. Sharing one key
 * across all three would have made the reputation record meaningless -- every agent's
 * wins and losses would land on the same id.
 */
async function main() {
  const requested = process.argv[2] ?? 'all';
  const selected: Role[] = requested === 'all' ? AGENT_ROLES : [requested as Role];

  for (const role of selected) {
    if (!AGENT_ROLES.includes(role)) {
      console.error(`Unknown agent "${role}". Known: ${AGENT_ROLES.join(', ')}, all`);
      process.exitCode = 1;
      return;
    }
  }

  const poolAddress = requireAddress('FORESIGHT_POOL_ADDRESS');
  const dryRun = process.env.DRY_RUN !== 'false';
  const budget: AgentBudget = {
    // Mirrors the pool's on-chain caps. The runner takes the smaller of the two, so
    // lowering these is safe and raising them above the contract's does nothing.
    maxStakePerPosition: BigInt(process.env.MAX_STAKE_PER_POSITION ?? 1_000_000),
    maxOpenExposure: BigInt(process.env.MAX_OPEN_EXPOSURE ?? 10_000_000),
    minConfidence: Number(process.env.MIN_CONFIDENCE ?? 0.15),
  };

  for (const role of selected) {
    const ctx = contextFor(role);
    const pool = new PoolClient(ctx, poolAddress);
    const stakeToken = await pool.stakeToken();
    const agent = build(role, ctx);

    // Recorded so the scorekeeper can attribute settlements to an ERC-8004 identity.
    // The agent itself never writes reputation -- the registry forbids self-feedback.
    const agentId = agentIdFor(role);
    if (agentId !== undefined) agent.agentId = agentId;

    console.log(
      `\n[${role}] network=${ctx.chainId}${ctx.isMainnet ? ' (MAINNET)' : ' (Celo Sepolia)'} ` +
        `wallet=${ctx.account} agentId=${agentId ?? 'unregistered'} ` +
        `tag=${ctx.attributionTag}${isPlaceholder(ctx.attributionTag) ? ' [PLACEHOLDER]' : ''} dryRun=${dryRun}`,
    );

    const runner = new AgentRunner(agent, {ctx, pool, stakeToken, budget, dryRun});
    console.log(`[${role}]`, await runner.runCycle());
  }
}

function build(role: Role, ctx: ReturnType<typeof contextFor>): ForesightAgent {
  switch (role) {
    case 'price-sentinel':
      return new PriceSentinel(ctx, requireAddress('MENTO_PRICE_RESOLVER_ADDRESS'));
    case 'chain-pulse':
      return new ChainPulse(ctx, requireAddress('CHAIN_METRIC_RESOLVER_ADDRESS'));
    case 'score-oracle':
      return new ScoreOracle(requireAddress('ATTESTED_SCORE_RESOLVER_ADDRESS'), scoreSource(ctx));
    default:
      throw new Error(`No constructor for role "${role}"`);
  }
}

/**
 * Buy the score report over x402 when a data market is configured, otherwise compute it
 * locally. Same report either way -- the difference is whether the agent pays for it.
 */
function scoreSource(ctx: ReturnType<typeof contextFor>) {
  const marketUrl = process.env.DATA_MARKET_URL?.trim();
  const asset = process.env.STAKE_TOKEN_ADDRESS?.trim();
  if (!marketUrl || !asset) return new ScoreConsensus();

  return new PurchasedScoreFeed(
    new DataMarketBuyer({
      privateKey: privateKeyFor('score-oracle'),
      chainId: ctx.chainId,
      baseUrl: marketUrl,
      asset,
      ...(process.env.DATA_MARKET_MAX_PRICE
        ? {maxPricePerCall: BigInt(process.env.DATA_MARKET_MAX_PRICE)}
        : {}),
    }),
    marketUrl,
  );
}

/** Written to .env by `npm run ops:register`. Undefined means "registered nowhere yet". */
function agentIdFor(role: Role): bigint | undefined {
  const raw = process.env[`${role.toUpperCase().replace(/-/g, '_')}_AGENT_ID`]?.trim();
  return raw ? BigInt(raw) : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
