import {formatEther} from 'viem';

import {erc20Abi, foresightPoolAbi} from '../core/abi.js';
import {chainNow} from '../core/chain.js';
import {Outcome} from '../core/types.js';
import {AGENT_ROLES, addressFor, contextFor, type Role} from './wallets.js';

/**
 * One screen showing whether this deployment is actually ready to run.
 *
 * Exists because almost every failure in a setup like this is a boring one -- an unfunded
 * wallet, an unregistered agent, a resolver nobody approved -- and each of those is far
 * cheaper to see here than to diagnose from a reverted transaction.
 *
 *   npm run ops:status
 */
async function main() {
  const ctx = contextFor('deployer');
  const pool = process.env.FORESIGHT_POOL_ADDRESS?.trim() as `0x${string}` | undefined;

  console.log(`network   ${ctx.chainId}${ctx.isMainnet ? '  (MAINNET)' : '  (Celo Sepolia)'}`);
  console.log(`tag       ${ctx.attributionTag}`);
  console.log('');

  console.log('wallets');
  const roles: Role[] = ['deployer', ...AGENT_ROLES];
  for (const role of roles) {
    const address = addressFor(role);
    const celo = await ctx.publicClient.getBalance({address});
    const funded = celo > 0n;
    console.log(`  ${role.padEnd(15)} ${address}  ${Number(formatEther(celo)).toFixed(4)} CELO ${funded ? '' : '<- UNFUNDED'}`);
  }
  console.log('');

  if (!pool) {
    console.log('pool      not deployed yet (FORESIGHT_POOL_ADDRESS is empty)');
    return;
  }

  const [stakeToken, owner, paused, count] = await Promise.all([
    ctx.publicClient.readContract({address: pool, abi: foresightPoolAbi, functionName: 'stakeToken'}),
    ctx.publicClient.readContract({address: pool, abi: foresightPoolAbi, functionName: 'owner'}),
    ctx.publicClient.readContract({address: pool, abi: foresightPoolAbi, functionName: 'paused'}),
    ctx.publicClient.readContract({address: pool, abi: foresightPoolAbi, functionName: 'marketCount'}),
  ]);
  const [symbol] = await Promise.all([
    ctx.publicClient.readContract({address: stakeToken, abi: erc20Abi, functionName: 'symbol'}),
  ]);

  console.log(`pool      ${pool}`);
  console.log(`  owner   ${owner}${paused ? '  [PAUSED]' : ''}`);
  console.log(`  token   ${stakeToken}  (${symbol})`);
  console.log('');

  console.log('resolvers');
  for (const [label, key] of [
    ['price', 'MENTO_PRICE_RESOLVER_ADDRESS'],
    ['chain', 'CHAIN_METRIC_RESOLVER_ADDRESS'],
    ['score', 'ATTESTED_SCORE_RESOLVER_ADDRESS'],
  ] as const) {
    const address = process.env[key]?.trim() as `0x${string}` | undefined;
    if (!address) {
      console.log(`  ${label.padEnd(6)} (not set)`);
      continue;
    }
    const approved = await ctx.publicClient.readContract({
      address: pool,
      abi: foresightPoolAbi,
      functionName: 'isApprovedResolver',
      args: [address],
    });
    console.log(`  ${label.padEnd(6)} ${address}  ${approved ? 'approved' : 'NOT APPROVED'}`);
  }
  console.log('');

  console.log('agent tier (ERC-8004 id recorded in the pool)');
  for (const role of AGENT_ROLES) {
    const wallet = addressFor(role);
    const [agentId, exposure, balance] = await Promise.all([
      ctx.publicClient.readContract({address: pool, abi: foresightPoolAbi, functionName: 'agentIdOf', args: [wallet]}),
      ctx.publicClient.readContract({address: pool, abi: foresightPoolAbi, functionName: 'openExposure', args: [wallet]}),
      ctx.publicClient.readContract({address: stakeToken, abi: erc20Abi, functionName: 'balanceOf', args: [wallet]}),
    ]);
    console.log(
      `  ${role.padEnd(15)} agentId=${agentId === 0n ? 'NOT REGISTERED' : agentId}` +
        `  exposure=${exposure}  balance=${balance}`,
    );
  }
  console.log('');

  const now = await chainNow(ctx);
  console.log(`markets   ${count}`);
  for (let i = 0n; i < count; i++) {
    const m = await ctx.publicClient.readContract({
      address: pool,
      abi: foresightPoolAbi,
      functionName: 'getMarket',
      args: [i],
    });
    const state =
      m.outcome !== 0
        ? (Outcome[m.outcome] ?? 'unknown')
        : now < Number(m.closesAt)
          ? 'open'
          : now >= Number(m.resolvesAt)
            ? 'SETTLEABLE'
            : 'closed';
    console.log(`  #${i}  ${state.padEnd(11)} yes=${m.yesPool} no=${m.noPool}  ${m.question.slice(0, 60)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
