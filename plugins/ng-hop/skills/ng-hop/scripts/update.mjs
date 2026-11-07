#!/usr/bin/env node
// pnpm-only execution transport. The plan selects versions; Angular still checks Git and peers and runs migrations.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const semver = createRequire(import.meta.url)('./vendor/semver.cjs');
const VALID_NAME = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;
const USAGE = 'Usage: update.mjs [--project <dir>] [--json] @angular/core@<version> @angular/cli@<version> [library@version ...]\nRuns the planned pnpm hop or patch once. No force flags, retries, resets, commits or manager provisioning.';

// Node cannot exec a Windows .cmd file without a shell. Read only the standard shim's literal script path instead.
function pnpmCommand(cwd) {
  const script = [process.env.npm_execpath, process.env.COREPACK_ROOT && join(process.env.COREPACK_ROOT, 'dist', 'pnpm.js')]
    .find(file => file && /[\\/]pnpm\.c?js$/i.test(file) && existsSync(resolve(cwd, file)));
  if (script) return { file: process.execPath, prefix: [resolve(cwd, script)] };
  const path = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const extensions = process.platform === 'win32' ? ['.exe', '.com', '.cmd', '.bat'] : [''];
  for (const dir of path.split(delimiter).filter(Boolean)) for (const extension of extensions) {
    const file = resolve(cwd, dir, 'pnpm' + extension);
    if (!existsSync(file)) continue;
    if (!/\.(?:cmd|bat)$/i.test(file)) return { file, prefix: [] };
    const matches = [...readFileSync(file, 'utf8').matchAll(/"%(?:dp0%|~dp0)[\\/]?([^"\r\n%]*pnpm\.c?js)"/gi)];
    if (matches.length === 1) {
      const target = resolve(dirname(file), matches[0][1].replace(/[\\/]/g, '/'));
      if (existsSync(target)) return { file: process.execPath, prefix: [target] };
    }
    throw new Error('Cannot resolve this pnpm shim without a shell. Use the existing Corepack or Node-script installation; no fallback was run.');
  }
  throw new Error('Could not find pnpm. Run the printed pnpm exec command with the already installed project package manager.');
}

function redact(text) {
  let value = String(text ?? '');
  for (const [key, secret] of Object.entries(process.env)) if (/token|secret|password|api.?key/i.test(key) && secret?.length >= 8) {
    for (const variant of [secret, encodeURIComponent(secret)]) value = value.split(variant).join('[redacted]');
  }
  return value.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@').replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{8,}|\bnpm_[A-Za-z0-9]{8,}/g, '[redacted]');
}

function main() {
  const { values, positionals } = parseArgs({ options: { project: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' } }, allowPositionals: true });
  if (values.help) { console.log(USAGE); return 0; }
  const names = new Set();
  for (const spec of positionals) {
    const at = spec.lastIndexOf('@'), name = spec.slice(0, at), version = spec.slice(at + 1);
    if (at < 1 || !VALID_NAME.test(name) || !semver.validRange(version) || names.has(name)) throw new Error('Invalid or duplicate package specifier. Use the exact packages from the plan.');
    names.add(name);
  }
  // A hop names majors for both. A patch names exact versions, and may only move the CLI.
  const cli = /^@angular\/cli@(\d+)(?:\.\d+\.\d+)?$/.exec(positionals.find(spec => spec.startsWith('@angular/cli@')) || '');
  const core = positionals.find(spec => spec.startsWith('@angular/core@'));
  const major = Number(cli?.[1]);
  if (!Number.isSafeInteger(major) || major < 2 || (core && semver.coerce(core.slice('@angular/core@'.length))?.major !== major)) throw new Error('The framework requests must name the same target major for @angular/core and @angular/cli.');
  const cwd = resolve(values.project || '.');
  const pnpm = pnpmCommand(cwd);
  const status = spawnSync('git', ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8', windowsHide: true });
  if (status.status !== 0) throw new Error('Could not verify the Git working tree. No update was run.');
  if (status.stdout.trim()) throw new Error('Repository is not clean. Preserve and inspect the changes before another update.');
  const env = { ...process.env };
  const controls = { NG_DISABLE_VERSION_CHECK: 'true', NG_CLI_ANALYTICS: 'false', COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', COREPACK_ENV_FILE: '0', npm_config_manage_package_manager_versions: 'false', npm_config_pm_on_fail: 'error' };
  for (const key of Object.keys(env)) if (Object.keys(controls).some(owned => owned.toLowerCase() === key.toLowerCase())) delete env[key];
  Object.assign(env, controls);
  // Angular's own temporary runner uses this same child-only dispatch control. It does not bypass Git or peers.
  const args = ['dlx', cli[0], 'update', ...positionals];
  const result = spawnSync(pnpm.file, [...pnpm.prefix, ...args], { cwd, env, encoding: 'utf8', windowsHide: true, stdio: values.json ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 });
  const exitCode = result.status ?? 1;
  if (values.json) console.log(JSON.stringify({ exitCode, targetMajor: major, command: ['pnpm', ...args], stdout: redact(result.stdout), stderr: redact(result.stderr), error: result.error ? 'The update process did not finish. Inspect its outcome before another attempt.' : null }, null, 2));
  else if (result.status === null) console.error('The update process did not finish. Inspect its outcome before another attempt.');
  return exitCode;
}

try { process.exitCode = main(); }
catch (error) {
  const message = redact(error.message);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ exitCode: 1, error: message }));
  else console.error(message);
  process.exitCode = 1;
}
