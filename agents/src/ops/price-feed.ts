import {encodeFunctionData} from 'viem';

import {sendTaggedAndWait} from '../core/chain.js';
import {CELO_MAINNET_ID} from '../core/chain.js';
import {contextFor, requireAddress} from './wallets.js';
import {fetchQuotes, medianUsd, toFixed24} from './priceSources.js';

const testnetSortedOraclesAbi = [
  {
    type: 'function',
    name: 'reportPrice',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'rateFeedId', type: 'address'},
      {name: 'priceFixed', type: 'uint256'},
      {name: 'reporters', type: 'uint256'},
    ],
    outputs: [],
  },
] as const;

/**
 * Publishes CELO/USD to the testnet price feed.
 *
 * Only meaningful on Celo Sepolia, where Mento's own SortedOracles has not been updated in
 * over a year and the price resolver would otherwise void every market. On mainnet this
 * script refuses to run: there, the resolver reads Mento directly and nothing we publish
 * should be able to affect a settlement.
 *
 *   npm run ops:price-feed
 */
async function main() {
  const ctx = contextFor('deployer');
  if (ctx.chainId === CELO_MAINNET_ID) {
    throw new Error(
      'Refusing to run on mainnet: price markets there settle against Mento SortedOracles, ' +
        'and a script-written rate must never be able to influence that.',
    );
  }

  const feedAddress = requireAddress('TESTNET_PRICE_FEED_ADDRESS');
  const rateFeedId = requireAddress('PRICE_RATE_FEED_ID');

  const quotes = await fetchQuotes();
  if (quotes.length < 2) {
    throw new Error(`Only ${quotes.length} price source(s) answered; refusing to publish a single-source rate.`);
  }

  const usd = medianUsd(quotes);
  const priceFixed = toFixed24(usd);

  console.log(`quotes: ${quotes.map((q) => `${q.source}=${q.usd}`).join(' ')}`);
  console.log(`median: ${usd} USD -> ${priceFixed} (1e24-scaled), reporters=${quotes.length}`);

  const receipt = await sendTaggedAndWait(ctx, {
    to: feedAddress,
    data: encodeFunctionData({
      abi: testnetSortedOraclesAbi,
      functionName: 'reportPrice',
      args: [rateFeedId, priceFixed, BigInt(quotes.length)],
    }),
  });
  console.log(`published in ${receipt.transactionHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
