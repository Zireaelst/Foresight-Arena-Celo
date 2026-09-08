#!/usr/bin/env node
/**
 * Copies the two data files the dashboard reads out of the repo and into `web/data/`
 * before the build.
 *
 * The dashboard's source of truth for addresses is the deployment record the deploy
 * script writes, and for agent identities the shared manifest the runtime uses. Both live
 * outside `web/`, which is correct -- they are shared, not the dashboard's private copy --
 * but reading across directory boundaries at request time makes the app depend on the
 * shape of the checkout. Hosts that build from a subdirectory do not guarantee a parent.
 *
 * So they are copied in at build time: one place to look, no runtime path assumptions.
 */
import {copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const root = join(web, '..');
const out = join(web, 'data');
mkdirSync(out, {recursive: true});

let copied = 0;

const deployments = join(root, 'contracts', 'deployments');
if (existsSync(deployments)) {
  for (const file of readdirSync(deployments).filter((f) => f.endsWith('.json'))) {
    copyFileSync(join(deployments, file), join(out, file));
    console.log(`  deployment ${file}`);
    copied++;
  }
}

for (const file of ['agents.json', 'fixtures.json']) {
  const source = join(root, 'shared', file);
  if (existsSync(source)) {
    copyFileSync(source, join(out, file));
    console.log(`  shared     ${file}`);
    copied++;
  }
}

// A build with no deployment record is legitimate -- the dashboard renders a "not
// deployed" page -- so this is a note, not a failure.
if (copied === 0) console.log('  nothing to sync; the dashboard will render its not-deployed state');

writeFileSync(join(out, '.gitkeep'), '');
