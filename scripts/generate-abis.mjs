#!/usr/bin/env node
/**
 * Regenerates web/lib/abi.generated.ts from the Foundry build output.
 *
 * The dashboard and the contracts have to agree about every signature, and a hand-copied
 * ABI is a copy that silently rots the first time someone changes a parameter. Generating
 * it means `forge build && npm run abis` is the only way the two can disagree.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'contracts', 'out');

const CONTRACTS = {
  foresightPoolAbi: 'ForesightPool.sol/ForesightPool.json',
  outcomeResolverAbi: 'IOutcomeResolver.sol/IOutcomeResolver.json',
  attestedScoreResolverAbi: 'AttestedScoreResolver.sol/AttestedScoreResolver.json',
  mentoPriceResolverAbi: 'MentoPriceResolver.sol/MentoPriceResolver.json',
  chainMetricResolverAbi: 'ChainMetricResolver.sol/ChainMetricResolver.json',
  testnetUsdcAbi: 'TestnetUSDC.sol/TestnetUSDC.json',
  testnetSortedOraclesAbi: 'TestnetSortedOracles.sol/TestnetSortedOracles.json',
};

const parts = [
  '// GENERATED FILE -- do not edit by hand.',
  '// Run `npm run abis` from the repo root after changing any contract.',
  '// Source: contracts/out (Foundry build output).',
  '',
];

for (const [name, path] of Object.entries(CONTRACTS)) {
  const file = join(out, path);
  if (!existsSync(file)) {
    console.error(`missing artifact ${path} -- run \`forge build\` in contracts/ first`);
    process.exit(1);
  }
  const {abi} = JSON.parse(readFileSync(file, 'utf8'));
  parts.push(`export const ${name} = ${JSON.stringify(abi, null, 2)} as const;`, '');
}

// The ERC-20 surface the dashboard needs is not one of our contracts.
parts.push(
  `export const erc20Abi = [
  {"type":"function","name":"approve","stateMutability":"nonpayable","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"allowance","stateMutability":"view","inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"name":"account","type":"address"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]},
  {"type":"function","name":"symbol","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]}
] as const;`,
  '',
);

const target = join(root, 'web', 'lib', 'abi.generated.ts');
writeFileSync(target, parts.join('\n'));
console.log(`wrote ${target} (${Object.keys(CONTRACTS).length} contracts)`);
