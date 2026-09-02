import type {Address, Hex} from 'viem';

/** Mirrors `Outcome` in contracts/src/interfaces/IOutcomeResolver.sol. Keep the values aligned. */
export enum Outcome {
  Unresolved = 0,
  Yes = 1,
  No = 2,
  Void = 3,
}

/** Mirrors `ForesightPool.Side`. */
export enum Side {
  No = 0,
  Yes = 1,
}

export interface MarketView {
  id: bigint;
  creator: Address;
  resolver: Address;
  closesAt: number;
  resolvesAt: number;
  outcome: Outcome;
  yesPool: bigint;
  noPool: bigint;
  question: string;
  resolverConfig: Hex;
}

/**
 * What an agent believes about one market, and why.
 *
 * `rationale` and `sources` are not decoration: the project's whole claim is that these
 * agents reason from public data, so every position an agent takes must be explainable
 * from a record anyone else can re-check.
 */
export interface Research {
  marketId: bigint;
  /** Agent's probability that the market resolves YES, in [0, 1]. */
  probabilityYes: number;
  /** How much weight to put behind it, in [0, 1]. Scaled against the agent's stake budget. */
  confidence: number;
  rationale: string;
  /** URLs, contract addresses, or block references backing the rationale. */
  sources: string[];
}

/** A decision to stake, or an explicit decision not to. */
export type Intent =
  | {kind: 'stake'; marketId: bigint; side: Side; amount: bigint; research: Research}
  | {kind: 'pass'; marketId: bigint; reason: string};

export interface SettlementReport {
  marketId: bigint;
  outcome: Outcome;
  /** Amount received from `claim`, in stake-token base units. */
  payout: bigint;
  /** What the agent had staked across both sides. */
  staked: bigint;
  /** True when the agent's own directional call matched the settled outcome. */
  calledCorrectly: boolean;
}

/**
 * The loop every Foresight Arena agent runs.
 *
 * research -> position -> settle -> reputation -> repeat
 *
 * Each step is separated on purpose: `research` is pure and testable against recorded
 * data, `position` is the only step that spends money, `settle` is idempotent so it can
 * be retried, and `reputation` writes the outcome to ERC-8004 so an agent's track record
 * is public rather than self-reported.
 */
export interface ForesightAgent {
  /** Stable slug, also used as the ERC-8004 registration name. */
  readonly name: string;
  readonly description: string;

  /** ERC-8004 Identity Registry token id. Undefined until the agent is registered. */
  agentId?: bigint;

  /** Markets this agent is willing to have an opinion about. */
  isInScope(market: MarketView): boolean;

  /** Step 1 -- form a view from public data. Must not send transactions. */
  research(market: MarketView): Promise<Research>;

  /** Step 2 -- turn a view into an intent. Must not send transactions either; the runner does that. */
  position(market: MarketView, research: Research): Promise<Intent>;

  /** Step 4 -- optional hook after settlement, e.g. to update local calibration. */
  onSettled?(report: SettlementReport): Promise<void>;
}

/** Budget and safety rails applied by the runner, independent of what an agent asks for. */
export interface AgentBudget {
  /** Hard ceiling per position, in stake-token base units. Must not exceed the pool's own cap. */
  maxStakePerPosition: bigint;
  /** Hard ceiling on total unsettled exposure. Must not exceed the pool's own cap. */
  maxOpenExposure: bigint;
  /** Below this confidence the runner passes regardless of the agent's intent. */
  minConfidence: number;
}
