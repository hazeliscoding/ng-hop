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

test('pnpm updater: pnpm 12\'s native binary, which pnpm exec names in npm_execpath, is run directly', { skip: process.platform === 'win32' && 'a fake native binary needs a POSIX shebang' }, async () => {
  const f = fixture(), native = join(f.root, 'pnpm-native');
  writeFileSync(native, '#!' + process.execPath + '\n' + driverSource, { mode: 0o755 });
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, npm_execpath: native, COREPACK_ROOT: '' } });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.deepEqual(f.read().args, ['dlx', '@angular/cli@22', 'update', ...packages]);
});

test('pnpm updater: a pnpm script in .mjs, as pnpm 12 ships, is run through Node', async () => {
  const f = fixture(), script = join(f.root, 'pnpm.mjs');
  writeFileSync(script, driverSource.replace("const fs = require('node:fs');", "import fs from 'node:fs';"));
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, npm_execpath: script, COREPACK_ROOT: '' } });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.equal(f.read().dispatch, 'true');
});

test('pnpm updater: a shim that names its script twice, as corepack writes one, is still read', { skip: process.platform !== 'win32' && 'only Windows runs pnpm through a .cmd shim' }, async () => {
  const f = fixture(), bin = join(f.root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm.cjs'), driverSource);
  writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\nIF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe" "%~dp0\\pnpm.cjs" %*\r\n) ELSE (\r\n  node "%~dp0\\pnpm.cjs" %*\r\n)\r\n');
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, npm_execpath: '', COREPACK_ROOT: '', [pathKey]: bin + delimiter + process.env[pathKey] } });
  assert.equal(r.code, 0, r.stderr || r.stdout);
});

test('yarn updater: the target CLI runs from npm\'s own cache, so Angular never installs a temporary one through yarn', async () => {
  // On yarn 4, `yarn ng update` stopped at "Installing a temporary Angular CLI" with no error.
  const f = fixture();
  rmSync(join(f.project, 'pnpm-lock.yaml'));
  writeFileSync(join(f.project, 'yarn.lock'), '# yarn lockfile\n');
  const git = (args) => spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd: f.project, encoding: 'utf8' });
  git(['add', '--all']); git(['commit', '-m', 'yarn']);
  const npm = join(f.root, 'npm-cli.js');
  writeFileSync(npm, driverSource);
  const r = await runScript(UPDATE, ['--json', ...packages], { cwd: f.project, env: { ...f.env, npm_execpath: npm } });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.deepEqual(f.read().args, ['exec', '--yes', '--package=@angular/cli@22', '--', 'ng', 'update', ...packages]);
  assert.equal(f.read().dispatch, 'true', 'the target CLI keeps control instead of handing back to the app\'s old one');
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

// ---- installing a library first ------------------------------------------------------------------------------------

// Stands in for pnpm, yarn and npm, and logs each call. `add` saves each spec in package.json, in the section it's
// already in, and changes the lockfile, as pnpm 12 and yarn 4 both do.
const addDriver = `const fs = require('node:fs');
const log = fs.existsSync(process.env.TEST_LOG) ? JSON.parse(fs.readFileSync(process.env.TEST_LOG, 'utf8')) : [];
log.push(process.argv.slice(2));
fs.writeFileSync(process.env.TEST_LOG, JSON.stringify(log));
if (process.argv[2] === 'add') {
  if (process.env.TEST_ADD_FAILS) { console.error('ERR_PNPM_NO_MATURE_MATCHING_VERSION'); process.exit(1); }
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const spec of process.argv.slice(3)) {
    const at = spec.lastIndexOf('@'), name = spec.slice(0, at);
    (pkg.devDependencies?.[name] ? pkg.devDependencies : pkg.dependencies)[name] = spec.slice(at + 1);
  }
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
  fs.appendFileSync(fs.existsSync('yarn.lock') ? 'yarn.lock' : 'pnpm-lock.yaml', '# changed\\n');
  // pnpm 12 writes an exemption itself, creating the file if it has to, for a release the list doesn't cover.
  if (process.env.TEST_ADD_EXEMPTS) fs.writeFileSync('pnpm-workspace.yaml', "minimumReleaseAgeExclude:\\n  - '@acme/ui-core@22.0.0'\\n");
}
`;

