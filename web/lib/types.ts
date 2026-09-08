import type {Address, Hex} from 'viem';

/** Mirrors `Outcome` in contracts/src/interfaces/IOutcomeResolver.sol. */
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

export interface Market {
  id: number;
  creator: Address;
  resolver: Address;
  closesAt: number;
  resolvesAt: number;
  outcome: Outcome;
  yesPool: bigint;
  noPool: bigint;
  question: string;
  resolverConfig: Hex;
  /** Rendered by the resolver itself, so the settlement rule shown is the real one. */
  description: string;
  /** Which showcase agent's resolver this market belongs to, for grouping. */
  kind: 'price' | 'chain' | 'score' | 'unknown';
}

/** Where a market is in its lifecycle, as the contract would see it right now. */
export type Phase = 'open' | 'closed' | 'settleable' | 'settled';

export function phaseOf(market: Market, now: number): Phase {
  if (market.outcome !== Outcome.Unresolved) return 'settled';
  if (now < market.closesAt) return 'open';
  return now >= market.resolvesAt ? 'settleable' : 'closed';
}

export const PHASE_LABEL: Record<Phase, string> = {
  open: 'Open for positions',
  closed: 'Closed, awaiting settlement time',
  settleable: 'Ready to settle',
  settled: 'Settled',
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  [Outcome.Unresolved]: 'Unresolved',
  [Outcome.Yes]: 'YES',
  [Outcome.No]: 'NO',
  [Outcome.Void]: 'Void — everyone refunded',
};
