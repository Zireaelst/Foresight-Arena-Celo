import express from 'express';
import {paymentMiddleware} from '@x402/express';
import {HTTPFacilitatorClient, x402ResourceServer} from '@x402/core/server';
import {ExactEvmScheme} from '@x402/evm/exact/server';
import type {Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';

import {createFacilitator} from './facilitator.js';
import {buildReport} from './report.js';

/**
 * The data market: a priced endpoint the agents buy from.
 *
 * What is sold is the one thing in this project that costs real work to produce -- the
 * cross-checked score consensus, with every source and a hash of exactly what was read.
 * That makes the x402 integration load-bearing rather than decorative: the Skor Kahini
 * agent pays for the report it then stakes on, and the receipt for that purchase is a
 * settled stablecoin transfer on Celo.
 *
 * Two processes, started together:
 *   - the facilitator (verifies and relays the EIP-3009 authorization)
 *   - the resource server (prices the route, returns 402, serves on payment)
 */
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11142220);
const RPC_URL = process.env.RPC_URL ?? 'https://forno.celo-sepolia.celo-testnet.org';
const NETWORK = `eip155:${CHAIN_ID}` as const;

const PORT = Number(process.env.DATA_MARKET_PORT ?? 4021);
const FACILITATOR_PORT = Number(process.env.FACILITATOR_PORT ?? 4022);

/** Paid to the seller; the deployer wallet doubles as the data vendor on testnet. */
const SELLER_KEY = required('DEPLOYER_PRIVATE_KEY') as Hex;
const ASSET = required('STAKE_TOKEN_ADDRESS');
const PRICE = process.env.DATA_MARKET_PRICE ?? '10000'; // 0.01 tUSDC, in base units

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Run the deploy first and fill agents/.env.`);
  return value;
}

async function main() {
  const seller = privateKeyToAccount(SELLER_KEY);

  // -- 1. the facilitator ------------------------------------------------
  const facilitatorUrl =
    process.env.X402_FACILITATOR_URL?.trim() ?? `http://127.0.0.1:${FACILITATOR_PORT}`;

  if (!process.env.X402_FACILITATOR_URL) {
    createFacilitator({chainId: CHAIN_ID, rpcUrl: RPC_URL, privateKey: SELLER_KEY}).listen(
      FACILITATOR_PORT,
      () => console.log(`facilitator   http://127.0.0.1:${FACILITATOR_PORT}  (self-hosted, ${NETWORK})`),
    );
  } else {
    console.log(`facilitator   ${facilitatorUrl}  (external)`);
  }

  // -- 2. the resource server -------------------------------------------
  const resourceServer = new x402ResourceServer(
    new HTTPFacilitatorClient({
      url: facilitatorUrl,
      // Celo's hosted facilitator authenticates with X-API-Key; the self-hosted one
      // needs nothing. Headers are declared per operation, not once for the client.
      ...(process.env.X402_API_KEY
        ? {
            createAuthHeaders: async () => {
              const headers = {'X-API-Key': process.env.X402_API_KEY!};
              return {verify: headers, settle: headers, supported: headers};
            },
          }
        : {}),
    }),
  ).register(NETWORK, new ExactEvmScheme());

  const app = express();

  app.get('/health', (_request, response) =>
    response.json({ok: true, network: NETWORK, seller: seller.address, asset: ASSET, price: PRICE}),
  );

  app.use(
    paymentMiddleware(
      {
        'GET /reports/score-consensus': {
          accepts: [
            {
              scheme: 'exact',
              network: NETWORK,
              payTo: seller.address,
              price: {asset: ASSET, amount: PRICE},
              maxTimeoutSeconds: 600,
              // The EIP-712 domain the payer must sign against. Published here so a
              // client need not guess it or make an extra round trip to the token.
              extra: {name: process.env.STAKE_TOKEN_NAME ?? 'Foresight Testnet USDC', version: '2'},
            },
          ],
          description:
            'Cross-checked final scoreline for one fixture: every independent source consulted, ' +
            'the exact reading from each, and a hash of the payload they agreed on.',
          mimeType: 'application/json',
          serviceName: 'Foresight Arena data market',
          tags: ['sports', 'consensus', 'oracle'],
        },
      },
      resourceServer,
    ),
  );

  app.get('/reports/score-consensus', async (request, response) => {
    const league = String(request.query.league ?? '');
    const kickoffDate = String(request.query.kickoffDate ?? '');
    const homeTeam = String(request.query.homeTeam ?? '');
    const awayTeam = String(request.query.awayTeam ?? '');
    const condition = String(request.query.condition ?? 'home_win');

    if (!league || !kickoffDate || !homeTeam || !awayTeam) {
      return response
        .status(400)
        .json({error: 'league, kickoffDate, homeTeam and awayTeam are all required.'});
    }

    try {
      return response.json(await buildReport({league, kickoffDate, homeTeam, awayTeam}, condition));
    } catch (error) {
      return response.status(500).json({error: error instanceof Error ? error.message : String(error)});
    }
  });

  app.listen(PORT, () => {
    console.log(`data market   http://127.0.0.1:${PORT}`);
    console.log(`  selling     GET /reports/score-consensus  @ ${PRICE} base units of ${ASSET}`);
    console.log(`  paid to     ${seller.address}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
