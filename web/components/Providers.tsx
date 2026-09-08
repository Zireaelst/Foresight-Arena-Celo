'use client';

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useState} from 'react';
import {WagmiProvider, createConfig, http} from 'wagmi';
// From @wagmi/core rather than wagmi/connectors: that barrel pulls in the Coinbase and
// Base connectors, which drag @coinbase/cdp-sdk and an optional @x402/evm into the client
// bundle. This app only ever offers an injected wallet.
import {injected} from '@wagmi/core';
import {celo, celoSepolia} from 'wagmi/chains';

import {CHAIN_ID, CELO_MAINNET_ID, RPC_URL} from '@/lib/chain';

const activeChain = CHAIN_ID === CELO_MAINNET_ID ? celo : celoSepolia;

/**
 * Injected connectors only.
 *
 * WalletConnect would need a hosted project id and would put a third party between a
 * visitor and a contract call whose whole point is that it is checkable. A browser wallet
 * is enough for what this dashboard asks anyone to do.
 */
const config = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  // Both ids are given a transport even though only one chain is active: the tuple's
  // type is a union of the two, and a partial map would not typecheck. Only the active
  // chain is ever reachable from the UI.
  transports: {
    [celo.id]: http(CHAIN_ID === CELO_MAINNET_ID ? RPC_URL : undefined),
    [celoSepolia.id]: http(CHAIN_ID === CELO_MAINNET_ID ? undefined : RPC_URL),
  },
  ssr: true,
});

export function Providers({children}: {children: React.ReactNode}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {queries: {retry: 1, refetchOnWindowFocus: false}},
      }),
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

export {config as wagmiConfig, activeChain};
