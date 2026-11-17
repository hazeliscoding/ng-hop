#!/usr/bin/env node
// Starts the enterprise example's registry for the evals, and leaves it running. Its packages are kept beside the
// fixture apps, so the machine that runs a case serves what the machine that built the fixtures published.
// Usage: node evals/registry.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, TEMPLATES } from './common.mjs';

export const REGISTRY_DIR = join(TEMPLATES, '.registry');
const PING = 'http://localhost:4873/-/ping';
const answers = () => fetch(PING).then((res) => res.ok, () => false);

export async function startRegistry() {
  if (await answers()) return;
  mkdirSync(REGISTRY_DIR, { recursive: true });
  // The example's own settings, with the packages kept here instead of in the repo, which CI can't write to.
  const config = readFileSync(join(REPO, 'examples', 'enterprise', 'registry', 'config.yaml'), 'utf8').replace(/^storage: .*$/m, `storage: ${JSON.stringify(join(REGISTRY_DIR, 'storage'))}`);
  writeFileSync(join(REGISTRY_DIR, 'config.yaml'), config);
  const log = openSync(join(REGISTRY_DIR, 'registry.log'), 'a');
  // npx is a .cmd shim on Windows, which only runs through a shell. The one argument that varies is quoted.
  spawn(`npx -y verdaccio@7.0.2 --config "${join(REGISTRY_DIR, 'config.yaml')}"`, { shell: true, detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
  for (let i = 0; i < 120; i++) {
    if (await answers()) return;
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`The example's registry didn't answer at ${PING}. Its log is ${join(REGISTRY_DIR, 'registry.log')}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // --if-published: only when a fixture's packages are here to serve, so a batch with no such case starts nothing.
  if (process.argv.includes('--if-published') && !existsSync(join(REGISTRY_DIR, 'storage'))) process.exit(0);
  await startRegistry();
  console.log('The example\'s registry answers at http://localhost:4873/.');
}
