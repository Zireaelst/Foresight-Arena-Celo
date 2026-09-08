import {CHAIN_ID, chain, isTestnet} from '@/lib/chain';

/**
 * Says which network this is, loudly when it is not mainnet.
 *
 * A dashboard that looks identical on testnet and mainnet is how someone ends up
 * believing a faucet token is worth something.
 */
export function NetworkBadge() {
  return (
    <span
      className={`hidden rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-block ${
        isTestnet ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-panel-2 text-ink-dim'
      }`}
      title={`chain id ${CHAIN_ID}`}
    >
      {isTestnet ? 'Testnet — play money' : chain.name}
    </span>
  );
}
