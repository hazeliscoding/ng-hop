import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { managerCommand } from '../plugins/ng-hop/skills/ng-hop/scripts/manager.mjs';
import { fakeManager, plan } from './helpers/harness.mjs';
import { ageOf, app, base, lockBase, npmApp, pnpm12, pnpm21, pnpmImporter, pnpmLock, webApp, world, yarn21, youngLib } from './helpers/plan-fixtures.mjs';

// ---- Release age: what the package manager and ng update hold back --------------------------------------------------

const inside = (path, dir) => { const rel = relative(dir, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
// A script that leaves a .ran file beside itself when anything runs it.
const MARKER = "require('fs').writeFileSync(__filename + '.ran', '');\n";
const ran = (dir) => readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.ran'));
// Every file in a folder with its contents, to see that nothing changed.
const listing = (dir) => readdirSync(dir, { recursive: true }).sort().map((f) => [f, statSync(join(dir, f)).isFile() ? readFileSync(join(dir, f), 'utf8') : null]);

test('a package manager that can\'t be asked leaves release age unchecked, and says so, rather than guessing', async () => {
  const r = await plan(world(youngLib()), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: { '--version': null } });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.plan.unchecked.some((u) => u.name === 'release age'), JSON.stringify(r.plan.unchecked));
  const asked = await plan(world(youngLib()), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: pnpm12 });
  assert.ok(!asked.plan.unchecked.some((u) => u.name === 'release age'), 'positive control');
  assert.equal(asked.code, 2);
  const odd = await plan(world(youngLib()), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: { ...pnpm12, '--version': 'oops' } });
  assert.match(odd.plan?.unchecked.find((u) => u.name === 'release age')?.reason ?? odd.stderr, /\(it printed "oops"\)/);
});

test('why release age went unchecked keeps the manager\'s whole last line, and says to plan again once dependencies are installed', async () => {
  // Corepack, kept offline, with the pnpm it falls back to not in its cache. Step 3's install fetches that pnpm.
  const offline = 'Network access disabled by the environment; can\'t reach https://registry.npmjs.org/pnpm/-/pnpm-12.15.0.tgz';
  const r = await plan(world(youngLib()), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: { '--version': { stderr: offline } } });
  assert.equal(r.plan.unchecked.find((u) => u.name === 'release age')?.reason, `pnpm couldn't be asked for its version (${offline}), which its minimum release age depends on, so a release younger than that can still stop a command; plan again once the dependencies are installed`);
});

