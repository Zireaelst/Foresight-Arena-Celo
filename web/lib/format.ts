/** Stake token amounts are 6-decimal throughout (D-01), enforced by the pool's constructor. */
export const STAKE_DECIMALS = 6;

export function formatUsdc(amount: bigint, withSymbol = true): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const unit = 10n ** BigInt(STAKE_DECIMALS);
  const whole = abs / unit;
  const frac = abs % unit;
  // Two decimals is the resolution these symbolic balances are actually discussed in.
  const cents = (frac / 10_000n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${cents}${withSymbol ? ' USDC' : ''}`;
}

export function parseUsdc(input: string): bigint {
  const cleaned = input.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') {
    throw new Error('Enter an amount like 0.50');
  }
  const [whole = '0', frac = ''] = cleaned.split('.');
  const padded = (frac + '000000').slice(0, STAKE_DECIMALS);
  return BigInt(whole || '0') * 10n ** BigInt(STAKE_DECIMALS) + BigInt(padded || '0');
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Implied probability from pool sizes.
 *
 * In a pari-mutuel pool this is what the crowd's money says, not a price anyone is
 * quoting: with both sides staked, a YES staker's return is (yes+no)/yes, so the
 * break-even probability is yes/(yes+no).
 */
export function impliedYes(yesPool: bigint, noPool: bigint): number | null {
  const total = yesPool + noPool;
  if (total === 0n) return null;
  return Number((yesPool * 10_000n) / total) / 10_000;
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(0)}%`;
}

/** Relative time that stays honest about the past. */
export function relativeTime(target: number, now: number): string {
  const delta = target - now;
  const abs = Math.abs(delta);
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [seconds, label] of units) {
    if (abs >= seconds) {
      const n = Math.floor(abs / seconds);
      return delta >= 0 ? `in ${n} ${label}${n === 1 ? '' : 's'}` : `${n} ${label}${n === 1 ? '' : 's'} ago`;
    }
  }
  return delta >= 0 ? 'in under a minute' : 'just now';
}

export function formatUtc(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
