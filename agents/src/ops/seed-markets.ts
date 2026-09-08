import {encodeAbiParameters, encodeFunctionData, parseAbiParameters} from 'viem';

import {erc20Abi, foresightPoolAbi} from '../core/abi.js';
import {chainNow, sendTaggedAndWait} from '../core/chain.js';
import {loadFixtureRegistry} from '../agents/score-oracle/registry.js';
import {contextFor, requireAddress} from './wallets.js';
import {fetchQuotes, medianUsd, toFixed24} from './priceSources.js';

/**
 * Opens one market per showcase agent.
 *
 * Thresholds are derived from live data rather than hardcoded, so the demo markets are
 * genuinely uncertain. A market whose answer is already obvious teaches nobody anything
 * about whether the agents can forecast.
 *
 *   npm run ops:seed
 */
async function main() {
  const ctx = contextFor('deployer');
  const pool = requireAddress('FORESIGHT_POOL_ADDRESS');
  const now = await chainNow(ctx);

  // A short window so the whole loop can be demonstrated inside one sitting, but longer
  // than the pool's MIN_TRADING_WINDOW of five minutes.
  const closesAt = now + Number(process.env.SEED_TRADING_MINUTES ?? 20) * 60;
  const resolvesAt = closesAt + Number(process.env.SEED_SETTLE_MINUTES ?? 5) * 60;

  const created: string[] = [];

  // -- Fiyat Nöbetçisi: a threshold 2% above the current median ---------
  const priceResolver = process.env.MENTO_PRICE_RESOLVER_ADDRESS?.trim();
  const rateFeedId = process.env.PRICE_RATE_FEED_ID?.trim();
  if (priceResolver && rateFeedId) {
    const quotes = await fetchQuotes();
    if (quotes.length >= 2) {
      const spot = medianUsd(quotes);
      const threshold = toFixed24(spot * 1.02);
      const config = encodeAbiParameters(
        parseAbiParameters('(address rateFeedId, uint256 thresholdFixed, uint8 comparator, uint64 maxStaleness)'),
        [{rateFeedId: rateFeedId as `0x${string}`, thresholdFixed: threshold, comparator: 0, maxStaleness: 3600n}],
      );
      await create(
        `Will the CELO/USD oracle median be at or above $${(spot * 1.02).toFixed(5)} at settlement? ` +
          `(Spot was $${spot.toFixed(5)} when this market opened.)`,
        priceResolver,
        config,
      );
    } else {
      console.log('skipping the price market: fewer than two price sources answered.');
    }
  }

  // -- Zincir Nabzı: stake-token supply, threshold just above current ---
  const chainResolver = process.env.CHAIN_METRIC_RESOLVER_ADDRESS?.trim();
  if (chainResolver) {
    const stakeToken = await ctx.publicClient.readContract({
      address: pool,
      abi: foresightPoolAbi,
      functionName: 'stakeToken',
    });
    const supply = await ctx.publicClient.readContract({
      address: stakeToken,
      abi: erc20Abi,
      functionName: 'totalSupply',
    });
    // Above the current supply, so the answer depends on whether anyone else taps the
    // faucet before settlement -- an actual forecast about participation.
    const threshold = supply + 100_000_000n; // +100 tUSDC, i.e. two more faucet taps
    const config = encodeAbiParameters(
      parseAbiParameters('(address target, bytes callData, uint256 threshold, uint8 comparator)'),
      [{target: stakeToken, callData: '0x18160ddd', threshold, comparator: 0}],
    );
    await create(
      `Will the stake token's total supply be at or above ${threshold / 1_000_000n} tUSDC at settlement? ` +
        '(It rises only when someone taps the faucet, so this is a forecast about turnout.)',
      chainResolver,
      config,
    );
  }

  // -- Skor Kahini: the fixtures from the published registry ------------
  const scoreResolver = process.env.ATTESTED_SCORE_RESOLVER_ADDRESS?.trim();
  if (scoreResolver) {
    for (const entry of loadFixtureRegistry().values()) {
      const config = encodeAbiParameters(parseAbiParameters('(bytes32 eventKey)'), [{eventKey: entry.eventKey}]);

      // A football market must stop taking positions at kickoff. Leaving it open past the
      // whistle lets anyone read the score off a public API and stake against no risk --
      // which would not be forecasting, and would come straight out of the other side's
      // pocket. Settlement waits three hours, comfortably past full time plus stoppages.
      if (entry.kickoffAt !== undefined) {
        if (entry.kickoffAt <= now + 300) {
          console.log(`skipping "${entry.ref.homeTeam} v ${entry.ref.awayTeam}": kickoff is past or imminent.`);
          continue;
        }
        await create(entry.question, scoreResolver, config, entry.kickoffAt, entry.kickoffAt + 3 * 3600);
        continue;
      }

      // No kickoff recorded: an already-played fixture, kept for the settled record. Only
      // open one if explicitly asked, since its outcome is already public.
      if (process.env.SEED_SETTLED_FIXTURES !== 'true') {
        console.log(`skipping "${entry.ref.homeTeam} v ${entry.ref.awayTeam}": already played (no kickoff recorded).`);
        continue;
      }
      await create(entry.question, scoreResolver, config);
    }
  }

  console.log(`\nopened ${created.length} market(s):`);
  for (const line of created) console.log(`  ${line}`);

  async function create(
    question: string,
    resolver: string,
    config: `0x${string}`,
    closes = closesAt,
    resolves = resolvesAt,
  ) {
    const receipt = await sendTaggedAndWait(ctx, {
      to: pool,
      data: encodeFunctionData({
        abi: foresightPoolAbi,
        functionName: 'createMarket',
        args: [question, resolver as `0x${string}`, config, BigInt(closes), BigInt(resolves)],
      }),
    });
    created.push(`${receipt.transactionHash}  closes ${new Date(closes * 1000).toISOString().slice(0, 16)}Z  ${question.slice(0, 60)}…`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