function firstFixture(manifest, { yarn = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ng-hop install-first-')); made.push(root);
  const project = join(root, 'app'), bin = join(root, 'bin'); mkdirSync(project); mkdirSync(bin);
  const log = join(root, 'log.json');
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ private: true, ...manifest }, null, 2)}\n`);
  writeFileSync(join(project, yarn ? 'yarn.lock' : 'pnpm-lock.yaml'), '# lockfile\n');
  writeFileSync(join(project, 'tracked.txt'), 'clean\n');
  const git = (args) => { const r = spawnSync('git', args, { cwd: project, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git(['init', '--initial-branch=main']); git(['add', '--all']);
  git(['-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture']);
  // pnpm arrives through npm_execpath, as `pnpm exec` sets it. A yarn project's update runs through npm, and its
  // install through the yarn on the path, which on Windows is a .cmd shim.
  const driver = join(root, yarn ? 'npm-cli.js' : 'pnpm.cjs');
  writeFileSync(driver, addDriver);
  if (yarn && process.platform === 'win32') {
    writeFileSync(join(bin, 'yarn.cjs'), addDriver);
    writeFileSync(join(bin, 'yarn.cmd'), '@echo off\r\nnode "%~dp0\\yarn.cjs" %*\r\n');
  } else if (yarn) writeFileSync(join(bin, 'yarn'), '#!' + process.execPath + '\n' + addDriver, { mode: 0o755 });
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
  return {
    project,
    env: { npm_execpath: driver, TEST_LOG: log, COREPACK_ROOT: '', [pathKey]: bin + delimiter + process.env[pathKey] },
    log: () => (existsSync(log) ? JSON.parse(readFileSync(log, 'utf8')) : []),
    read: (file) => readFileSync(join(project, file), 'utf8'),
  };
}

const acme = { dependencies: { '@angular/core': '21.2.0', '@acme/ui-core': '^21.4.0' }, devDependencies: { '@acme/ui-testing': '21.4.0' } };
const acmeHop = ['@angular/core@22', '@angular/cli@22', '@acme/ui-core@22.0.0', '@acme/ui-testing@22.0.0'];
const first = ['--install-first', '@acme/ui-core', '--install-first', '@acme/ui-testing'];

test('pnpm updater: --install-first installs those libraries first, in the form package.json uses, then updates the rest', async () => {
  // Angular CLI 22.1 and newer skip a release younger than pnpm's minimum release age, a day by default, and read no
  // exemption list. An installed release is read from node_modules instead, so installing it first gets it through.
  const f = firstFixture(acme);
  const r = await runScript(UPDATE, ['--json', ...first, ...acmeHop], { cwd: f.project, env: f.env });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.deepEqual(f.log(), [
    ['add', '@acme/ui-core@^22.0.0', '@acme/ui-testing@22.0.0'],
    ['dlx', '@angular/cli@22', 'update', '@angular/core@22', '@angular/cli@22', '--allow-dirty'],
  ], 'the caret stays, an exact pin stays exact, and the update leaves out what is installed already');
  assert.deepEqual(JSON.parse(r.stdout).installedFirst, ['@acme/ui-core@^22.0.0', '@acme/ui-testing@22.0.0']);
});

test('yarn updater: --install-first installs through the project\'s yarn, and the update still runs through npm', async () => {
  const f = firstFixture(acme, { yarn: true });
  const r = await runScript(UPDATE, ['--json', ...first, ...acmeHop], { cwd: f.project, env: f.env });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.deepEqual(f.log(), [
    ['add', '@acme/ui-core@^22.0.0', '@acme/ui-testing@22.0.0'],
    ['exec', '--yes', '--package=@angular/cli@22', '--', 'ng', 'update', '@angular/core@22', '@angular/cli@22', '--allow-dirty'],
  ]);
});

test('pnpm updater: --install-first still starts from a clean tree, with the working run above as its control', async () => {
  // Leftovers from an interrupted major dirty the same files, and ng update would skip their migrations.
  const f = firstFixture(acme);
  writeFileSync(join(f.project, 'package.json'), f.read('package.json').replace('^21.4.0', '^22.0.0'));
  const r = await runScript(UPDATE, ['--json', ...first, ...acmeHop], { cwd: f.project, env: f.env });
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).error, /Repository is not clean/);
  assert.deepEqual(f.log(), []);
});

test('pnpm updater: an install that changes more than package.json and the lockfile stops before the update', async () => {
  // An exemption pnpm writes itself is a safeguard relaxed, which is the person's call, so it isn't carried into a hop.
  const f = firstFixture(acme);
  const r = await runScript(UPDATE, ['--json', ...first, ...acmeHop], { cwd: f.project, env: { ...f.env, TEST_ADD_EXEMPTS: '1' } });
  assert.equal(r.code, 1);
  const { error } = JSON.parse(r.stdout);
  assert.match(error, /pnpm-workspace\.yaml/);
  assert.match(error, /no update was run/);
  assert.deepEqual(f.log().map((call) => call[0]), ['add']);
});

test('pnpm updater: a failed install stops before the update', async () => {
  const f = firstFixture(acme);
  const r = await runScript(UPDATE, ['--json', ...first, ...acmeHop], { cwd: f.project, env: { ...f.env, TEST_ADD_FAILS: '1' } });
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).error, /no update was run/);
  assert.deepEqual(f.log().map((call) => call[0]), ['add']);
});

test('pnpm updater: --install-first takes only a library the command names at an exact version, with a range in package.json', async () => {
  const cases = [
    [['--install-first', '@angular/core'], acmeHop, acme, 'Angular itself, whose migrations ng update has to run'],
    [['--install-first', '@acme/ui-grid'], acmeHop, acme, 'a library the command does not name'],
    [['--install-first', '@acme/ui-core'], ['@angular/core@22', '@angular/cli@22', '@acme/ui-core@22'], acme, 'a major, not the exact version the plan names'],
    [['--install-first', '@acme/ui-core'], acmeHop, { dependencies: { '@angular/core': '21.2.0', '@acme/ui-core': 'catalog:' } }, 'a catalog entry, which an add would turn into a plain version'],
    [['--install-first', '@acme/ui-testing'], acmeHop, { dependencies: { '@angular/core': '21.2.0' } }, 'a library package.json does not list'],
  ];
  for (const [option, hop, manifest, why] of cases) {
    const f = firstFixture(manifest);
    const r = await runScript(UPDATE, ['--json', ...option, ...hop], { cwd: f.project, env: f.env });
    assert.equal(r.code, 1, why);
    assert.match(JSON.parse(r.stdout).error, /--install-first takes/, why);
    assert.deepEqual(f.log(), [], why);
  }
});

// ---- pnpm catalogs ------------------------------------------------------------------------------------------------

// Stands in for pnpm. On `dlx … update` it plays ng update, which moves whatever versions it finds in package.json.
const catalogDriver = `const fs = require('node:fs');
const log = fs.existsSync(process.env.TEST_LOG) ? JSON.parse(fs.readFileSync(process.env.TEST_LOG, 'utf8')) : [];
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
log.push({ args: process.argv.slice(2), deps: { ...pkg.dependencies } });
fs.writeFileSync(process.env.TEST_LOG, JSON.stringify(log));
if (process.argv[2] === 'dlx') {
  for (const name of Object.keys(pkg.dependencies)) if (name.startsWith('@angular/')) pkg.dependencies[name] = '^21.2.26';
  if (pkg.dependencies.primeng) pkg.dependencies.primeng = '21.1.10';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
  if (process.env.TEST_UPDATE_FAILS) process.exitCode = 2;
}
`;

function catalogFixture(workspaceYaml, deps) {
  const root = mkdtempSync(join(tmpdir(), 'ng-hop catalog-')); made.push(root);
  const project = join(root, 'app'); mkdirSync(project);
  const driver = join(root, 'pnpm.cjs'), log = join(root, 'log.json');
  writeFileSync(driver, catalogDriver);
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ private: true, dependencies: deps }, null, 2)}\n`);
  writeFileSync(join(project, 'pnpm-workspace.yaml'), workspaceYaml);
  writeFileSync(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n');
  const git = (args) => { const r = spawnSync('git', args, { cwd: project, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git(['init', '--initial-branch=main']); git(['add', '--all']);
  git(['-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture']);
  return {
    project, logFile: log, env: { npm_execpath: driver, TEST_LOG: log },
    log: () => JSON.parse(readFileSync(log, 'utf8')),
    read: (file) => readFileSync(join(project, file), 'utf8'),
  };
}

const CATALOGS = "packages:\n  - '.'\n\ncatalog:\n  '@angular/core': ^20.3.0\n  rxjs: ~7.8.0 # shared with the docs site\ncatalogs:\n  angular:\n    \"@angular/common\": '^20.3.0'\n";
const catalogDeps = { '@angular/core': 'catalog:', '@angular/common': 'catalog:angular', rxjs: 'catalog:', primeng: '20.4.0' };
const hop21 = ['@angular/core@21', '@angular/cli@21', 'primeng@21.1.10'];

test('pnpm updater: a catalog\'s versions go into package.json for the update, and the new ones go back into the catalog', async () => {
  // Through Angular 21's CLI, ng update skips a catalog: package and still exits 0, having moved nothing.
  const f = catalogFixture(CATALOGS, catalogDeps);
  const r = await runScript(UPDATE, ['--json', ...hop21], { cwd: f.project, env: f.env });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  const [update, install, ...more] = f.log();
  assert.deepEqual(update.deps, { '@angular/core': '^20.3.0', '@angular/common': '^20.3.0', rxjs: '~7.8.0', primeng: '20.4.0' }, 'ng update saw plain versions');
  assert.deepEqual(update.args, ['dlx', '@angular/cli@21', 'update', ...hop21, '--allow-dirty'], 'the only change it allows is its own, made after the tree was found clean');
  assert.deepEqual(install.args, ['install', '--no-frozen-lockfile']);
  assert.equal(more.length, 0);
  assert.deepEqual(JSON.parse(f.read('package.json')).dependencies, { '@angular/core': 'catalog:', '@angular/common': 'catalog:angular', rxjs: 'catalog:', primeng: '21.1.10' });
  assert.equal(f.read('pnpm-workspace.yaml'), CATALOGS.replace("'@angular/core': ^20.3.0", "'@angular/core': ^21.2.26").replace(`"@angular/common": '^20.3.0'`, `"@angular/common": '^21.2.26'`), 'only the entries that moved change, with their quoting and comments kept');
  assert.deepEqual(JSON.parse(r.stdout).catalog.map((c) => `${c.name} ${c.from} ${c.to}`), ['@angular/core ^20.3.0 ^21.2.26', '@angular/common ^20.3.0 ^21.2.26']);
});

test('pnpm updater: a failed update puts package.json back on its catalog entries, and leaves the catalog alone', async () => {
  const f = catalogFixture(CATALOGS, catalogDeps);
  const r = await runScript(UPDATE, ['--json', ...hop21], { cwd: f.project, env: { ...f.env, TEST_UPDATE_FAILS: '1' } });
  assert.equal(r.code, 2);
  assert.equal(f.log().length, 1, 'no install after a failed update');
  const deps = JSON.parse(f.read('package.json')).dependencies;
  for (const name of ['@angular/core', '@angular/common', 'rxjs']) assert.equal(deps[name], catalogDeps[name]);
  assert.equal(f.read('pnpm-workspace.yaml'), CATALOGS);
});

test('pnpm updater: a catalog it cannot edit safely is refused before anything runs', async () => {
  for (const [yaml, why] of [["catalog: { '@angular/core': ^20.3.0 }\n", 'one line'], ["catalog:\n  '@angular/cdk': ^20.0.0\n", 'no entry']]) {
    const f = catalogFixture(yaml, { '@angular/core': 'catalog:' });
    const r = await runScript(UPDATE, ['--json', '@angular/core@21', '@angular/cli@21'], { cwd: f.project, env: f.env });
    assert.equal(r.code, 1, why);
    assert.match(JSON.parse(r.stdout).error, /catalog/, why);
    assert.match(JSON.parse(r.stdout).error, /Nothing was changed/, why);
    assert.equal(existsSync(f.logFile), false, why);
    assert.deepEqual(JSON.parse(f.read('package.json')).dependencies, { '@angular/core': 'catalog:' }, why);
  }
});

test('pnpm updater: a project with no catalog is updated exactly as before', async () => {
  const f = catalogFixture("packages:\n  - '.'\n", { '@angular/core': '20.3.0' });
  const r = await runScript(UPDATE, ['--json', '@angular/core@21', '@angular/cli@21'], { cwd: f.project, env: f.env });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.deepEqual(f.log().map((c) => c.args), [['dlx', '@angular/cli@21', 'update', '@angular/core@21', '@angular/cli@21']]);
});
