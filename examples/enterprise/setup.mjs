#!/usr/bin/env node
// Sets up the enterprise example: two repositories, as a company would have them. acme-ui holds Acme's UI libraries,
// published to a local registry that stands in for the company one, and acme-portal is the app that uses them.
// Both are on Angular 21, and the libraries' peer ranges stop there, so the portal can't move to 22 until they do.
// Start the registry first, in another terminal:
//   npx verdaccio@7.0.2 --config examples/enterprise/registry/config.yaml
// Usage: node examples/enterprise/setup.mjs <folder>
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REGISTRY = 'http://localhost:4873/';
const target = process.argv[2] && resolve(process.argv[2]);

function run(cmd, args, cwd) {
  console.log(`  ${cmd} ${args.join(' ')}`);
  // pnpm on Windows is a .cmd shim, which only runs through a shell. Its arguments here are fixed, none from input, and
  // git runs without one, since a shell would split an argument with a space in it.
  const shell = process.platform === 'win32' && cmd === 'pnpm';
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell, env: { ...process.env, NG_CLI_ANALYTICS: 'false' } });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`);
}

async function versions(name) {
  const res = await fetch(`${REGISTRY}${name.replace('/', '%2f')}`);
  return res.ok ? Object.keys((await res.json()).versions ?? {}) : [];
}

async function main() {
  if (!target) throw new Error('Usage: node examples/enterprise/setup.mjs <folder>');
  try { await fetch(`${REGISTRY}-/ping`); } catch { throw new Error(`No registry answers at ${REGISTRY}. Start it first:\n  npx verdaccio@7.0.2 --config examples/enterprise/registry/config.yaml`); }
  // The registry keeps what earlier runs published, and a later release there would leave the portal nothing to wait for.
  for (const name of ['@acme/ui-core', '@acme/ui-forms']) {
    const later = (await versions(name)).find((v) => !v.startsWith('21.'));
    if (later) throw new Error(`The registry already has ${name}@${later} from an earlier run, so the portal wouldn't be blocked. To start over, stop the registry, delete examples/enterprise/registry/storage and start it again.`);
  }
  for (const repo of ['acme-ui', 'acme-portal']) {
    if (existsSync(join(target, repo))) throw new Error(`${join(target, repo)} already exists. Pick an empty folder.`);
  }

  for (const repo of ['acme-ui', 'acme-portal']) {
    console.log(`\n${repo}: copying to ${join(target, repo)}`);
    cpSync(join(HERE, repo), join(target, repo), { recursive: true, filter: (src) => !/[\\/](node_modules|dist|\.angular)$/.test(src) });
  }

  const ui = join(target, 'acme-ui');
  console.log('\nacme-ui: install, build, test and publish the 21.x libraries');
  run('pnpm', ['install', '--frozen-lockfile'], ui);
  run('pnpm', ['run', 'build'], ui);
  run('pnpm', ['test'], ui);
  for (const lib of ['ui-core', 'ui-forms']) {
    const { name, version } = JSON.parse(readFileSync(join(ui, 'dist', 'acme', lib, 'package.json'), 'utf8'));
    if ((await versions(name)).includes(version)) console.log(`  ${name}@${version} is already in the registry, so it's left as it is`);
    else run('pnpm', ['publish', join('dist', 'acme', lib), '--no-git-checks'], ui);
  }

  const portal = join(target, 'acme-portal');
  console.log('\nacme-portal: install against the published libraries, and build');
  run('pnpm', ['install'], portal);
  run('pnpm', ['run', 'build'], portal);

  for (const dir of [ui, portal]) {
    run('git', ['init', '-q', '-b', 'main'], dir);
    run('git', ['add', '-A'], dir);
    run('git', ['-c', 'user.name=Acme Team', '-c', 'user.email=team@acme.example', 'commit', '-q', '-m', 'chore: start on Angular 21'], dir);
  }
  console.log(`\nReady. Open ${portal} in your agent, with ng-hop installed, and ask:\n  Upgrade this app to Angular 22.`);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
