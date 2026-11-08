import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOGIN_VARS } from './login-vars.mjs';

// The agent needs its login and nothing else does: harness installs and grader rebuilds run third-party install
// scripts, so the login leaves this process's environment before any of them can start. CI passes it on stdin instead,
// because /proc/<pid>/environ keeps whatever a process was started with, deleted or not.
const loginEnv = Object.fromEntries(LOGIN_VARS.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
for (const name of LOGIN_VARS) delete process.env[name];
const loginOnStdin = process.env.NG_HOP_LOGIN_ON_STDIN ? readFileSync(0, 'utf8').trim() : null;
delete process.env.NG_HOP_LOGIN_ON_STDIN;
if (loginOnStdin === '') throw new Error('No login on stdin. Add a CLAUDE_CODE_OAUTH_TOKEN repository secret, made with `claude setup-token`.');

// Safe to print, and enough to spot a token that got cut off or broken across lines when it was pasted in.
export const describeLogin = () => (loginOnStdin === null
  ? 'not passed on stdin'
  : `${loginOnStdin.length} characters, ${/\s/.test(loginOnStdin) ? 'with whitespace inside it' : 'no whitespace'}, ${loginOnStdin.startsWith('sk-ant-oat') ? 'starts like a setup token' : 'does not start like a setup token'}`);

// Starts Claude Code with the login. From stdin it goes over a descriptor, which Claude Code reads and closes, so it
// never sits in an environment for an install script to find.
export function spawnAgent(args, { env, stdio, ...options }) {
  const agentEnv = { ...process.env, ...env };
  delete agentEnv.CLAUDECODE;
  // shortcut: a login from the environment stays in the agent's, which only a local run does. There, the same user's own login file is just as readable, so moving this to a descriptor would protect nothing.
  if (loginOnStdin === null) return spawn('claude', args, { ...options, env: { ...agentEnv, ...loginEnv }, stdio });
  const child = spawn('claude', args, { ...options, env: { ...agentEnv, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' }, stdio: [...stdio, 'pipe'] });
  child.stdio[3].on('error', () => { /* it exited before reading this, and its own error says why */ });
  child.stdio[3].end(`${loginOnStdin}\n`);
  return child;
}

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN = join(REPO, 'plugins', 'ng-hop');
// Outside the repo: real node_modules go here, and Windows path limits rule out anything deeper.
export const WORKSPACE = process.env.NG_HOP_WORKSPACE || resolve(REPO, '..', 'ng-hop-workspace');
export const TEMPLATES = join(WORKSPACE, 'templates');

// Angular 20 apps test with Karma, and 21 onward with Vitest through the unit-test builder.
export function testCommand(dir) {
  const ng = JSON.parse(readFileSync(join(dir, 'angular.json'), 'utf8'));
  const builder = Object.values(ng.projects)[0].architect?.test?.builder || '';
  return builder.includes('karma') ? 'npx ng test --watch=false --browsers=ChromeHeadless' : 'npx ng test --watch=false';
}

// Reinstalls with the checks on, the same way someone cloning the result would.
export const installCommand = (dir) => (existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm install --frozen-lockfile'
  : existsSync(join(dir, 'yarn.lock')) ? 'yarn install --immutable'
  : existsSync(join(dir, 'bun.lock')) ? 'bun install --frozen-lockfile'
  : 'npm ci --no-audit --no-fund');

export const exists = existsSync;
