import type {NextConfig} from 'next';

const config: NextConfig = {
  // The deployment record and the shared agent manifest are copied into web/data before
  // the build (scripts/sync-data.mjs), so nothing has to be traced out of the parent
  // directory and the app works the same locally and on a host that builds from web/.
};

export default config;
