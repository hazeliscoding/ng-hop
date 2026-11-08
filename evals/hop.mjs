#!/usr/bin/env node
// Takes a fixture app through the plan's own commands, with no agent and no login. After each major it installs what
// the plan lists that the update didn't move, commits, and checks the build, the tests and the running app against how
// they were at the start. It proves what the plan prints works where the agent evals don't run, such as Windows, yarn,
// bun or a pnpm catalog, and it costs nothing but machine time.
// Usage: node evals/hop.mjs --fixture <name> [--to <major>]
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { developerEnv, installCommand, PLUGIN, TEMPLATES, WORKSPACE } from './common.mjs';
import { FIXTURES } from './fixtures.mjs';

const SCRIPTS = join(PLUGIN, 'skills', 'ng-hop', 'scripts');
const semver = createRequire(import.meta.url)(join(SCRIPTS, 'vendor', 'semver.cjs'));
const { values } = parseArgs({ options: { fixture: { type: 'string' }, to: { type: 'string' } } });
if (!FIXTURES[values.fixture]) throw new Error(`No fixture named ${values.fixture}. Prepare it first with evals/prepare.mjs.`);
const dir = join(WORKSPACE, 'hops', values.fixture);

// The plan's quoting on Windows is written for PowerShell, which an agent there uses as often as Git Bash.
const SHELL = process.platform === 'win32' ? 'pwsh' : '/bin/bash';
const env = developerEnv({ NG_CLI_ANALYTICS: 'false' });
const tail = (text) => String(text || '').trim().split('\n').slice(-25).join('\n').slice(-3000);
const shell = (command) => {
  const r = spawnSync(command, { cwd: dir, shell: SHELL, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  return { ok: r.status === 0, out: tail(`${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}`) };
};
const node = (args, extra = {}) => {
  const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60 * 1000, ...extra });
  return { ok: r.status === 0, code: r.status, out: tail(`${r.stdout || ''}${r.stderr || ''}`), stdout: r.stdout };
};
const ng = (...args) => node([join(dir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'), ...args]);
const readPkg = () => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const manager = () => {
  const lock = installCommand(dir);
  return lock.startsWith('pnpm') ? 'pnpm add' : lock.startsWith('yarn') ? 'yarn add' : lock.startsWith('bun') ? 'bun add' : 'npm install --no-audit --no-fund';
};

function checks() {
  const builder = Object.values(JSON.parse(readFileSync(join(dir, 'angular.json'), 'utf8')).projects)[0].architect?.test?.builder || '';
  return {
    build: ng('build'),
    test: ng('test', '--watch=false', ...(builder.includes('karma') ? ['--browsers=ChromeHeadless'] : [])),
    app: node([join(SCRIPTS, 'smoke.mjs'), '--port', String(4400 + (process.pid % 300))]),
  };
}
const verdicts = (c) => Object.entries(c).map(([name, r]) => `${name} ${r.ok ? 'ok' : 'FAILED'}`).join(', ');

const failures = [];
const fail = (what, detail) => { failures.push(what); console.log(`FAILED: ${what}\n${detail}\n`); };

rmSync(dir, { recursive: true, force: true });
cpSync(join(TEMPLATES, values.fixture), dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|dist|\.angular)$/.test(src) && !/\.ng-hop-ok$/.test(src) });
const install = shell(installCommand(dir));
if (!install.ok) { fail('the first install', install.out); process.exit(1); }
const git = (...args) => spawnSync('git', ['-c', 'user.name=Hop', '-c', 'user.email=hop@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'chore: start of the fixture app');

const baseline = checks();
console.log(`${values.fixture} on ${process.platform}, ${installCommand(dir).split(' ')[0]}: at the start, ${verdicts(baseline)}`);

let reached = null;
for (let step = 0; step < 6 && !failures.length; step++) {
  const planned = node([join(SCRIPTS, 'plan.mjs'), '--project', dir, '--json', ...(values.to ? ['--to', values.to] : [])]);
  if (planned.code === 1) { fail('the plan', planned.out); break; }
  const plan = JSON.parse(planned.stdout);
  reached = plan.reachable;
  const hop = plan.hops[0];
  if (!hop) { console.log(`Done: Angular ${plan.reachable}, plan status ${plan.status}${plan.blockers.length ? `, blocked by ${plan.blockers.map((b) => b.name).join(', ')}` : ''}.`); break; }

  console.log(`\nAngular ${hop.major}: ${hop.command}`);
  const update = shell(hop.command);
  if (!update.ok) { fail(`the update to ${hop.major}`, update.out); break; }
  // What the skill does by hand: anything the plan lists that the update left behind.
  const deps = () => { const p = readPkg(); return { ...p.devDependencies, ...p.dependencies }; };
  for (const item of [...hop.libs.filter((l) => l.from !== l.to), ...hop.shared]) {
    const spec = deps()[item.name];
    if (!spec || spec.startsWith('catalog:') || (semver.validRange(spec) && semver.satisfies(item.to, spec))) continue;
    console.log(`  also installing ${item.name}@${item.to}, which the update left at ${spec}`);
    const added = shell(`${manager()} ${item.name}@${item.to}`);
    if (!added.ok) fail(`installing ${item.name}@${item.to}`, added.out);
  }
  git('add', '-A');
  const commit = git('commit', '-q', '-m', `chore(deps): upgrade to Angular ${hop.major}`);
  if (commit.status !== 0) { fail(`the commit for ${hop.major}`, `${commit.stdout}${commit.stderr}`); break; }
  const now = checks();
  console.log(`  ${verdicts(now)}`);
  for (const [name, result] of Object.entries(now)) if (baseline[name].ok && !result.ok) fail(`the ${name} at Angular ${hop.major}, which passed at the start`, result.out);
  reached = hop.major;
}

console.log(`\nResult: ${failures.length ? `FAILED (${failures.join('; ')})` : 'PASS'}, reached Angular ${reached}.`);
process.exitCode = failures.length ? 1 : 0;
