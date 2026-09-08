import express, {type Express} from 'express';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseSignature,
  type Address,
  type Hex,
} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {celo, celoSepolia} from 'viem/chains';

/**
 * A self-hosted x402 facilitator for the "exact" EVM scheme.
 *
 * Celo runs a facilitator at api.x402.celo.org, but it requires an API key issued at
 * registration. Rather than make the payment path depend on a credential we may not
 * have, this project ships the facilitator it needs. The HTTP contract is the one
 * `HTTPFacilitatorClient` speaks -- `GET /supported`, `POST /verify`, `POST /settle` --
 * so pointing the resource server at Celo's facilitator instead is a URL change and
 * nothing else.
 *
 * What a facilitator actually does here is narrow: it checks that a signed EIP-3009
 * authorization really pays the right merchant the right amount in the right asset, then
 * relays it on chain and pays the gas. It never holds funds -- the authorization moves
 * tokens directly from payer to merchant -- so the worst a broken facilitator can do is
 * fail to settle.
 */

const EIP3009_ABI = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'from', type: 'address'},
      {name: 'to', type: 'address'},
      {name: 'value', type: 'uint256'},
      {name: 'validAfter', type: 'uint256'},
      {name: 'validBefore', type: 'uint256'},
      {name: 'nonce', type: 'bytes32'},
      {name: 'v', type: 'uint8'},
      {name: 'r', type: 'bytes32'},
      {name: 's', type: 'bytes32'},
    ],
    outputs: [],
  },
] as const;

interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

/**
 * The x402 v2 payment payload.
 *
 * Note where the scheme and network actually live: under `accepted` (the requirement the
 * client chose to satisfy), not at the top level. v1 put them at the top, so both are
 * read with a fallback.
 */
interface PaymentPayload {
  x402Version: number;
  scheme?: string;
  network?: string;
  accepted?: {scheme?: string; network?: string; asset?: string; payTo?: string; amount?: string};
  payload: {signature: Hex; authorization: Authorization};
}

function schemeOf(payload: PaymentPayload): string | undefined {
  return payload.accepted?.scheme ?? payload.scheme;
}

function networkOf(payload: PaymentPayload): string | undefined {
  return payload.accepted?.network ?? payload.network;
}

interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}

export interface FacilitatorOptions {
  chainId: number;
  rpcUrl: string;
  /** Pays the gas for every settlement it relays. */
  privateKey: Hex;
  /** Log every decision. A payment path that fails silently cannot be debugged. */
  verbose?: boolean;
}

