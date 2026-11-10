import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { fakeManager, pkg, plan, PLAN, runScript, startRegistry, UPDATE } from './helpers/harness.mjs';
import { app, base, libIn, lockBase, pnpmImporter, pnpmLock, quotePath, world } from './helpers/plan-fixtures.mjs';

// ---- Project state and refusing to guess ------------------------------------------------------------------------------

test('the lockfile wins over the declared range, so a resumed upgrade starts where it stopped', async () => {
  const r = await plan(world(), app({ deps: { ...base, '@angular/core': '^20.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0' } }));
  assert.equal(r.plan.project.angular, '21.2.0');
  assert.deepEqual(r.plan.hops.map((h) => h.major), [22]);
});

test('on the target major but behind on patches, the plan offers them', async () => {
  const cli = pkg('@angular/cli', { '20.0.0': {}, '20.2.0': {} });
  const r = await plan(world(cli), app({ deps: base, lock: { ...lockBase, '@angular/core': '20.0.0', '@angular/cli': '20.0.0' } }), { to: 20 });
  assert.equal(r.code, 0);
  assert.equal(r.plan.status, 'already-there');
  assert.equal(r.plan.patches.command, 'npx --no-install ng update @angular/core@20.2.0 @angular/cli@20.2.0');
});

test('a deprecated patch is never offered, the same as anywhere else in the plan', async () => {
  const cli = pkg('@angular/cli', { '20.0.0': {}, '20.1.0': {}, '20.2.0': { deprecated: 'broken release' } }, { latest: '20.1.0' });
  const r = await plan(world(cli), app({ deps: base, lock: { ...lockBase, '@angular/core': '20.2.0', '@angular/cli': '20.0.0' } }), { to: 20 });
  assert.deepEqual(r.plan.patches.packages.map((p) => [p.name, p.to]), [['@angular/cli', '20.1.0']]);
});

test('a patch above the latest tag is never offered', async () => {
  const cli = pkg('@angular/cli', { '20.0.0': {}, '20.1.0': {}, '20.9.0': {} }, { latest: '20.1.0' });
  const r = await plan(world(cli), app({ deps: base, lock: { ...lockBase, '@angular/core': '20.2.0', '@angular/cli': '20.0.0' } }), { to: 20 });
  assert.equal(r.plan.patches.packages[0].to, '20.1.0');
});

test('no printed command can download an unrelated package named ng', async () => {
  // npm has a package called `ng` that has nothing to do with Angular, and plain `npx ng` runs it when no CLI is installed.
  const lib = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' } });
  const hop = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' } }), { to: 21 });
  assert.match(hop.plan.hops[0].command, /^npx --no-install ng update /);
  const cli = pkg('@angular/cli', { '20.0.0': {}, '20.2.0': {} });
  const patch = await plan(world(cli), app({ deps: base, lock: { ...lockBase, '@angular/core': '20.0.0', '@angular/cli': '20.0.0' } }), { to: 20 });
  assert.match(patch.plan.patches.command, /^npx --no-install ng update /);
});

test('fully up to date offers nothing', async () => {
  const cli = pkg('@angular/cli', { '20.2.0': {} });
  const r = await plan(world(cli), app({ deps: base, lock: { ...lockBase, '@angular/cli': '20.2.0' } }), { to: 20 });
  assert.equal(r.plan.patches, undefined);
});

test('node_modules is used when there is no lockfile, then the declared range', async () => {
  const fromModules = await plan(world(), app({ deps: base, files: { 'node_modules/@angular/core/package.json': '{"version":"20.2.0"}' } }), { to: 21 });
  assert.equal(fromModules.plan.project.angularSource, 'node_modules');
  const fromRange = await plan(world(), app({ deps: base }), { to: 21 });
  assert.equal(fromRange.plan.project.angularSource, 'package.json range');
});

