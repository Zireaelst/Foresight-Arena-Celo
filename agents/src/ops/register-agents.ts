import {decodeEventLog, encodeFunctionData} from 'viem';

import {foresightPoolAbi, identityRegistryAbi} from '../core/abi.js';
import {sendTaggedAndWait} from '../core/chain.js';
import {AGENT_ROLES, addressFor, contextFor, requireAddress, type Role} from './wallets.js';

/**
 * Registers each showcase agent in the ERC-8004 Identity Registry, then grants the
 * resulting id the agent tier in ForesightPool.
 *
 * The order matters and is not arbitrary: the pool's agent tier is keyed by an ERC-8004
 * token id (D-02), so "this wallet is an agent" is a claim backed by an on-chain
 * registration rather than by a config file we wrote ourselves.
 *
 *   npm run ops:register
 */
async function main() {
  const baseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '') ?? 'http://localhost:3000';
  const poolAddress = requireAddress('FORESIGHT_POOL_ADDRESS');
  const deployer = contextFor('deployer');
  const registered: {role: Role; wallet: `0x${string}`; agentId: bigint}[] = [];

  for (const role of AGENT_ROLES) {
    const ctx = contextFor(role);
    // The agentURI points at a registration document the dashboard serves: endpoints,
    // wallet, and the trust models this agent supports.
    const agentURI = `${baseUrl}/api/agents/${role}/registration.json`;

    const receipt = await sendTaggedAndWait(ctx, {
      to: ctx.addresses.identityRegistry as `0x${string}`,
      data: encodeFunctionData({abi: identityRegistryAbi, functionName: 'register', args: [agentURI]}),
    });

    const agentId = agentIdFromLogs(receipt.logs);
    if (agentId === null) throw new Error(`Could not read the agent id back from ${role}'s registration receipt.`);

    console.log(`registered ${role.padEnd(15)} wallet=${ctx.account} agentId=${agentId} uri=${agentURI}`);
    registered.push({role, wallet: ctx.account, agentId});
  }

  // Grant the agent tier from the pool owner.
  for (const {role, wallet, agentId} of registered) {
    await sendTaggedAndWait(deployer, {
      to: poolAddress,
      data: encodeFunctionData({abi: foresightPoolAbi, functionName: 'registerAgent', args: [wallet, agentId]}),
    });
    console.log(`pool: ${role} granted the agent tier (agentId=${agentId})`);
  }

  console.log('\nAdd these to agents/.env so the runner can write reputation:');
  for (const {role, agentId} of registered) {
    console.log(`${role.toUpperCase().replace(/-/g, '_')}_AGENT_ID=${agentId}`);
  }
}

/** Reads the minted token id out of the registry's own event rather than guessing. */
function agentIdFromLogs(logs: readonly {data: `0x${string}`; topics: readonly `0x${string}`[]}[]): bigint | null {
  for (const log of logs) {
    try {
      const parsed = decodeEventLog({
        abi: identityRegistryAbi,
        data: log.data,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });
      if (parsed.eventName === 'Registered') return (parsed.args as {agentId: bigint}).agentId;
    } catch {
      // Not one of ours; ERC-721 Transfer events show up here too.
    }
  }
  return null;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
