import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, test } from 'node:test';
import { runScript, UPDATE } from './helpers/harness.mjs';

const made = [];
after(() => made.forEach(dir => rmSync(dir, { recursive: true, force: true })));
const packages = ['@angular/core@22', '@angular/cli@22', '@fortawesome/angular-fontawesome@5.1.0'];
const driverSource = `const fs = require('node:fs');
fs.writeFileSync(process.env.TEST_CAPTURE, JSON.stringify({ calls: fs.existsSync(process.env.TEST_CAPTURE) ? JSON.parse(fs.readFileSync(process.env.TEST_CAPTURE, 'utf8')).calls + 1 : 1, args: process.argv.slice(2), cwd: process.cwd(), dispatch: process.env.NG_DISABLE_VERSION_CHECK, controls: Object.keys(process.env).filter(k => k.toLowerCase() === 'ng_disable_version_check'), analytics: process.env.NG_CLI_ANALYTICS, emittedSecret: Boolean(process.env.TEST_EMIT_SECRET) }));
if (process.env.TEST_EMIT_SECRET) console.log(process.env.TEST_SENTINEL_TOKEN);
if (process.env.TEST_PEER_FAILURE) { console.error('Package has an incompatible peer dependency'); process.exitCode = 2; }
else console.log('Executing migrations of package: fake CLI control');
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ng-hop updater's test-")); made.push(root);
  const project = join(root, 'app'); mkdirSync(project);
  const driver = join(root, 'pnpm.cjs'), capture = join(root, 'capture.json');
  writeFileSync(driver, driverSource);
  writeFileSync(join(project, 'package.json'), '{"private":true,"dependencies":{"@angular/core":"21.2.0"}}\n');
  writeFileSync(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n');
  writeFileSync(join(project, 'tracked.txt'), 'clean\n');
  const git = (args) => { const r = spawnSync('git', args, { cwd: project, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git(['init', '--initial-branch=main']); git(['add', '--all']);
  git(['-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture']);
  return { root, project, driver, capture, env: { npm_execpath: driver, TEST_CAPTURE: capture }, read: () => JSON.parse(readFileSync(capture, 'utf8')) };
}

test('pnpm updater: selected target CLI gets scoped version dispatch, not a Git or peer bypass', async () => {
  const f = fixture();
  const parent = process.env.NG_DISABLE_VERSION_CHECK;
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, ng_disable_version_check: 'false' } });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  const called = f.read();
  assert.deepEqual(called.args, ['dlx', '@angular/cli@22', 'update', ...packages]);
  // macOS's temp folder is a symlink, and a process reports the real path.
  assert.equal(realpathSync(called.cwd), realpathSync(f.project));
  assert.equal(called.dispatch, 'true');
  assert.deepEqual(called.controls, ['NG_DISABLE_VERSION_CHECK']);
  assert.equal(called.analytics, 'false');
  assert.equal(called.calls, 1);
  assert.doesNotMatch(called.args.join(' '), /--force|--allow-dirty|--legacy-peer-deps/);
  assert.equal(process.env.NG_DISABLE_VERSION_CHECK, parent);
  assert.match(JSON.parse(r.stdout).stdout, /Executing migrations/);
});

test('pnpm updater: dirty work stops before pnpm, with a working clean control above', async () => {
  const f = fixture(); writeFileSync(join(f.project, 'tracked.txt'), 'user work\n');
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: f.env });
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).error, /Repository is not clean/);
  assert.equal(existsSync(f.capture), false);
  assert.equal(readFileSync(join(f.project, 'tracked.txt'), 'utf8'), 'user work\n');
});

test('pnpm updater: peer failure is propagated once, never retried or forced', async () => {
  const f = fixture();
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, TEST_PEER_FAILURE: '1' } });
  assert.equal(r.code, 2);
  assert.match(JSON.parse(r.stdout).stderr, /incompatible peer dependency/);
  assert.deepEqual(f.read().args, ['dlx', '@angular/cli@22', 'update', ...packages]);
  assert.equal(f.read().calls, 1);
});

for (const option of ['--force', '--allow-dirty', '--legacy-peer-deps']) {
  test(`pnpm updater: ${option} is not an execution option`, async () => {
    const f = fixture();
    const r = await runScript(UPDATE, ['--json', ...packages, option], { cwd: f.project, env: f.env });
    assert.equal(r.code, 1);
    assert.equal(existsSync(f.capture), false);
  });
}

test('pnpm updater: invalid package names are rejected before reaching a process', async () => {
  const f = fixture();
  const r = await runScript(UPDATE, ['--json', ...packages, 'ui;echo injected@1.0.0'], { cwd: f.project, env: f.env });
  assert.equal(r.code, 1);
  assert.equal(existsSync(f.capture), false);
});

test('pnpm updater: a patch release runs that exact target CLI', async () => {
  const f = fixture();
  const specs = ['@angular/core@21.2.26', '@angular/cli@21.2.29'];
  const r = await runScript(UPDATE, ['--json', ...specs], { cwd: f.project, env: f.env });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.deepEqual(f.read().args, ['dlx', '@angular/cli@21.2.29', 'update', ...specs]);
});

test('pnpm updater: a patch that only moves the CLI is allowed', async () => {
  const f = fixture();
  const r = await runScript(UPDATE, ['--json', '@angular/cli@21.2.29'], { cwd: f.project, env: f.env });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.deepEqual(f.read().args, ['dlx', '@angular/cli@21.2.29', 'update', '@angular/cli@21.2.29']);
});

test('pnpm updater: exact versions on different majors are still refused', async () => {
  const f = fixture();
  const r = await runScript(UPDATE, ['--json', '@angular/core@21.2.26', '@angular/cli@22.0.0'], { cwd: f.project, env: f.env });
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).error, /same target major/);
  assert.equal(existsSync(f.capture), false);
});

test('pnpm updater: framework requests must name the same single target major', async () => {
  const f = fixture();
  const r = await runScript(UPDATE, ['--json', '@angular/core@21', '@angular/cli@22'], { cwd: f.project, env: f.env });
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).error, /same target major/);
  assert.equal(existsSync(f.capture), false);
});

test('pnpm updater: unavailable pnpm does not provision a manager or fall back to npm', async () => {
  const f = fixture();
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, npm_execpath: '', COREPACK_ROOT: '', [pathKey]: '' } });
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).error, /find pnpm/);
  assert.equal(existsSync(f.capture), false);
});

test('pnpm updater: captured JSON redacts secrets from child output', async () => {
  const f = fixture(), secret = 'fixture-sentinel-not-a-real-credential';
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, TEST_EMIT_SECRET: '1', TEST_SENTINEL_TOKEN: secret } });
  assert.equal(r.code, 0);
  assert.equal(f.read().emittedSecret, true);
  assert.ok(!r.stdout.includes(secret));
  assert.match(JSON.parse(r.stdout).stdout, /\[redacted\]/);
});

test('pnpm updater: executable shims are resolved without running a command shell', async () => {
  const f = fixture(), bin = join(f.root, 'bin'); mkdirSync(bin);
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'pnpm.cjs'), driverSource);
    writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\nnode "%~dp0\\pnpm.cjs" %*\r\n');
  } else {
    writeFileSync(join(bin, 'pnpm'), '#!' + process.execPath + '\n' + driverSource, { mode: 0o755 });
  }
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, npm_execpath: '', COREPACK_ROOT: '', [pathKey]: bin + delimiter + process.env[pathKey] } });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.equal(f.read().dispatch, 'true');
});
