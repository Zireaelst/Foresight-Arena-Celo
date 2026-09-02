import {PoolClient} from './core/pool.js';
import {ReputationClient} from './core/reputation.js';
import {AgentRunner} from './core/runner.js';
import {loadConfig} from './core/config.js';
import {isPlaceholder} from './core/attribution.js';
import type {ForesightAgent} from './core/types.js';
import {PriceSentinel} from './agents/price-sentinel/index.js';
import {ChainPulse} from './agents/chain-pulse/index.js';
import {ScoreOracle} from './agents/score-oracle/index.js';

/**
 * Runs one cycle of the loop for one agent (or all three).
 *
 *   pnpm run:price          # dry run against Celo Sepolia
 *   DRY_RUN=false pnpm run:price
 */
async function main() {
  const which = process.argv[2] ?? 'all';
  const config = loadConfig();
  const {ctx} = config;

  const pool = new PoolClient(ctx, config.poolAddress);
  const reputation = new ReputationClient(ctx);
  const stakeToken = await pool.stakeToken();

  const agents: Record<string, () => ForesightAgent> = {
    'price-sentinel': () => new PriceSentinel(ctx, config.resolvers.price),
    'chain-pulse': () => new ChainPulse(ctx, config.resolvers.chain),
    'score-oracle': () => new ScoreOracle(config.resolvers.score),
  };

  const selected = which === 'all' ? Object.keys(agents) : [which];
  for (const name of selected) {
    if (!agents[name]) {
      console.error(`Unknown agent "${name}". Known: ${Object.keys(agents).join(', ')}, all`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `network=${ctx.chainId}${ctx.isMainnet ? ' (MAINNET)' : ' (Celo Sepolia)'} ` +
      `wallet=${ctx.account} stakeToken=${stakeToken} tag=${ctx.attributionTag}${isPlaceholder(ctx.attributionTag) ? ' [PLACEHOLDER]' : ''} ` +
      `dryRun=${config.dryRun}`,
  );

  for (const name of selected) {
    const runner = new AgentRunner(agents[name]!(), {
      ctx,
      pool,
      reputation,
      stakeToken,
      budget: config.budget,
      dryRun: config.dryRun,
    });
    const result = await runner.runCycle();
    console.log(`[${name}]`, result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
