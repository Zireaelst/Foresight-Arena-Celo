import {DataMarketBuyer} from '../../x402/buyer.js';
import {Outcome} from '../../core/types.js';
import type {Condition, ConsensusResult} from './consensus.js';
import type {FixtureRef, Observation} from './providers/types.js';
import {conditionToString} from './consensus.js';

interface PurchasedReport {
  status: 'decided' | 'undecided';
  reason?: string;
  homeScore?: number;
  awayScore?: number;
  outcome?: keyof typeof Outcome;
  payloadHash?: `0x${string}`;
  payload?: string;
  sources?: {provider: string; url: string}[];
  observations?: Observation[];
  panel?: string[];
  quorum?: number;
}

/**
 * A score source that BUYS its data over x402 instead of computing it locally.
 *
 * This is what makes the payment layer load-bearing rather than a demo bolted on the
 * side: when `DATA_MARKET_URL` is configured, the Skor Kahini agent pays a fraction of a
 * cent for the cross-checked report it then stakes on, and the receipt for that purchase
 * is a settled stablecoin transfer on Celo.
 *
 * It deliberately does not fall back to computing the report itself when a purchase
 * fails. A quiet fallback would make the payment optional in practice while looking
 * mandatory in the logs -- and an agent that cannot obtain the data it paid for should
 * pass on the market, which is exactly what an `undecided` result makes it do.
 */
export class PurchasedScoreFeed {
  readonly quorum: number;

  constructor(
    private readonly buyer: DataMarketBuyer,
    /** Reported in rationales so a reader knows the data was bought, and from where. */
    readonly marketUrl: string,
    quorum = Number(process.env.SCORE_FEED_QUORUM ?? 2),
  ) {
    this.quorum = quorum;
  }

  /** Providers are the seller's, so they are only known after a purchase. */
  panelFor(): string[] {
    return ['x402:data-market'];
  }

  async resolve(ref: FixtureRef, condition: Condition): Promise<ConsensusResult> {
    let report: PurchasedReport;
    let receipt: string | undefined;

    try {
      const purchase = await this.buyer.buyScoreReport({
        league: ref.league,
        kickoffDate: ref.kickoffDate,
        homeTeam: ref.homeTeam,
        awayTeam: ref.awayTeam,
        condition: conditionToString(condition),
      });
      report = purchase.data as PurchasedReport;
      receipt = purchase.receipt?.transaction;
    } catch (error) {
      return {
        status: 'undecided',
        reason: `Could not buy the score report from ${this.marketUrl}: ${describe(error)}`,
        observations: [],
      };
    }

    if (report.status !== 'decided' || report.homeScore === undefined || report.awayScore === undefined) {
      return {
        status: 'undecided',
        reason: report.reason ?? 'The purchased report did not decide the fixture.',
        observations: report.observations ?? [],
      };
    }

    const agreeing: Observation[] = (report.sources ?? []).map((source) => ({
      provider: source.provider,
      finished: true,
      homeScore: report.homeScore!,
      awayScore: report.awayScore!,
      sourceUrl: source.url,
    }));

    return {
      status: 'decided',
      homeScore: report.homeScore,
      awayScore: report.awayScore,
      outcome: Outcome[report.outcome ?? 'Void'],
      agreeing,
      dissenting: [],
      payloadHash: report.payloadHash ?? '0x',
      payload: report.payload ?? '',
      sourceURI: [
        ...(receipt ? [`x402-receipt:${receipt}`] : []),
        ...agreeing.map((observation) => observation.sourceUrl),
      ].join(' '),
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0]! : String(error);
}
