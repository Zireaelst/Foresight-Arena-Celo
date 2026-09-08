import {encodeFunctionData} from 'viem';

import {erc20Abi, foresightPoolAbi} from '../core/abi.js';
import {CELO_MAINNET_ID, sendTaggedAndWait} from '../core/chain.js';
import {AGENT_ROLES, addressFor, contextFor, requireAddress} from './wallets.js';

const faucetAbi = [
  {
    type: 'function',
    name: 'faucet',
    stateMutability: 'nonpayable',
    inputs: [{name: 'recipient', type: 'address'}],
    outputs: [],
  },
] as const;

/**
 * Gives each agent wallet testnet stake tokens from the faucet.
 *
 * Testnet only. On mainnet the agents are funded deliberately, by a person, with real
 * USDC -- an automated top-up there would defeat the point of a symbolic balance.
 *
 *   npm run ops:fund
 */
async function main() {
  const ctx = contextFor('deployer');
  if (ctx.chainId === CELO_MAINNET_ID) {
    throw new Error('Refusing to run on mainnet: fund agent wallets deliberately there.');
  }

  const pool = requireAddress('FORESIGHT_POOL_ADDRESS');
  const token = await ctx.publicClient.readContract({
    address: pool,
    abi: foresightPoolAbi,
    functionName: 'stakeToken',
  });

  for (const role of AGENT_ROLES) {
    const wallet = addressFor(role);
    const before = await ctx.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [wallet],
    });

    // The faucet is rate limited per recipient, so an already-funded agent is a no-op
    // rather than an error worth stopping the run for.
    try {
      await sendTaggedAndWait(ctx, {
        to: token,
        data: encodeFunctionData({abi: faucetAbi, functionName: 'faucet', args: [wallet]}),
      });
    } catch (error) {
      console.log(`${role.padEnd(15)} faucet skipped (${describe(error)})`);
      continue;
    }

    const after = await ctx.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [wallet],
    });
    console.log(`${role.padEnd(15)} ${wallet}  ${before} -> ${after}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0]! : String(error);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
