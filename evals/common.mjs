import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export const installCommand = (dir) => (existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm install --frozen-lockfile' : 'npm ci --no-audit --no-fund');

export const exists = existsSync;