test('the plan asks an unpinned pnpm only its version, from an empty folder outside the project, and a pinned one nothing', async () => {
  // pnpm 12.16.1's --version, in a project whose package.json pins pnpm, wrote packageManagerDependencies into
  // pnpm-lock.yaml unless pnpm_config_pm_on_fail was ignore, and yarn 4.18.1 ran a yarnPath script for --version. So the
  // age comes from files, and only a version nothing pins is asked, of the person's own manager, from a folder of its
  // own. On Windows a name has no case, and Node passes on the first spelling in sort order, so the person's own
  // uppercase setting would win over the plan's. Corepack stays offline too, so the plan never downloads a manager, and
  // reads no package.json pin, since from a folder in the home folder a stray one above it would choose the version.
  const set = { PNPM_CONFIG_PM_ON_FAIL: 'download', COREPACK_ENABLE_NETWORK: '1', COREPACK_ENABLE_PROJECT_SPEC: '1' };
  const saved = Object.fromEntries(Object.keys(set).map((key) => [key, process.env[key]]));
  Object.assign(process.env, set);
  const proj = pnpm21({});
  let r, pinned;
  try {
    r = await plan(world(), proj, { to: 22, manager: pnpm12 });
    pinned = await plan(world(), pnpm21({}, { pin: 'pnpm@12.16.1' }), { to: 22, manager: pnpm12 });
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  assert.deepEqual(r.plan.releaseAge, { manager: 'pnpm', version: '12.16.1', setting: 'minimum-release-age', minutes: 1440, default: true, ngUpdateReads: true, from: 'default' });
  // Corepack 0.35.0 and pnpm 10 and 11 turn on Node's compile cache, which they leave in the temporary folder.
  assert.deepEqual(r.asked.map((a) => [a.args, a.pmOnFail, a.corepack, a.ignorePath, a.compileCache]), [['--version', 'ignore', ['0', '0', '0', '0'], '1', '1']]);
  assert.ok(!inside(r.asked[0].cwd, proj.dir), `asked from ${r.asked[0].cwd}`);
  assert.ok(!existsSync(r.asked[0].cwd), 'and that folder is gone');
  assert.deepEqual([pinned.asked, pinned.plan.releaseAge.version], [[], '12.16.1']);
});

test('nothing from a yarn repo runs: its yarnPath and plugins stay unloaded, and the age still comes from .yarnrc.yml', async () => {
  // yarn 4.18.1 ran a yarnPath script for --version and loads plugins as it starts, so asking yarn anything in the repo
  // runs code the repo commits. The stand-in loads them the same way, as the control shows.
  const repo = ({ pin, yarnPath }) => yarn21({ pin, files: {
    '.yarnrc.yml': `${yarnPath ? 'yarnPath: .yarn/releases/yarn-4.18.1.cjs\n' : ''}plugins:\n  - path: .yarn/plugins/plugin.cjs\nnpmMinimalAgeGate: 60\n`,
    '.yarn/releases/yarn-4.18.1.cjs': MARKER,
    '.yarn/plugins/plugin.cjs': MARKER,
  } });
  const control = repo({ pin: 'yarn@4.18.1', yarnPath: true });
  const stand = fakeManager('yarn', { '--version': '4.18.1' });
  try { spawnSync(process.execPath, [stand.file, '--version'], { cwd: control.dir }); } finally { stand.remove(); }
  assert.equal(ran(control.dir).length, 2, 'the control: run in the repo, the stand-in runs both');

  const pinned = repo({ pin: 'yarn@4.18.1', yarnPath: true });
  const r = await plan(world(), pinned, { to: 22, manager: { '--version': '4.18.1' } });
  assert.deepEqual(r.plan.releaseAge, { manager: 'yarn', version: '4.18.1', setting: 'npmMinimalAgeGate', minutes: 60, ngUpdateReads: true, from: join(pinned.dir, '.yarnrc.yml') });
  assert.deepEqual([r.asked, ran(pinned.dir)], [[], []]);
  const unpinned = repo({});
  const asked = await plan(world(), unpinned, { to: 22, manager: { '--version': '4.18.1' } });
  assert.equal(asked.plan.releaseAge.minutes, 60);
  assert.deepEqual(asked.asked.map((a) => a.args), ['--version']);
  assert.ok(!inside(asked.asked[0].cwd, unpinned.dir), `asked from ${asked.asked[0].cwd}`);
  assert.deepEqual(ran(unpinned.dir), []);
});

test('the plan asks from a folder in the home folder, since any account can leave settings in a shared temporary folder above it', async () => {
  // yarn 4.18.1 loaded the plugins of a .yarnrc.yml in any folder up from where it ran, YARN_IGNORE_PATH or not, and
  // pnpm 10 and 11 a .pnpmfile.cjs beside any pnpm-workspace.yaml there. On Linux the temporary folder is /tmp, where
  // every account can write. The stand-in loads them the same way, as the control shows.
  const sharedTmp = () => join(app({ files: { 'tmp/.yarnrc.yml': 'plugins:\n  - path: ./plugin.cjs\n', 'tmp/plugin.cjs': MARKER, 'tmp/below/.keep': '' } }).dir, 'tmp');
  const control = sharedTmp();
  const stand = fakeManager('yarn', { '--version': '4.18.1' });
  try { spawnSync(process.execPath, [stand.file, '--version'], { cwd: join(control, 'below') }); } finally { stand.remove(); }
  assert.deepEqual(ran(control), ['plugin.cjs.ran'], 'the control: below that folder, the stand-in loads its plugin');
  const tmp = sharedTmp();
  const r = await plan(world(), yarn21(), { to: 22, manager: { '--version': '4.18.1' }, env: { TMPDIR: tmp, TEMP: tmp, TMP: tmp } });
  assert.deepEqual([r.asked.map((a) => a.args), ran(tmp), r.plan.releaseAge?.minutes], [['--version'], [], 1440]);
  assert.ok(!inside(r.asked[0].cwd, tmp), `asked from ${r.asked[0].cwd}`);
});

test('a relative PATH entry into the project never runs the pnpm, npm or node it holds, and the pnpm asked is the one outside it', async () => {
  // A relative PATH entry is looked up from the folder a command starts in, so from the project, bin/pnpm here would be
  // the project's own code, as the control shows. Without npm_execpath or COREPACK_ROOT, PATH is where pnpm is found.
  // npm runs in the project, so on Linux and macOS a bare npm, or the node its #!/usr/bin/env node names, was too.
  const shell = '#!/bin/sh\n: > "$0.ran"\necho {}\n';
  const proj = pnpm21({}, { files: { 'bin/pnpm.cjs': MARKER, 'bin/pnpm.cmd': '@"%~dp0\\pnpm.cjs" %*\r\n', 'bin/pnpm': `#!/usr/bin/env node\n${MARKER}`, 'bin/npm': shell, 'bin/node': shell } });
  for (const name of ['pnpm', 'npm', 'node']) chmodSync(join(proj.dir, 'bin', name), 0o755);
  // The person's own pnpm, outside the repo and after bin on PATH, is the one asked: the repo's, found from the project,
  // would be passed over as the repo's code, and the age left unknown, with nothing run either way.
  const own = fakeManager('pnpm', pnpm12);
  writeFileSync(join(dirname(own.file), 'pnpm.cmd'), '@"%~dp0\\pnpm.cjs" %*\r\n');
  // Its script by full path, since this PATH has no dirname on Linux and macOS, where Node's folder holds only Node's.
  writeFileSync(join(dirname(own.file), 'pnpm'), `#!/bin/sh\nexec '${process.execPath}' '${own.file}' "$@"\n`);
  chmodSync(join(dirname(own.file), 'pnpm'), 0o755);
  const env = { PATH: ['bin', dirname(own.file), dirname(process.execPath)].join(delimiter), npm_execpath: undefined, COREPACK_ROOT: undefined };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  let found;
  try {
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    found = managerCommand(proj.dir, 'pnpm');
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  assert.ok(inside(found.prefix[0] ?? found.file, proj.dir), `the control: from the project, PATH finds ${found.prefix[0] ?? found.file}`);
  const r = await plan(world(), proj, { to: 22, env });
  try {
    assert.deepEqual([ran(proj.dir), own.asked().map((a) => a.args), r.plan.releaseAge?.version], [[], ['--version'], '12.16.1']);
  } finally {
    own.remove();
  }
});

test('npm is never one the repo holds, through a relative npm_execpath or one into the repo', async () => {
  // A relative npm_execpath was checked from the folder the plan started in and run from the one npm runs in, both the
  // project here, as SKILL.md runs the plan. This npm answers with the fake registry, so a plan that ran it went on.
  const npm = `${MARKER}console.log(JSON.stringify({ registry: process.env.npm_config_registry }));\n`;
  for (const relative of [true, false]) {
    const proj = app({ deps: base, lock: lockBase, files: { 'node_modules/npm/bin/npm-cli.js': npm } });
    const execpath = join(...(relative ? [] : [proj.dir]), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const r = await plan(world(), proj, { to: 21, env: { npm_execpath: execpath } });
    assert.deepEqual([r.code, ran(proj.dir)], [0, []], execpath);
  }
});

test('npm writes nothing where the repo\'s .npmrc says, and the plan leaves nothing in the temporary folder', async () => {
  // A repo's .npmrc names npm's logs-dir and cache, and npm 11.19.0 wrote its debug log there, which quotes a key it
  // doesn't know word for word, so logs-dir=~/.bashrc.d put the repo's text in a file a shell runs, and its update
  // check's stamp. It also left Node's compile cache in the temporary folder, which nothing removes.
  const chosen = join(app({}).dir, 'chosen'), tmp = join(app({ files: { 'tmp/.keep': '' } }).dir, 'tmp');
  const forward = (path) => path.split(sep).join('/');
  const r = await plan(world(), npmApp(`logs-dir=${forward(chosen)}/logs\ncache=${forward(chosen)}/cache\n`), { to: 22, env: { TMPDIR: tmp, TEMP: tmp, TMP: tmp } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual([existsSync(chosen), readdirSync(tmp)], [false, ['.keep']]);
});

test('a pnpm or yarn inside the repo isn\'t run, wherever the plan finds it', async () => {
  // npm_execpath, COREPACK_ROOT or an absolute PATH entry can name a manager inside the repo, which is the repo's code.
  const proj = pnpm21({}, { files: { 'tools/pnpm.cjs': MARKER } });
  const age = await ageOf(proj, { env: { npm_execpath: join(proj.dir, 'tools', 'pnpm.cjs') } });
  assert.deepEqual(ran(proj.dir), []);
  assert.match(age, /^pnpm wasn't asked for its version, which its minimum release age depends on, since the one the plan found, .*pnpm\.cjs, is inside the app's folder and is the repo's code, so a release younger than that age can still stop a command; /);
  assert.equal((await ageOf(pnpm21({}), { manager: pnpm12 })).minutes, 1440, 'the control: one outside it answers');
});

test('the repo\'s folders are told by what they are, not how a path spells them, and with no .git by the settings the plan reads', async () => {
  // A child keeps the spelling of its working folder on Windows, and yarn walks up from that, so a home folder reached
  // through a junction in the repo put yarn in the repo, though its real path was outside.
  const repo = yarn21({ files: { '.yarnrc.yml': 'plugins:\n  - path: ./plugin.cjs\n', 'plugin.cjs': MARKER } });
  symlinkSync(app({ files: { 'home/.keep': '' } }).dir, join(repo.dir, '.cache'), 'junction');
  const home = join(repo.dir, '.cache', 'home');
  const r = await plan(world(), repo, { to: 22, manager: { '--version': '4.18.1' }, env: { HOME: home, USERPROFILE: home } });
  assert.deepEqual([r.asked, ran(repo.dir)], [[], []]);
  assert.match(r.plan.unchecked.find((u) => u.name === 'release age')?.reason, /since the home folder, .*, is inside the app's folder, /);
  // A repo copied without .git: the folder whose .yarnrc.yml the plan reads as the app's is the repo's.
  const mono = app({ files: { '.yarnrc.yml': 'npmMinimalAgeGate: 60\n', 'tools/yarn.cjs': MARKER, 'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' } }), 'apps/web/yarn.lock': '' } });
  const age = await ageOf({ dir: join(mono.dir, 'apps', 'web') }, { env: { npm_execpath: join(mono.dir, 'tools', 'yarn.cjs') } });
  assert.deepEqual(ran(mono.dir), []);
  assert.match(age, /since the one the plan found, .*yarn\.cjs, is inside the app's repository and is the repo's code, /);
});

test('a manager named through an 8.3 short name into the repo isn\'t run either', { skip: process.platform !== 'win32' && 'only Windows has 8.3 names' }, async (t) => {
  // fs.realpathSync keeps a short name such as NG-HOP~1, so comparing paths missed that it was the project's.
  const proj = pnpm21({}, { files: { 'tools/pnpm.cjs': MARKER } });
  const short = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${proj.dir}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true }).stdout.trim();
  if (!short || short.toLowerCase() === proj.dir.toLowerCase()) return t.skip('this volume keeps no 8.3 names');
  const age = await ageOf(proj, { env: { npm_execpath: join(short, 'tools', 'pnpm.cjs') } });
  assert.deepEqual(ran(proj.dir), []);
  assert.match(age, /, is inside the app's folder and is the repo's code, /);
});

test('with the home folder inside the project or its repo, the plan asks nothing, and says why release age went unchecked', async () => {
  // The plan asks from a folder it makes in the home folder, and from a folder in the repo pnpm or yarn would read the
  // repo's settings and run what they name.
  const proj = pnpm21({}, { files: { 'home/.keep': '' } });
  const home = join(proj.dir, 'home');
  const r = await plan(world(), proj, { to: 22, manager: pnpm12, env: { HOME: home, USERPROFILE: home } });
  assert.deepEqual(r.asked, []);
  assert.equal(r.plan.unchecked.find((u) => u.name === 'release age')?.reason, `pnpm wasn't asked for its version, which its minimum release age depends on, since the home folder, ${home}, is inside the app's folder, where pnpm would read the project's settings and could run its code, so a release younger than that age can still stop a command; plan again with HOME, or USERPROFILE on Windows, outside the repo, or with pnpm's version in package.json's packageManager`);
  const repo = webApp({ '.git/HEAD': 'ref: refs/heads/main\n', 'home/.keep': '' });
  const inRepo = await plan(world(), repo, { to: 22, manager: pnpm12, env: { HOME: join(repo.root, 'home'), USERPROFILE: join(repo.root, 'home') } });
  assert.deepEqual(inRepo.asked, []);
  assert.match(inRepo.plan.unchecked.find((u) => u.name === 'release age')?.reason, /is inside the app's git repository, /);
  assert.deepEqual((await plan(world(), pnpm21({}), { to: 22, manager: pnpm12 })).asked.length, 1, 'the control: with the usual one, it asks');
});

test('with a home folder the plan can\'t make its empty folder in, it asks nothing, and says which folder and what to do', async () => {
  // The folder couldn't be made, so no pnpm ran, and the reason said to plan again once pnpm is installed.
  const missing = join(app({}).dir, 'missing');
  const r = await plan(world(), pnpm21({}), { to: 22, manager: pnpm12, env: { HOME: missing, USERPROFILE: missing } });
  assert.deepEqual(r.asked, []);
  assert.equal(r.plan.unchecked.find((u) => u.name === 'release age')?.reason, `pnpm wasn't asked for its version, which its minimum release age depends on, since the plan couldn't make its empty folder in the home folder, ${missing} (ENOENT), so a release younger than that age can still stop a command; plan again with HOME, or USERPROFILE on Windows, set to a folder it can write, or with pnpm's version in package.json's packageManager`);
});

test('planning a pinned pnpm 12 project changes no file in it', async () => {
  const proj = pnpm21({ 'ui-lib': '^21.0.0' }, { pin: 'pnpm@12.16.1', files: { 'pnpm-workspace.yaml': 'minimumReleaseAge: 60\n' } });
  const before = listing(proj.dir);
  const r = await plan(world(youngLib()), proj, { to: 22, manager: pnpm12 });
  assert.deepEqual([r.plan.releaseAge.minutes, r.asked], [60, []]);
  assert.deepEqual(listing(proj.dir), before);
});

test('the version comes from the nearest package.json pin, its packageManager or devEngines, and then nothing is asked', async () => {
  // Corepack reads packageManager, a +sha suffix included, or devEngines.packageManager with an exact version. pnpm holds
  // nothing back by default before pnpm 11.
  const pinned = (pkg) => app({ files: {
    'package.json': JSON.stringify({ name: 'mono', ...pkg }),
    'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' } }),
    'apps/web/pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: '21.2.0', cli: '21.2.0' })),
  } });
  const cases = [
    [{ packageManager: 'pnpm@11.2.0+sha512.0123abc' }, '11.2.0'],
    [{ devEngines: { packageManager: { name: 'pnpm', version: '11.2.0' } } }, '11.2.0'],
  ];
  for (const [pkg, version] of cases) {
    const p = pinned(pkg);
    const r = await plan(world(), { dir: join(p.dir, 'apps', 'web') }, { to: 22, manager: pnpm12 });
    assert.deepEqual([r.plan.releaseAge?.version, r.asked], [version, []], JSON.stringify(pkg));
  }
  const old = await plan(world(), pnpm21({}, { pin: 'pnpm@10.33.0' }), { to: 22, manager: pnpm12 });
  assert.deepEqual([old.plan.releaseAge, old.asked], [null, []]);
  const other = await plan(world(), { dir: join(pinned({ devEngines: { packageManager: { name: 'yarn', version: '4.18.1' } } }).dir, 'apps', 'web') }, { to: 22, manager: pnpm12 });
  assert.deepEqual(other.asked.map((a) => a.args), ['--version'], 'the control: a pin for another manager pins nothing');
  const latest = pnpm21({}, { pin: 'pnpm@latest' });
  assert.equal(await ageOf(latest, { manager: pnpm12 }), `${join(latest.dir, 'package.json')} pins "pnpm@latest" in packageManager, which names no pnpm version, so the plan can't tell pnpm's minimum release age, and a release younger than that can still stop a command; ask the person to check it with pnpm config get minimum-release-age`);
  const tagged = pinned({ devEngines: { packageManager: { name: 'pnpm', version: 'latest' } } });
  assert.match(await ageOf({ dir: join(tagged.dir, 'apps', 'web') }, { manager: pnpm12 }), /package\.json pins "latest" in devEngines\.packageManager, which names no pnpm version, /);
});