export function createFacilitator(options: FacilitatorOptions): Express {
  const chain = options.chainId === 42220 ? celo : celoSepolia;
  const network = `eip155:${options.chainId}`;
  const account = privateKeyToAccount(options.privateKey);
  const transport = http(options.rpcUrl);
  const publicClient = createPublicClient({chain, transport});
  const walletClient = createWalletClient({account, chain, transport});

  const app = express();
  app.use(express.json());

  const log = options.verbose === false ? () => {} : (...args: unknown[]) => console.log('[facilitator]', ...args);

  app.get('/supported', (_request, response) => {
    response.json({
      kinds: [{x402Version: 2, scheme: 'exact', network}],
      extensions: [],
      signers: {},
    });
  });

  app.post('/verify', async (request, response) => {
    if (process.env.X402_DEBUG) log('verify body', JSON.stringify(request.body).slice(0, 1200));
    const {paymentPayload, paymentRequirements} = request.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    const problem = checkRequirements(paymentPayload, paymentRequirements, network);
    if (problem) {
      log('verify REJECTED', problem.reason, '-', problem.message);
      return response.json({isValid: false, invalidReason: problem.reason, invalidMessage: problem.message});
    }

    // The decisive check is a simulation, not a re-derivation of the signature: whatever
    // the token would actually do is the only thing that matters, and it is the token
    // that enforces expiry, replay and signer.
    const simulation = await simulate(paymentPayload, paymentRequirements);
    if (!simulation.ok) {
      log('verify REJECTED settlement_would_revert -', simulation.message);
      return response.json({
        isValid: false,
        invalidReason: 'settlement_would_revert',
        invalidMessage: simulation.message,
        payer: paymentPayload.payload.authorization.from,
      });
    }

    log('verify OK payer', paymentPayload.payload.authorization.from, 'value', paymentPayload.payload.authorization.value);
    return response.json({isValid: true, payer: paymentPayload.payload.authorization.from});
  });

  app.post('/settle', async (request, response) => {
    const {paymentPayload, paymentRequirements} = request.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    const auth = paymentPayload.payload.authorization;

    const problem = checkRequirements(paymentPayload, paymentRequirements, network);
    if (problem) {
      return response.json({
        success: false,
        errorReason: problem.reason,
        errorMessage: problem.message,
        transaction: '',
        network,
        payer: auth.from,
      });
    }

    try {
      const {v, r, s} = parseSignature(paymentPayload.payload.signature);
      const hash = await walletClient.writeContract({
        address: getAddress(paymentRequirements.asset),
        abi: EIP3009_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          getAddress(auth.from),
          getAddress(auth.to),
          BigInt(auth.value),
          BigInt(auth.validAfter),
          BigInt(auth.validBefore),
          auth.nonce,
          Number(v ?? 27),
          r,
          s,
        ],
        chain,
        account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      log('settle', receipt.status, hash);

      return response.json({
        success: receipt.status === 'success',
        transaction: hash,
        network,
        payer: auth.from,
        amount: auth.value,
        ...(receipt.status === 'success' ? {} : {errorReason: 'reverted', errorMessage: 'Settlement reverted'}),
      });
    } catch (error) {
      log('settle FAILED', describe(error));
      return response.json({
        success: false,
        errorReason: 'settlement_failed',
        errorMessage: describe(error),
        transaction: '',
        network,
        payer: auth.from,
      });
    }
  });

  return app;

  async function simulate(payload: PaymentPayload, requirements: PaymentRequirements) {
    const auth = payload.payload.authorization;
    try {
      const {v, r, s} = parseSignature(payload.payload.signature);
      await publicClient.simulateContract({
        address: getAddress(requirements.asset),
        abi: EIP3009_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          getAddress(auth.from),
          getAddress(auth.to),
          BigInt(auth.value),
          BigInt(auth.validAfter),
          BigInt(auth.validBefore),
          auth.nonce,
          Number(v ?? 27),
          r,
          s,
        ],
        account,
      });
      return {ok: true as const};
    } catch (error) {
      return {ok: false as const, message: describe(error)};
    }
  }
}

/**
 * Cheap structural checks before touching the chain.
 *
 * These are the ones the token cannot make for us: it will happily execute a valid
 * authorization that pays the wrong person, or pays too little. Those are the resource
 * server's requirements, so the facilitator is where they get enforced.
 */
function checkRequirements(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  network: string,
): {reason: string; message: string} | null {
  const auth = payload.payload?.authorization;
  if (!auth) return {reason: 'malformed_payload', message: 'Payment payload carries no authorization.'};
  const scheme = schemeOf(payload);
  if (scheme !== 'exact') {
    return {reason: 'unsupported_scheme', message: `This facilitator only settles "exact"; got "${scheme}".`};
  }
  if (networkOf(payload) !== network || requirements.network !== network) {
    return {reason: 'unsupported_network', message: `This facilitator only settles on ${network}.`};
  }
  if (getAddress(auth.to) !== getAddress(requirements.payTo)) {
    return {reason: 'wrong_recipient', message: 'The authorization pays somebody other than the resource server.'};
  }
  if (BigInt(auth.value) < BigInt(requirements.amount)) {
    return {
      reason: 'insufficient_amount',
      message: `Authorization is for ${auth.value} but ${requirements.amount} is required.`,
    };
  }
  return null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n').slice(0, 2).join(' ').slice(0, 300);
  return String(error);
}
