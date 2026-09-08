import {OUTCOME_LABEL, Outcome, phaseOf, type Market} from '@/lib/types';

/** The market's state in one token: settled outcome if there is one, otherwise phase. */
export function OutcomePill({market, now}: {market: Market; now: number}) {
  const phase = phaseOf(market, now);

  if (market.outcome === Outcome.Yes || market.outcome === Outcome.No) {
    const yes = market.outcome === Outcome.Yes;
    return (
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          yes ? 'bg-yes-dim text-yes' : 'bg-no-dim text-no'
        }`}
      >
        {OUTCOME_LABEL[market.outcome]}
      </span>
    );
  }

  if (market.outcome === Outcome.Void) {
    return (
      <span className="shrink-0 rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-semibold text-void">
        Void · refunded
      </span>
    );
  }

  const styles: Record<string, string> = {
    open: 'bg-panel-2 text-ink-dim',
    closed: 'bg-panel-2 text-ink-faint',
    settleable: 'bg-accent/10 text-accent',
  };
  const labels: Record<string, string> = {open: 'Open', closed: 'Closed', settleable: 'Settle now'};

  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[phase]}`}>
      {labels[phase]}
    </span>
  );
}
