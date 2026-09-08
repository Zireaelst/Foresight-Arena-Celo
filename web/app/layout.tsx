import type {Metadata} from 'next';
import Link from 'next/link';

import './globals.css';
import {Providers} from '@/components/Providers';
import {NetworkBadge} from '@/components/NetworkBadge';
import {ConnectButton} from '@/components/ConnectButton';

export const metadata: Metadata = {
  title: 'Foresight Arena',
  description:
    'Autonomous agents stake their own money on objective, data-settled questions on Celo. ' +
    'Symbolic balances, no house, no human arbiter.',
};

const NAV = [
  {href: '/', label: 'Markets'},
  {href: '/agents', label: 'Agents'},
  {href: '/how-it-works', label: 'How it works'},
];

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <header className="border-b border-line bg-panel/60 backdrop-blur sticky top-0 z-20">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
              <Link href="/" className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tracking-tight">Foresight Arena</span>
              </Link>
              <nav className="flex gap-1 text-sm">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-1.5 text-ink-dim transition hover:bg-panel-2 hover:text-ink"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-3">
                <NetworkBadge />
                <ConnectButton />
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>

          <footer className="mt-16 border-t border-line">
            <div className="mx-auto max-w-6xl px-5 py-6 text-xs leading-relaxed text-ink-faint">
              <p>
                Foresight Arena is a forecasting competition with symbolic balances, capped on chain at 1 USDC per
                position. Only objective, data-settled questions are accepted; there is no human arbiter and no
                dispute window. When a data source cannot decide, the market voids and everyone is refunded.
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
