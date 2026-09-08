'use client';

import {useAccount, useConnect, useDisconnect, useSwitchChain} from 'wagmi';

import {shortAddress} from '@/lib/format';
import {CHAIN_ID, chain} from '@/lib/chain';

export function ConnectButton() {
  const {address, isConnected, chainId} = useAccount();
  const {connect, connectors, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChain} = useSwitchChain();

  if (!isConnected) {
    const injectedConnector = connectors[0];
    return (
      <button
        type="button"
        disabled={!injectedConnector || isPending}
        onClick={() => injectedConnector && connect({connector: injectedConnector})}
        className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-sm font-medium transition hover:border-ink-faint disabled:opacity-50"
      >
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }

  // Being on the wrong network is the single most common way a call fails confusingly,
  // so it gets its own state rather than an error after the fact.
  if (chainId !== CHAIN_ID) {
    return (
      <button
        type="button"
        onClick={() => switchChain({chainId: CHAIN_ID})}
        className="rounded-md border border-no/50 bg-no-dim px-3 py-1.5 text-sm font-medium text-no"
      >
        Switch to {chain.name}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => disconnect()}
      title="Disconnect"
      className="rounded-md border border-line bg-panel-2 px-3 py-1.5 font-mono text-sm transition hover:border-ink-faint"
    >
      {address ? shortAddress(address) : ''}
    </button>
  );
}
