import type {NextConfig} from 'next';

const config: NextConfig = {
  // The deployment record lives in contracts/deployments and is read at build time by
  // lib/deployment.ts, so the dashboard cannot drift from what is actually on chain.
  outputFileTracingIncludes: {
    '/**': ['../contracts/deployments/**', '../shared/**'],
  },
};

export default config;