test('a devEngines range or list only says which version may run, so the person\'s own is asked, and a packageManager above pins first', async () => {
  // yarn 4.18.1, run without Corepack under devEngines ^4.0.0, printed its default of a day, where the plan read the
  // range's lowest version, 4.0.0, which holds nothing back. Corepack 0.35.0 wants an exact version, ignores a list, and
  // walks past a package.json with no packageManager to a parent's: under one pinning pnpm 12.16.1, an app whose
  // devEngines named 10.34.9 ran 12.16.1.
  const web = { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' };
  const yarn = app({ files: { 'package.json': JSON.stringify({ name: 'app', devEngines: { packageManager: { name: 'yarn', version: '^4.0.0' } }, dependencies: web }), 'yarn.lock': '' } });
  const ranged = await plan(world(), yarn, { to: 22, manager: { '--version': '4.18.1' } });
  assert.deepEqual([ranged.plan.releaseAge?.version, ranged.plan.releaseAge?.minutes, ranged.asked.map((a) => a.args)], ['4.18.1', 1440, ['--version']]);
  const mono = (root, own = {}) => {
    const p = app({ files: { 'package.json': JSON.stringify({ name: 'mono', ...root }), 'apps/web/package.json': JSON.stringify({ name: 'web', ...own, dependencies: web }), 'apps/web/pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: '21.2.0', cli: '21.2.0' })) } });
    return { dir: join(p.dir, 'apps', 'web') };
  };
  for (const packageManager of [{ name: 'pnpm', version: '^11.2.0' }, [{ name: 'yarn', version: '4.18.1' }, { name: 'pnpm', version: '11.2.0' }]]) {
    const age = await ageOf(mono({ devEngines: { packageManager } }), { manager: pnpm12 });
    assert.match(age, /package\.json asks for pnpm "\^?11\.2\.0" in devEngines\.packageManager, and the pnpm the plan found is 12\.16\.1, so the plan can't tell pnpm's minimum release age, /, JSON.stringify(packageManager));
  }
  const above = await plan(world(), mono({ packageManager: 'pnpm@12.16.1' }, { devEngines: { packageManager: { name: 'pnpm', version: '10.34.9' } } }), { to: 22, manager: pnpm12 });
  assert.deepEqual([above.plan.releaseAge?.version, above.asked], ['12.16.1', []]);
  // With no packageManager anywhere, Corepack's loadSpec ends on the topmost package.json and reads devEngines from that
  // one alone, so an app's own below a root that names no manager pins nothing.
  const below = await plan(world(), mono({}, { devEngines: { packageManager: { name: 'pnpm', version: '10.34.9' } } }), { to: 22, manager: pnpm12 });
  assert.deepEqual([below.plan.releaseAge?.version, below.asked.map((a) => a.args)], ['12.16.1', ['--version']]);
});

test('a devEngines pin for pnpm or yarn doesn\'t stop npm from reading the registry settings, wherever it sits', async () => {
  // npm 11.19.0 checks devEngines on every command, config and view too, and failed with EBADDEVENGINES on any manager
  // but npm, as pnpm 12.16.1's own pnpm init writes it into package.json. --force makes that a warning.
  const web = { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' };
  const engine = (name, version) => ({ devEngines: { packageManager: { name, version, onFail: 'download' } } });
  const own = app({ files: { 'package.json': JSON.stringify({ name: 'app', packageManager: 'pnpm@12.16.1', ...engine('pnpm', '12.16.1'), dependencies: web }), 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: '21.2.0', cli: '21.2.0' })) } });
  const root = app({ files: { 'package.json': JSON.stringify({ name: 'mono', private: true, ...engine('pnpm', '12.16.1') }), 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n', 'pnpm-lock.yaml': pnpmLock(pnpmImporter('apps/web', { core: '21.2.0', cli: '21.2.0' })), 'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: web }) } });
  const yarn = app({ files: { 'package.json': JSON.stringify({ name: 'app', ...engine('yarn', '4.18.1'), dependencies: web }), 'yarn.lock': '' } });
  for (const [proj, version] of [[own, '12.16.1'], [{ dir: join(root.dir, 'apps', 'web') }, '12.16.1'], [yarn, '4.18.1']]) {
    const r = await plan(world(), proj, { to: 22 });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([r.plan.releaseAge?.version, r.asked], [version, []], proj.dir);
  }
});
