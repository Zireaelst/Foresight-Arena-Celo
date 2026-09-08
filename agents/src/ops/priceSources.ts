/**
 * Spot CELO/USD from several keyless public exchanges.
 *
 * Used to drive the testnet price feed. The same reasoning as the score panel applies:
 * one source would make its operator the silent authority behind every price market, so
 * we take the median of several and refuse to publish when too few answer.
 */
export interface PriceQuote {
  source: string;
  usd: number;
  url: string;
}

const TIMEOUT_MS = 10_000;

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {signal: controller.signal});
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SOURCES: {name: string; url: string; read: (body: any) => number | undefined}[] = [
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/CELO-USD/spot',
    read: (b) => Number(b?.data?.amount),
  },
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd',
    read: (b) => Number(b?.celo?.usd),
  },
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=CELOUSD',
    read: (b) => Number(b?.result?.CELOUSD?.c?.[0]),
  },
];

export async function fetchQuotes(): Promise<PriceQuote[]> {
  const results = await Promise.all(
    SOURCES.map(async (source) => {
      const body = await getJson(source.url);
      const usd = source.read(body);
      return usd && Number.isFinite(usd) && usd > 0 ? {source: source.name, usd, url: source.url} : null;
    }),
  );
  return results.filter((quote): quote is PriceQuote => quote !== null);
}

/** Median, so one exchange printing a bad tick cannot move the published rate. */
export function medianUsd(quotes: PriceQuote[]): number {
  const sorted = [...quotes].map((q) => q.usd).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Converts a USD price to Mento's Fixidity scale (1e24). */
export function toFixed24(usd: number): bigint {
  // Go through a fixed number of decimal places rather than multiplying a float by 1e24,
  // which would carry binary rounding straight into an on-chain number.
  return BigInt(Math.round(usd * 1e9)) * 10n ** 15n;
}
