import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {foresightPoolAbi} from '../core/abi.js';
import {ReputationClient, scoreFromSettlement} from '../core/reputation.js';
import {Outcome, Side, type SettlementReport} from '../core/types.js';
import {AGENT_ROLES, addressFor, contextFor, requireAddress, type Role} from './wallets.js';

// fileURLToPath, not URL.pathname: the latter percent-encodes, so any space in the
// checkout path turns into "%20" and every write lands on a directory that does not exist.
const LEDGER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.scorekeeper.json');

/**
 * The scorekeeper: an independent client that publishes each agent's record to ERC-8004.
 *
 * This is a separate program with a separate wallet for a reason the registry itself
 * enforces: `giveFeedback` reverts with "Self-feedback not allowed" when the caller owns
 * the agent being scored. An agent cannot grade itself, which is exactly the property a
 * public track record needs.
 *
 * Everything it writes is a pure function of public chain state -- which side a wallet
 * staked, and how the market settled -- so the scorekeeper has nothing to be trusted
 * with. Anyone can recompute its output from the same contract and check it. It scores
 * losses as readily as wins; a record that only contained wins would be worthless.
 *
 *   npm run ops:score              # report only
 *   npm run ops:score -- --publish # write to the registry
 */
async function main() {
  const publish = process.argv.includes('--publish');
  const ctx = contextFor('scorekeeper');
  const pool = requireAddress('FORESIGHT_POOL_ADDRESS');
  const reputation = new ReputationClient(ctx);
  const ledger = loadLedger();

  console.log(`scorekeeper=${ctx.account} pool=${pool} mode=${publish ? 'PUBLISH' : 'dry run'}\n`);

  const count = await ctx.publicClient.readContract({
    address: pool,
    abi: foresightPoolAbi,
    functionName: 'marketCount',
  });

  let written = 0;
  for (let id = 0n; id < count; id++) {
    const market = await ctx.publicClient.readContract({
      address: pool,
      abi: foresightPoolAbi,
      functionName: 'getMarket',
      args: [id],
    });
    if ((market.outcome as number) === Outcome.Unresolved) continue;

    for (const role of AGENT_ROLES) {
      const wallet = addressFor(role);
      const agentId = agentIdFor(role);
      if (agentId === undefined) {
        console.log(`  ${role}: no ERC-8004 id recorded; run ops:register first.`);
        continue;
      }

      const key = `${agentId}:${id}`;
      if (ledger.has(key)) continue;

      const [yesStake, noStake] = await Promise.all([
        ctx.publicClient.readContract({
          address: pool,
          abi: foresightPoolAbi,
          functionName: 'stakeOf',
          args: [id, wallet, Side.Yes],
        }),
        ctx.publicClient.readContract({
          address: pool,
          abi: foresightPoolAbi,
          functionName: 'stakeOf',
          args: [id, wallet, Side.No],
        }),
      ]);

      const staked = yesStake + noStake;
      if (staked === 0n) continue; // this agent had no opinion here

      const outcome = market.outcome as Outcome;
      // The side the agent actually backed. A wallet holding both sides took no
      // directional view, so there is nothing to grade.
      if (yesStake > 0n && noStake > 0n) continue;
      const side = yesStake > 0n ? Side.Yes : Side.No;
      const calledCorrectly =
        outcome === Outcome.Yes ? side === Side.Yes : outcome === Outcome.No ? side === Side.No : false;

      const report: SettlementReport = {
        marketId: id,
        outcome,
        payout: 0n, // not needed for scoring; the score depends on the call, not the size
        staked,
        calledCorrectly,
      };
      const score = scoreFromSettlement(report);

      console.log(
        `market #${id}  ${role.padEnd(15)} agentId=${agentId} staked=${staked} on ${Side[side]} ` +
          `outcome=${Outcome[outcome]} -> score ${score}`,
      );

      if (!publish) continue;

      const {hash} = await reputation.giveFeedback({
        agentId,
        score,
        marketId: id,
        outcome,
        calledCorrectly,
        payout: 0n,
        staked,
        rationale: `Scored from chain state: staked ${staked} on ${Side[side]}, market settled ${Outcome[outcome]}.`,
        sources: [`pool:${pool}/getMarket(${id})`, `pool:${pool}/stakeOf(${id},${wallet})`],
      });
      console.log(`    written, payload hash ${hash}`);

      ledger.add(key);
      saveLedger(ledger);
      written++;
    }
  }

  console.log(`\n${publish ? `wrote ${written} feedback entr${written === 1 ? 'y' : 'ies'}` : 'dry run: nothing written'}`);
}

/**
 * Which (agent, market) pairs have already been scored.
 *
 * The registry accepts repeat feedback, so without this a second run would inflate every
 * agent's history with duplicates of the same settlement.
 */
function loadLedger(): Set<string> {
  if (!existsSync(LEDGER)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(LEDGER, 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

function saveLedger(ledger: Set<string>): void {
  writeFileSync(LEDGER, JSON.stringify([...ledger], null, 2));
}

function agentIdFor(role: Role): bigint | undefined {
  const raw = process.env[`${role.toUpperCase().replace(/-/g, '_')}_AGENT_ID`]?.trim();
  return raw ? BigInt(raw) : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
