import {wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader} from '@x402/fetch';
import {ExactEvmScheme} from '@x402/evm/exact/client';
import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';

/**
 * The buying half of the x402 integration.
 *
 * An agent asks for a resource, receives HTTP 402 with the price, signs an EIP-3009
 * authorization, and retries -- all inside one call. The agent pays no gas: the
 * facilitator relays the authorization, which is the property that makes per-request
 * pricing at fractions of a cent workable at all.
 *
 * This is the part of the design where the agents genuinely spend their own money on
 * something other than a bet: they buy the research they then stake on.
 */
export interface BuyerOptions {
  privateKey: Hex;
  chainId: number;
  /** Base URL of the data market, e.g. http://127.0.0.1:4021 */
  baseUrl: string;
  /** Stake-token address the agent is willing to be charged in. */
  asset: string;
  /**
   * Hard ceiling per purchase, in the asset's base units.
   *
   * The x402 client refuses unknown assets by default, so allowing ours means opting in
   * explicitly -- and opting in without a cap would let a compromised or buggy seller
   * name any price and have an unattended agent sign it. The cap is the agent's own
   * limit, checked before it signs anything.
   */
  maxPricePerCall?: bigint;
}

export interface PurchaseResult<T> {
  data: T;
  /** Present when the response actually carried a settlement receipt. */
  receipt?: {transaction: string; network: string; payer?: string; amount?: string};
  /** False when the resource turned out not to be priced at all. */
  paid: boolean;
}

export class DataMarketBuyer {
  private readonly fetchWithPayment: ReturnType<typeof wrapFetchWithPaymentFromConfig>;
  readonly address: `0x${string}`;

  constructor(private readonly options: BuyerOptions) {
    const account = privateKeyToAccount(options.privateKey);
    this.address = account.address;

    const network = `eip155:${options.chainId}` as const;
    this.fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{network, client: new ExactEvmScheme(account)}],
      spendControls: {
        allowedAssets: [
          {
            network,
            asset: options.asset,
            maxAmountPerPayment: (options.maxPricePerCall ?? 100_000n).toString(),
          },
        ],
      },
    });
  }

  /**
   * Buys one score-consensus report.
   *
   * @throws when the market answers with anything other than success. A failed purchase
   *         must be loud: an agent that silently proceeded without the data it paid for
   *         would be staking on nothing.
   */
  async buyScoreReport(params: {
    league: string;
    kickoffDate: string;
    homeTeam: string;
    awayTeam: string;
    condition: string;
  }): Promise<PurchaseResult<unknown>> {
    const query = new URLSearchParams(params).toString();
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/reports/score-consensus?${query}`;

    const response = await this.fetchWithPayment(url);
    if (!response.ok) {
      throw new Error(`Data market returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    // The v2 header is `payment-response`; v1 servers used `x-payment-response`.
    const header =
      response.headers.get('payment-response') ?? response.headers.get('x-payment-response');
    const receipt = header ? safeDecode(header) : undefined;

    return {
      data: await response.json(),
      ...(receipt ? {receipt} : {}),
      paid: Boolean(receipt),
    };
  }
}

/** A receipt we cannot read is not worth failing a paid-for response over. */
function safeDecode(header: string) {
  try {
    const decoded = decodePaymentResponseHeader(header) as {
      transaction?: string;
      network?: string;
      payer?: string;
      amount?: string;
    };
    return decoded?.transaction
      ? {
          transaction: decoded.transaction,
          network: decoded.network ?? '',
          ...(decoded.payer ? {payer: decoded.payer} : {}),
          ...(decoded.amount ? {amount: decoded.amount} : {}),
        }
      : undefined;
  } catch {
    return undefined;
  }
}
