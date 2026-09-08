import {encodeFunctionData} from 'viem';

import {attestedScoreResolverAbi} from '../core/abi.js';
import {sendTaggedAndWait} from '../core/chain.js';
import {Outcome} from '../core/types.js';
import {ScoreConsensus} from '../agents/score-oracle/consensus.js';
import {loadFixtureRegistry} from '../agents/score-oracle/registry.js';
import {contextFor, requireAddress} from './wallets.js';

/**
 * The score attestor.
 *
 * This is the single place in Foresight Arena where an off-chain reader writes something
 * the pool will settle against, so it is written to be as boring and as checkable as
 * possible:
 *
 *  - it publishes nothing unless a panel of independent public APIs agree on the exact
 *    final scoreline (see agents/src/agents/score-oracle/consensus.ts);
 *  - it publishes the hash of what it read and every source URL, so the transcription
 *    can be audited against the same APIs by anyone;
 *  - the resolver accepts one write per event key, so it cannot revise history after
 *    stakes are placed.
 *
 * It is not an arbiter. It does not decide who won; it transcribes what several
 * unaffiliated sources already say, and stays silent when they do not agree.
 *
 *   npm run ops:attest              # report only
 *   npm run ops:attest -- --publish # actually write
 */
async function main() {
  const publish = process.argv.includes('--publish');
  const resolverAddress = requireAddress('ATTESTED_SCORE_RESOLVER_ADDRESS');
  const ctx = contextFor('deployer');
  const consensus = new ScoreConsensus();
  const registry = loadFixtureRegistry();

  console.log(
    `attestor=${ctx.account} resolver=${resolverAddress} quorum=${consensus.quorum} ` +
      `mode=${publish ? 'PUBLISH' : 'dry run'}\n`,
  );

  for (const entry of registry.values()) {
    const {ref, condition, eventKey} = entry;
    const label = `${ref.homeTeam} vs ${ref.awayTeam} (${ref.kickoffDate}, ${condition.kind})`;

    const existing = await ctx.publicClient.readContract({
      address: resolverAddress,
      abi: attestedScoreResolverAbi,
      functionName: 'attestations',
      args: [eventKey],
    });
    if ((existing[0] as number) !== Outcome.Unresolved) {
      console.log(`- ${label}\n    already attested as ${Outcome[existing[0] as number]}; write-once, skipping.`);
      continue;
    }

    const result = await consensus.resolve(ref, condition);
    if (result.status === 'undecided') {
      console.log(`- ${label}\n    no consensus: ${result.reason}`);
      continue;
    }

    console.log(
      `- ${label}\n` +
        `    ${result.homeScore}-${result.awayScore} => ${Outcome[result.outcome]}\n` +
        `    agreed by ${result.agreeing.map((o) => o.provider).join(', ')}\n` +
        `    payloadHash ${result.payloadHash}\n` +
        `    sources ${result.sourceURI}`,
    );

    if (!publish) continue;

    const receipt = await sendTaggedAndWait(ctx, {
      to: resolverAddress,
      data: encodeFunctionData({
        abi: attestedScoreResolverAbi,
        functionName: 'attest',
        args: [eventKey, result.outcome, result.payloadHash, result.sourceURI],
      }),
    });
    console.log(`    attested in ${receipt.transactionHash}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