test('already on the target is a clean no-op', async () => {
  const r = await plan(world(), app({ deps: base, lock: lockBase }), { to: 20 });
  assert.equal(r.code, 0);
  assert.equal(r.plan.status, 'already-there');
  assert.deepEqual(r.plan.hops, []);
});

test('the default target is the latest stable Angular', async () => {
  const r = await plan(world(), app({ deps: base, lock: lockBase }));
  assert.equal(r.plan.target, 22);
});

test('a target past the latest release is refused', async () => {
  const r = await plan(world(), app({ deps: base, lock: lockBase }), { to: 23 });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Angular 23 isn't released/);
});

test('a target below the current version is refused', async () => {
  const r = await plan(world(), app({ deps: { ...base, '@angular/core': '^21.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0' } }), { to: 20 });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /only moves forward/);
});

test('a project with no Angular is refused', async () => {
  const r = await plan(world(), app({ deps: { react: '^19.0.0' } }));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /isn't an Angular project/);
});

test('a folder with no package.json is refused', async () => {
  const p = app({ deps: base });
  const r = await runScript(PLAN, ['--project', `${p.dir}/nope`], { cwd: p.dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No package.json/);
});

test('an unusable --to is refused', async () => {
  const p = app({ deps: base });
  const r = await runScript(PLAN, ['--project', p.dir, '--to', 'latest'], { cwd: p.dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Angular major version/);
});

test('a registry that fails makes no plan, because a guess here would look like a clean bill of health', async () => {
  const r = await plan(world(), app({ deps: base, lock: lockBase }), { registryOptions: { failWith: 500 } });
  assert.equal(r.code, 1);
  assert.equal(r.plan, null);
  assert.match(r.stderr, /none was made/);
});

test('an unreachable registry makes no plan', async () => {
  const p = app({ deps: base, lock: lockBase });
  const r = await runScript(PLAN, ['--project', p.dir], { cwd: p.dir, env: { npm_config_registry: 'http://127.0.0.1:9/' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Could not reach/);
});

test('a private registry falls back to npm so its stored credentials apply', async () => {
  const hits = [];
  const packages = world();
  const registry = await startRegistry(packages, { requireAuth: true, hits });
  const host = registry.url.replace(/^http:/, '');
  const p = app({ deps: base, lock: lockBase, files: { '.npmrc': `registry=${registry.url}\n${host}:_authToken=test-only\n` } });
  try {
    const r = await runScript(PLAN, ['--project', p.dir, '--to', '21', '--json'], { cwd: p.dir });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).hops.map((h) => h.major), [21]);
  } finally {
    await registry.close();
  }
});

test('an Nx workspace is flagged', async () => {
  const r = await plan(world(), app({ deps: base, lock: lockBase, nx: true }), { to: 21 });
  assert.match(r.plan.notes[0], /nx migrate/);
});

test('a broken package.json is refused with its path', async () => {
  const p = app({ deps: base, files: { 'package.json': '{ not json' } });
  const r = await runScript(PLAN, ['--project', p.dir], { cwd: p.dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Could not read/);
});

test('the plan never changes the project', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const p = app({ deps: base, lock: lockBase });
  const before = [readdirSync(p.dir).sort().join(), readFileSync(`${p.dir}/package.json`, 'utf8'), readFileSync(`${p.dir}/package-lock.json`, 'utf8')];
  await plan(world(), p);
  assert.deepEqual([readdirSync(p.dir).sort().join(), readFileSync(`${p.dir}/package.json`, 'utf8'), readFileSync(`${p.dir}/package-lock.json`, 'utf8')], before);
});

// ---- pnpm -------------------------------------------------------------------------------------------------------

const uiLib = () => pkg('ui-lib', { '20.1.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' } });

test('pnpm: the lockfile gives the installed versions when nothing is installed yet', async () => {
  const r = await plan(world(uiLib()), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.')) } }), { to: 21 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.plan.project.angular, '20.2.0');
  assert.equal(r.plan.project.angularSource, 'lockfile');
  assert.equal(libIn(r, 21, 'ui-lib').from, '20.1.0');
});

test('pnpm: the lockfile beats a stale node_modules, so a resume after a stash reads the right major', async () => {
  const r = await plan(world(), app({ deps: base, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.')), 'node_modules/@angular/core/package.json': '{"version":"21.0.0"}' } }), { to: 21 });
  assert.equal(r.plan.project.angular, '20.2.0');
});

test('pnpm: a lockfile it cannot read falls back to node_modules, with no guess', async () => {
  const r = await plan(world(), app({ deps: base, files: { 'pnpm-lock.yaml': 'lockfileVersion: 5.4\nspecifiers:\n  x: 1\n', 'node_modules/@angular/core/package.json': '{"version":"20.1.0"}' } }), { to: 21 });
  assert.equal(r.plan.project.angular, '20.1.0');
  assert.equal(r.plan.project.angularSource, 'node_modules');
});

test('pnpm: an app inside a workspace gets pnpm commands and its own entry in the root lockfile', async () => {
  const p = app({
    deps: {},
    files: {
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
      'pnpm-lock.yaml': pnpmLock('  .: {}\n', pnpmImporter('apps/other', { core: '19.0.0', cli: '19.0.0' }), pnpmImporter('apps/web')),
      'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { '@angular/core': '^20.0.0', rxjs: '~7.8.0' }, devDependencies: { '@angular/cli': '^20.0.0', typescript: '~5.8.0' } }),
    },
  });
  const r = await plan(world(), { dir: join(p.dir, 'apps', 'web') }, { to: 21 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.plan.project.packageManager, 'pnpm');
  assert.equal(r.plan.project.angular, '20.2.0');
  assert.equal(r.plan.project.angularSource, 'lockfile');
  assert.ok(r.plan.hops[0].command.startsWith(`pnpm exec node ${quotePath(UPDATE)}`));
});

// An app in a pnpm workspace that uses its team's @acme/ui-core, which stops at Angular 20.
const uiCore = () => pkg('@acme/ui-core', { '20.4.0': { peer: '^20.0.0', at: '2025-09-01' } });
const acmeWorkspace = ({ workspaces, files = {} } = {}) => {
  const p = app({ files: {
    'package.json': JSON.stringify({ name: 'mono', private: true, ...(workspaces ? { workspaces } : {}) }),
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
    'pnpm-lock.yaml': pnpmLock('  .: {}\n', pnpmImporter('apps/web')),
    'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { ...base, '@acme/ui-core': '^20.4.0' } }),
    ...files,
  } });
  return { root: p.dir, dir: join(p.dir, 'apps', 'web') };
};
const blockedOnUiCore = (r) => {
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.ownBlockers, ['@acme/ui-core']);
};

test('pnpm: the workspace root\'s .npmrc gives the team\'s registry and its token, as pnpm reads them there', async () => {
  // npm reads only the .npmrc beside the app, so the plan asked the default registry for @acme/ui-core, found nothing,
  // and called the app reachable.
  const w = acmeWorkspace();
  blockedOnUiCore(await plan(world(), w, { to: 21, own: { scope: '@acme', packages: [uiCore()], rcDir: w.root, auth: true } }));
});

test('pnpm: a root that also declares npm workspaces doesn\'t stop the plan', async () => {
  // npm refuses `config` below a root that declares workspaces, with ENOWORKSPACES.
  const w = acmeWorkspace({ workspaces: ['apps/*'] });
  blockedOnUiCore(await plan(world(), w, { to: 21, own: { scope: '@acme', packages: [uiCore()], rcDir: w.root } }));
});

test('pnpm: the app\'s own .npmrc counts too, token included, as pnpm 10 and older lay it over the root\'s', async () => {
  const w = acmeWorkspace({ workspaces: ['apps/*'] });
  blockedOnUiCore(await plan(world(), w, { to: 21, own: { scope: '@acme', packages: [uiCore()], auth: true } }));
  // npm 11.19.0's ini and pnpm 10.34.9 read a line ended by \r\n or a lone \r, and a key with spaces around its =, as
  // Windows editors and people write them. A key the plan missed left @acme/ui-core to the default registry, which has
  // none, and the app read as reachable.
  const company = await startRegistry([uiCore()], { requireAuth: true });
  try {
    const host = company.url.replace(/^http:/, '');
    for (const rc of [`@acme:registry=${company.url}\r\n${host}:_authToken=test-only\r\n`, `@acme:registry = ${company.url}\n${host}:_authToken = test-only\n`, `@acme:registry=${company.url}\r${host}:_authToken=test-only\r`]) {
      blockedOnUiCore(await plan(world(), acmeWorkspace({ files: { 'apps/web/.npmrc': rc } }), { to: 21 }));
    }
  } finally {
    await company.close();
  }
});

test('pnpm: from pnpm 11 the app\'s own .npmrc counts for nothing, since pnpm reads only the workspace root\'s', async () => {
  // In apps/web, pnpm 11.0.0, 11.28.11 and 12.16.1 read the registry the root's .npmrc named and passed over the app's
  // own, which pnpm 10.34.9 read over the root's. So the plan asks the registry pnpm asks for the team's scope.
  for (const version of ['11.0.0', '12.16.1']) {
    const hits = [];
    const r = await plan(world(), acmeWorkspace(), { to: 21, own: { scope: '@acme', packages: [uiCore()] }, manager: { '--version': version }, registryOptions: { hits } });
    assert.equal(r.code, 0, `${version}: ${r.stderr}`);
    assert.ok(hits.includes('@acme/ui-core'), `${version} asks the root's registry: ${hits.join(', ')}`);
  }
  blockedOnUiCore(await plan(world(), acmeWorkspace(), { to: 21, own: { scope: '@acme', packages: [uiCore()] }, manager: { '--version': '10.34.9' } }));
});

test('pnpm: only the keys the app\'s own .npmrc sets go over the root\'s, so a mirror set at the root stays', async () => {
  // npm's listing for the app's folder holds every default, the registry included, so laying all of it over the root's
  // would undo the root's mirror. The user config makes that default a registry nothing answers on.
  const [mirror, company] = await Promise.all([startRegistry(world()), startRegistry([uiCore()])]);
  const w = acmeWorkspace({ files: {
    '.npmrc': `registry=${mirror.url}\n@acme:registry=${company.url}\n`,
    'apps/web/.npmrc': 'save-exact=true\n',
    'user.npmrc': 'registry=http://127.0.0.1:9/\n',
  } });
  // The plan asks pnpm for its minimum release age, and this one has none, so no real pnpm runs. It asks from a folder
  // in the home folder, so the plan gets one of its own.
  const pnpm = fakeManager('pnpm', { '--version': '10.33.0' });
  const home = app({}).dir;
  try {
    const r = await runScript(PLAN, ['--project', w.dir, '--to', '21', '--json'], { cwd: w.dir, env: { npm_config_userconfig: join(w.root, 'user.npmrc'), npm_execpath: pnpm.file, HOME: home, USERPROFILE: home } });
    blockedOnUiCore({ ...r, plan: r.stdout ? JSON.parse(r.stdout) : null });
  } finally {
    await Promise.all([mirror.close(), company.close()]);
    pnpm.remove();
  }
});

test('pnpm: a registry line with no value stops the plan with a reason naming where it is, instead of a crash', async () => {
  // npm 11.19.0 listed registry as true for `registry` alone on a line, which pnpm 10.34.9 refused in an app's own
  // .npmrc: `registry` should be a string. The plan stopped with TypeError: url.endsWith is not a function.
  const mirror = await startRegistry(world());
  const home = app({}).dir;
  // A refusing proxy keeps a plan that falls back to the public registry offline.
  const offline = { HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1', NODE_USE_ENV_PROXY: '1' };
  const run = async (files, version) => {
    const w = acmeWorkspace({ files: { 'user.npmrc': '', ...files } });
    const pnpm = fakeManager('pnpm', { '--version': version });
    try {
      return { w, ...await runScript(PLAN, ['--project', w.dir, '--to', '21'], { cwd: w.dir, env: { npm_config_userconfig: join(w.root, 'user.npmrc'), npm_execpath: pnpm.file, HOME: home, USERPROFILE: home, ...offline } }) };
    } finally {
      pnpm.remove();
    }
  };
  try {
    const own = await run({ '.npmrc': `registry=${mirror.url}\n`, 'apps/web/.npmrc': 'registry\r\nsave-exact=true\r\n' }, '10.34.9');
    assert.deepEqual([own.code, own.stderr.trim()], [1, `${join(own.w.dir, '.npmrc')} sets registry without an address, which npm reads as true and pnpm 10 refuses, so the plan can't tell which registry to ask; ask the person to fix that line.`]);
    const root = await run({ '.npmrc': '@acme:registry\nsave-exact=true\n' }, '10.34.9');
    assert.deepEqual([root.code, root.stderr.trim()], [1, `An .npmrc npm reads in ${root.w.root} sets @acme:registry without an address, which npm reads as true, so the plan can't tell which registry to ask; ask the person to fix that line.`]);
    // With = and nothing after it, npm 11.19.0 read "", which pnpm 10.34.9, 11.0.0 and 11.28.11 refused with
    // ERR_INVALID_URL at the root, and 10.34.9 in the app's own .npmrc too. The plan asked the public registry, or the
    // default one for the scope, and called the app reachable.
    for (const key of ['registry', '@acme:registry']) {
      const empty = await run({ '.npmrc': `${key}=\n${key === 'registry' ? '' : `registry=${mirror.url}\n`}` }, '10.34.9');
      assert.deepEqual([empty.code, empty.stderr.trim()], [1, `An .npmrc npm reads in ${empty.w.root} sets ${key} without an address, which npm reads as "", so the plan can't tell which registry to ask; ask the person to fix that line.`]);
      const appEmpty = await run({ '.npmrc': `registry=${mirror.url}\n`, 'apps/web/.npmrc': `${key}=\n` }, '10.34.9');
      assert.deepEqual([appEmpty.code, appEmpty.stderr.trim()], [1, `${join(appEmpty.w.dir, '.npmrc')} sets ${key} without an address, which npm reads as "" and pnpm 10 refuses, so the plan can't tell which registry to ask; ask the person to fix that line.`]);
    }
    // npm 11.19.0 listed `@acme:registry=false` as false and `=null` as null, no address either.
    for (const value of ['false', 'null']) {
      const listed = await run({ '.npmrc': `@acme:registry=${value}\nregistry=${mirror.url}\n` }, '12.16.1');
      assert.deepEqual([listed.code, listed.stderr.trim()], [1, `An .npmrc npm reads in ${listed.w.root} sets @acme:registry without an address, which npm reads as ${value}, so the plan can't tell which registry to ask; ask the person to fix that line.`]);
    }
    // The control: pnpm 12.16.1 reads only the root's .npmrc, so the app's line counts for nothing.
    const later = await run({ '.npmrc': `registry=${mirror.url}\n`, 'apps/web/.npmrc': 'registry\r\nsave-exact=true\r\n' }, '12.16.1');
    assert.equal(later.code, 0, later.stderr);
  } finally {
    await mirror.close();
  }
});

test('pnpm: a lockfile in a parent folder with no workspace file has nothing to do with the app', async () => {
  const p = app({ deps: {}, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('apps/web')), 'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { '@angular/core': '^20.0.0' } }) } });
  const r = await plan(world(), { dir: join(p.dir, 'apps', 'web') }, { to: 21 });
  assert.equal(r.plan.project.packageManager, 'npm');
  assert.equal(r.plan.project.angularSource, 'package.json range');
});

test('pnpm: an npm lockfile beside the app beats a pnpm workspace above it', async () => {
  const p = app({ deps: {}, files: { 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n", 'pnpm-lock.yaml': pnpmLock(pnpmImporter('apps/web')), 'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { '@angular/core': '^20.0.0' } }), 'apps/web/package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@angular/core': { version: '20.0.0' } } }) } });
  const r = await plan(world(), { dir: join(p.dir, 'apps', 'web') }, { to: 21 });
  assert.equal(r.plan.project.packageManager, 'npm');
  assert.equal(r.plan.project.angular, '20.0.0');
});

// Through Angular 21's CLI, `ng update` prints "Package @angular/core was not found on the registry. Skipping." for
// these and exits 0, so the pnpm runner moves the catalog itself, and the plan says that's what will happen.
for (const [name, spec] of [['@angular/core', 'catalog:'], ['@angular/router', 'catalog:angular'], ['typescript', 'catalog:']]) {
  test(`pnpm: ${name} from a catalog (${spec}) gets a plan through the pnpm runner, which moves the catalog`, async () => {
    const r = await plan(world(), app({ deps: { ...base, [name]: spec }, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.')), 'pnpm-workspace.yaml': "catalog:\n  x: '1'\n" } }), { to: 21, text: true });
    assert.equal(r.code, 0, r.stderr);
    const note = r.stdout.split('\n').find((l) => l.startsWith('Note:') && l.includes('catalog'));
    assert.ok(note && note.includes(name), r.stdout);
    assert.match(r.stdout, /Run: pnpm exec node .*update\.mjs.* @angular\/core@21/);
  });
}

const catalogImporter = (name) => `  ${name}:
    dependencies:
      '@angular/core':
        specifier: 'catalog:'
        version: 20.2.0(rxjs@7.8.2)
    devDependencies:
      '@angular/cli':
        specifier: 'catalog:'
        version: 20.2.0
`;

test('pnpm: a catalog other projects in the workspace use is named, because moving it moves them too', async () => {
  const p = app({ deps: { ...base, '@angular/core': 'catalog:', '@angular/cli': 'catalog:' }, files: {
    'pnpm-workspace.yaml': "packages:\n  - '.'\n  - 'apps/*'\ncatalog:\n  '@angular/core': ^20.0.0\n",
    'pnpm-lock.yaml': pnpmLock(catalogImporter('.'), catalogImporter('apps/admin'), pnpmImporter('apps/plain')),
  } });
  const r = await plan(world(), p, { to: 21 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.plan.project.angular, '20.2.0', 'the version still comes from the lockfile');
  assert.deepEqual(r.plan.catalog, { packages: ['@angular/core', '@angular/cli'], sharedWith: ['apps/admin'] });
  assert.ok(r.plan.notes.some((n) => n.includes('apps/admin') && /ask/i.test(n)), r.plan.notes.join('\n'));

  const alone = await plan(world(), app({ deps: { ...base, '@angular/core': 'catalog:', '@angular/cli': 'catalog:' }, files: { 'pnpm-workspace.yaml': "catalog:\n  '@angular/core': ^20.0.0\n", 'pnpm-lock.yaml': pnpmLock(catalogImporter('.')) } }), { to: 21 });
  assert.deepEqual(alone.plan.catalog.sharedWith, []);
  assert.ok(!alone.plan.notes.some((n) => /ask/i.test(n)));
});

test('pnpm: a catalog that holds nothing the upgrade moves does not stop the plan', async () => {
  const r = await plan(world(pkg('date-fns', { '4.0.0': {} })), app({ deps: { ...base, 'date-fns': 'catalog:' }, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.')) } }), { to: 21 });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.plan.unchecked.some((u) => u.name === 'date-fns'));
});

test('pnpm: a patch that moves the CLI goes through the runner, because the old CLI would dirty the lockfile', async () => {
  const cli = pkg('@angular/cli', { '20.0.0': {}, '20.2.0': {} });
  const r = await plan(world(cli), app({ deps: base, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: '20.0.0', cli: '20.0.0' })) } }), { to: 20 });
  assert.equal(r.plan.patches.command, `pnpm exec node ${quotePath(UPDATE)} @angular/core@20.2.0 @angular/cli@20.2.0`);
});

test('pnpm: a patch that leaves the CLI alone runs the installed one, since nothing has to bootstrap', async () => {
  const cli = pkg('@angular/cli', { '20.0.0': {}, '20.2.0': {} });
  const r = await plan(world(cli), app({ deps: base, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: '20.0.0', cli: '20.2.0' })) } }), { to: 20 });
  assert.equal(r.plan.patches.command, 'pnpm exec ng update @angular/core@20.2.0');
});

// ---- yarn and bun lockfiles ------------------------------------------------------------------------------------

const yarnClassic = `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


"@angular/cli@^20.0.0":
  version "20.2.0"
  resolved "https://registry.yarnpkg.com/@angular/cli/-/cli-20.2.0.tgz#abc"

"@angular/core@^19.0.0":
  version "19.2.0"

"@angular/core@^20.0.0", "@angular/core@~20.0.0":
  version "20.2.0"

rxjs@~7.8.0:
  version "7.8.2"

typescript@~5.8.0:
  version "5.8.3"
`;
const yarnBerry = `# This file is generated by running "yarn install" inside your project.

__metadata:
  version: 8
  cacheKey: 10c0

"@angular/cli@npm:^20.0.0":
  version: 20.2.0
  resolution: "@angular/cli@npm:20.2.0"

"@angular/core@npm:^19.0.0":
  version: 19.2.0

"@angular/core@npm:^20.0.0":
  version: 20.2.0
  resolution: "@angular/core@npm:20.2.0"

"typescript@npm:~5.8.0":
  version: 5.8.3

"typescript@patch:typescript@npm%3A~5.8.0#optional!builtin<compat/typescript>":
  version: 5.8.3
`;
const bunLock = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "app",
      "dependencies": { "@angular/core": "^20.0.0", "@angular/cli": "^20.0.0" },
    },
  },
  "packages": {
    "@angular/cli": ["@angular/cli@20.2.0", "", {}, "sha512-x"],
    "@angular/core": ["@angular/core@20.2.0", "", { "peerDependencies": { "rxjs": "^6.5.3 || ^7.4.0" } }, "sha512-y"],
    "some-lib/@angular/core": ["@angular/core@19.2.0", "", {}, "sha512-z"],
    "typescript": ["typescript@5.8.3", "", {}, "sha512-t"],
  }
}
`;

for (const [name, lockfile, text] of [['yarn 1', 'yarn.lock', yarnClassic], ['yarn 2 and newer', 'yarn.lock', yarnBerry], ['bun', 'bun.lock', bunLock]]) {
  test(`${name}: installed versions come from the lockfile, matched by the app's own range`, async () => {
    // Without the lockfile, the plan falls back to the bottom of each range, which says 20.0.0 here.
    const r = await plan(world(), app({ deps: base, files: { [lockfile]: text } }), { to: 21 });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.plan.project.angular, '20.2.0');
    assert.equal(r.plan.project.angularSource, 'lockfile');
  });
}

test('a lockfile that cannot be read falls back instead of making up a version', async () => {
  for (const [lockfile, text] of [['yarn.lock', 'not: [a lockfile'], ['bun.lock', '{ "packages": ']]) {
    const r = await plan(world(), app({ deps: base, files: { [lockfile]: text } }), { to: 21 });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.plan.project.angularSource, 'package.json range');
  }
});
