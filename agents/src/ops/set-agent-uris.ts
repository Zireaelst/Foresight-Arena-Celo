import {encodeFunctionData} from 'viem';

import {identityRegistryAbi} from '../core/abi.js';
import {sendTaggedAndWait} from '../core/chain.js';
import {AGENT_ROLES, contextFor, type Role} from './wallets.js';

/**
 * Repoints each agent's ERC-8004 `agentURI` at the currently published dashboard.
 *
 * Needed because registration happens before the dashboard has a public address, so the
 * first URI written is necessarily a local one -- and a registration document nobody can
 * fetch defeats the purpose of putting a URI on chain at all. The registry lets the token
 * owner update it, and the owner is the agent's own wallet, so each agent signs its own.
 *
 *   PUBLIC_BASE_URL=https://… npm run ops:agent-uris
 */
async function main() {
  const baseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('Set PUBLIC_BASE_URL to the dashboard origin first.');
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    throw new Error(
      `Refusing to publish "${baseUrl}" as an agentURI: nobody outside this machine could ` +
        'fetch it, which is worse than useless on a public registry.',
    );
  }

  for (const role of AGENT_ROLES) {
    const ctx = contextFor(role);
    const agentId = agentIdFor(role);
    if (agentId === undefined) {
      console.log(`${role.padEnd(15)} no ERC-8004 id recorded; run ops:register first.`);
      continue;
    }

    const uri = `${baseUrl}/api/agents/${role}/registration.json`;
    const current = await ctx.publicClient.readContract({
      address: ctx.addresses.identityRegistry as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: 'tokenURI',
      args: [agentId],
    });

    if (current === uri) {
      console.log(`${role.padEnd(15)} already points at ${uri}`);
      continue;
    }

    const receipt = await sendTaggedAndWait(ctx, {
      to: ctx.addresses.identityRegistry as `0x${string}`,
      data: encodeFunctionData({abi: identityRegistryAbi, functionName: 'setAgentURI', args: [agentId, uri]}),
    });
    console.log(`${role.padEnd(15)} ${current}\n${' '.repeat(16)}-> ${uri}\n${' '.repeat(16)}   ${receipt.transactionHash}`);
  }
}

function agentIdFor(role: Role): bigint | undefined {
  const raw = process.env[`${role.toUpperCase().replace(/-/g, '_')}_AGENT_ID`]?.trim();
  return raw ? BigInt(raw) : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
