import {formatUsdc} from '@/lib/format';

/**
 * The two pools, to scale.
 *
 * In a pari-mutuel pool the bar *is* the odds: the split of money is the only price
 * signal there is, so showing it directly is more honest than deriving a "probability"
 * and showing that instead.
 */
export function PoolBar({yesPool, noPool}: {yesPool: bigint; noPool: bigint}) {
  const total = yesPool + noPool;
  const yesShare = total === 0n ? 0.5 : Number((yesPool * 1000n) / total) / 1000;
  const empty = total === 0n;

  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-2">
        {empty ? (
          <div className="w-full bg-line" />
        ) : (
          <>
            <div className="bg-yes transition-all" style={{width: `${yesShare * 100}%`}} />
            <div className="bg-no transition-all" style={{width: `${(1 - yesShare) * 100}%`}} />
          </>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tnum">
        <span className="text-yes">YES {formatUsdc(yesPool, false)}</span>
        <span className="text-no">{formatUsdc(noPool, false)} NO</span>
      </div>
    </div>
  );
}
