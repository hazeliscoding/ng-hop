import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { angular, pkg, plan, typescript, UPDATE } from './helpers/harness.mjs';
import { app, base, evaIcons, libIn, lockBase, nebular, nebularDeps, nebularLock, nebularWith, nextWorld, npmApp, pnpm12, pnpm21, pnpmImporter, pnpmLock, quotePath, world, yarn21, youngLib } from './helpers/plan-fixtures.mjs';

// ---- Release age: what the package manager and ng update hold back --------------------------------------------------

const ripeAt = (doc, v, minutes) => new Date(Date.parse(doc.time[v]) + minutes * 60e3).toISOString();
const youngPatch = (doc, v, from, ago = 30) => { doc.versions[v] = { ...doc.versions[from], version: v }; doc.time[v] = new Date(Date.now() - ago * 60e3).toISOString(); doc['dist-tags'].latest = v; };
// M7's libraries: 21.4.0 accepts Angular 21 only, and ui-core's 22.0.0 came out `ago` minutes ago, ui-forms' 0.6 s after.
const acme = (ago, extra = {}) => [
  pkg('@acme/ui-core', { '21.4.0': { peers: { '@angular/core': '^21.2.0', '@angular/common': '^21.2.0' }, at: '2026-01-10' }, '22.0.0': { peers: { '@angular/core': '^22.0.0', '@angular/common': '^22.0.0' }, ago, ...extra } }),
  pkg('@acme/ui-forms', { '21.4.0': { peers: { '@angular/core': '^21.2.0', '@acme/ui-core': '^21.4.0' }, at: '2026-01-10' }, '22.0.0': { peers: { '@angular/core': '^22.0.0', '@acme/ui-core': '^22.0.0' }, ago: ago - 0.01 } }),
];
const acmeDeps = { '@acme/ui-core': '^21.4.0', '@acme/ui-forms': '^21.4.0' };
// A private registry can leave a release out of its document's time: here 21.0.0 is dated and 22.0.0 isn't.
const undated = (more = {}) => pkg('ui-lib', { '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '22.0.0': { peer: '^22.0.0' }, ...more });
const yarnApp = (deps = { 'ui-lib': '^21.0.0' }, files = {}) => app({ deps: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0', ...deps }, files: { 'yarn.lock': '', ...files } });
const yarn18 = { '--version': '4.18.1' };
// Angular's newest patch, 22.3.0, with no publish time, and a CLI to match.
const undatedPatch = () => {
  const [core, compiler] = angular();
  core.versions['22.3.0'] = { ...core.versions['22.2.0'], version: '22.3.0' };
  core['dist-tags'].latest = '22.3.0';
  return [core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} }), pkg('@angular/cli', { '21.2.0': { at: '2025-11-28' }, '22.2.0': { at: '2026-05-28' }, '22.3.0': {} })];
};

// npm 11.10 added min-release-age. npm 10.9.10 lists it as a string, a key it doesn't know, and 11.19.0 as a number.
const npmCli = [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(existsSync);
const npmKnowsAge = Boolean(npmCli) && typeof JSON.parse(spawnSync(process.execPath, [npmCli, 'config', 'list', '--json', '--min-release-age=1'], { encoding: 'utf8' }).stdout || '{}')['min-release-age'] === 'number';

test('bun holds a release back by the minimumReleaseAge in the app\'s bunfig.toml, in seconds, and ng update asks it nothing', async () => {
  const proj = (files) => app({ deps: { ...base, '@angular/core': '^21.0.0', 'ui-lib': '^21.0.0' }, files: { 'bun.lock': '{}', ...files } });
  const r = await plan(world(youngLib()), proj({ 'bunfig.toml': '[install]\nminimumReleaseAge = 86400\n' }), { to: 22 });
  assert.deepEqual(r.plan.releaseAge, { manager: 'bun', setting: 'minimumReleaseAge', minutes: 1440, ngUpdateReads: false });
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.plan.waiting.sooner, r.plan.waiting.command, 'only the install holds it back, so an approved exemption is enough');
  assert.equal((await plan(world(youngLib()), proj({}), { to: 22 })).plan.releaseAge, null, 'the control: bun holds nothing back by default');
});

test('an age too long to give a date for is unknown, naming where it is set, and the plan neither crashes nor gives a time', async () => {
  // pnpm 12.16.1 printed 999999999999 for minimumReleaseAge, yarn 4.18.1 100000000000000000000 for npmMinimalAgeGate
  // 99999999999999999999, and npm 11.19.0 listed a min-release-age of 99999999999 days, and working out when a release
  // is that old stopped the plan: RangeError: Invalid time value. An age ending past the year 9999 has no time the plan
  // can print, so 5000000000 minutes, which end in the year 11533, are too long as well, and so are 100000000 days.
  const long = (shown) => `${shown}, too long for the plan to give the date a release would be old enough, so a release younger than that can still stop a command; ask the person whether that age is meant`;
  const pnpm = (minutes) => pnpm21({ 'ui-lib': '^21.0.0' }, { pin: 'pnpm@12.16.1', files: { 'pnpm-workspace.yaml': `minimumReleaseAge: ${minutes}\n` } });
  const [huge, past] = [pnpm(999999999999), pnpm(5000000000)];
  const yarn = yarn21({ pin: 'yarn@4.18.1', files: { '.yarnrc.yml': 'npmMinimalAgeGate: 99999999999999999999\n' } });
  const bun = (seconds) => app({ deps: { ...base, '@angular/core': '^21.0.0', 'ui-lib': '^21.0.0' }, files: { 'bun.lock': '{}', 'bunfig.toml': `[install]\nminimumReleaseAge = ${seconds}\n` } });
  const bunHuge = bun('99999999999999999999');
  const cases = [
    [huge, long(`${join(huge.dir, 'pnpm-workspace.yaml')} sets minimumReleaseAge to "999999999999"`)],
    [past, long(`${join(past.dir, 'pnpm-workspace.yaml')} sets minimumReleaseAge to "5000000000"`)],
    [yarn, long(`${join(yarn.dir, '.yarnrc.yml')} sets npmMinimalAgeGate to "99999999999999999999"`)],
    [bunHuge, long(`${join(bunHuge.dir, 'bunfig.toml')} sets minimumReleaseAge to "99999999999999999999"`)],
    ...npmKnowsAge ? ['99999999999', '100000000'].map((days) => [npmApp(`min-release-age=${days}\n`), long(`npm config sets min-release-age to "${days}"`)]) : [],
  ];
  for (const [proj, reason] of cases) {
    const r = await plan(world(youngLib()), proj, { to: 22, text: true });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes(`\n  release age: ${reason}.`), r.stdout);
    assert.doesNotMatch(r.stdout, /until|waiting/);
  }
  // The controls: an age that ends in the year 9822, and bun's 10000000000 seconds, which end in 2343, still have a
  // date, and the plan waits for it.
  const near = await plan(world(youngLib()), pnpm(4100000000), { to: 22 });
  const seconds = await plan(world(youngLib()), bun(10000000000), { to: 22 });
  assert.deepEqual([near.code, near.plan.waiting?.until.slice(0, 2), seconds.code, seconds.plan.waiting?.until.slice(0, 2)], [2, '98', 2, '23'], near.stderr + seconds.stderr);
});

test('a release the registry dates so late that the age ends past the year 9999 leaves the age unknown, naming it, and the plan neither crashes nor gives a time', async () => {
  // Under pnpm 12.16.1's default age of a day, a registry dating ui-lib 22.0.0 +275760-09-12, the last day a Date holds,
  // stopped the plan with RangeError: Invalid time value, and 9999-12-31 printed BLOCKED until +010000-01-01 12 UTC. A
  // time the registry gives as a list, which Date.parse reads as its text, is quoted as text too.
  const dated = (time) => { const lib = youngLib(); lib.time['22.0.0'] = time; return world(lib); };
  for (const time of ['+275760-09-12T12:00:00.000Z', '9999-12-31T12:00:00.000Z', ['9999-12-31T12:00:00.000Z']]) {
    const r = await plan(dated(time), pnpm21({ 'ui-lib': '^21.0.0' }, { pin: 'pnpm@12.16.1' }), { to: 22, text: true });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes(`\n  release age: the registry says ui-lib 22.0.0 came out at "${time}", and pnpm's minimum release age from then ends past the year 9999, too late for the plan to give a date, so a release younger than that age can still stop a command; ask the person to check that time with npm view ui-lib time.`), r.stdout);
    assert.doesNotMatch(r.stdout, /until|waiting/);
  }
  // The control: a release dated in the year 9000 is too young for a day after that, and the plan waits for it.
  const r = await plan(dated('9000-01-01T00:00:00.000Z'), pnpm21({ 'ui-lib': '^21.0.0' }, { pin: 'pnpm@12.16.1' }), { to: 22 });
  assert.deepEqual([r.code, r.plan.waiting?.until], [2, '9000-01-02T00:00:00.000Z'], r.stderr);
  // With the age unknown, nothing is held back, a release with no time under yarn 4.18.1 included, whose wait the plan
  // worked out from an age it no longer had: TypeError: Cannot read properties of null (reading 'before').
  const lib = youngLib();
  lib.time['22.0.0'] = '+275760-09-12T12:00:00.000Z';
  lib.versions['22.1.0'] = { ...lib.versions['22.0.0'], version: '22.1.0' };
  lib['dist-tags'].latest = '22.1.0';
  const yarn = await plan(world(lib), yarnApp(), { to: 22, manager: yarn18 });
  assert.equal(yarn.code, 0, yarn.stderr);
  assert.equal(libIn(yarn, 22, 'ui-lib').to, '22.1.0');
});

test('a library whose newest release is too young moves to the newest that is old enough, as ng update does, and names the young one', async () => {
  const lib = pkg('ui-lib', { '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '22.0.0': { peer: '^22.0.0', ago: 5 * 1440 }, '22.1.0': { peer: '^22.0.0', ago: 10 } });
  const r = await plan(world(lib), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: pnpm12 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(libIn(r, 22, 'ui-lib').to, '22.0.0');
  assert.deepEqual(libIn(r, 22, 'ui-lib').held, { version: '22.1.0', until: ripeAt(lib, '22.1.0', 1440) });
  assert.ok(r.plan.hops[0].command.endsWith(' ui-lib@22.0.0'));
  const text = (await plan(world(lib), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, text: true, manager: pnpm12 })).stdout;
  assert.match(text, /ui-lib: 21\.0\.0 -> 22\.0\.0; supports it \(\^22\.0\.0\); 22\.1\.0 is newer, but too young for pnpm and ng update until \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
  // The control: pnpm 10 has no minimum release age, and ng update reads none from it.
  const pnpm10 = await plan(world(lib), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: { '--version': '10.33.0' } });
  assert.equal(libIn(pnpm10, 22, 'ui-lib').to, '22.1.0');
});

test('tooling that follows Angular\'s major, with only a release too young for the new one, says until when, or that npm\'s before leaves it out', async () => {
  // angular-eslint's packages declared an @angular/cli peer in older releases, and whether they do isn't a question of age.
  const lib = pkg('@angular-eslint/schematics', { '20.0.0': { peers: { '@angular/cli': '>=20.0.0 <21.0.0' }, at: '2025-06-01' }, '21.0.0': { at: '2025-12-01' }, '22.0.0': { ago: 10 } });
  const reason = (r) => r.plan.unchecked.find((u) => u.name === '@angular-eslint/schematics')?.reason;
  const r = await plan(world(lib), pnpm21({ '@angular-eslint/schematics': '^21.0.0' }), { to: 22, manager: pnpm12 });
  assert.match(reason(r) ?? '', /^its 22\.x releases are too young until \d{4}-\d\d-\d\d \d\d:\d\d UTC, and it follows Angular's major$/, JSON.stringify(r.plan.unchecked));
  const before = `before=${new Date(Date.now() - 60 * 60e3).toISOString()}\n`;
  const npm = await plan(world(lib), app({ deps: { ...base, '@angular/core': '^21.0.0', '@angular-eslint/schematics': '^21.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', '@angular-eslint/schematics': '21.0.0' }, files: { '.npmrc': before } }), { to: 22 });
  assert.equal(reason(npm), 'its 22.x releases are newer than npm\'s before, and it follows Angular\'s major');
  const free = await plan(world(lib), pnpm21({ '@angular-eslint/schematics': '^21.0.0' }), { to: 22 });
  assert.equal(libIn(free, 22, '@angular-eslint/schematics').to, '22.0.0', 'the control: with no age, it moves');
});

test('tooling that follows Angular\'s major, a follower and a library a sibling moves take the newest release old enough, and name the younger one', async () => {
  const eslint = pkg('@angular-eslint/schematics', { '21.0.0': { at: '2025-12-01' }, '22.0.0': { at: '2026-06-10' }, '22.1.0': { ago: 10 } });
  const aligned = libIn(await plan(world(eslint), pnpm21({ '@angular-eslint/schematics': '^21.0.0' }), { to: 22, manager: pnpm12 }), 22, '@angular-eslint/schematics');
  assert.deepEqual([aligned.to, aligned.held], ['22.0.0', { version: '22.1.0', until: ripeAt(eslint, '22.1.0', 1440) }]);
  const before = { '.npmrc': `before=${new Date(Date.now() - 60 * 60e3).toISOString()}\n` };
  const icons = { ...evaIcons('16.0.0', '16.0.0'), ...evaIcons('17.0.0', '17.0.0'), '17.0.1': { peers: { '@nebular/theme': '17.0.0', 'eva-icons': '^1.1.3' }, ago: 10 } };
  const follower = libIn(await plan(world(...nebularWith(icons)), app({ deps: nebularDeps, lock: nebularLock, files: before }), { to: 21 }), 21, '@nebular/eva-icons');
  assert.deepEqual([follower.to, follower.held], ['17.0.0', { version: '17.0.1', until: null }]);
  // @angular/cdk 20 accepts Angular 21, and Nebular 17 needs cdk ^21.
  const cdk21 = pkg('@angular/cdk', { '20.2.14': { peer: '^20.0.0 || ^21.0.0', at: '2025-11-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '21.1.0': { peer: '^21.0.0', ago: 10 } });
  const moved = libIn(await plan(world(cdk21, nebular()), app({ deps: { ...base, '@angular/cdk': '20.2.14', '@nebular/theme': '16.0.0' }, lock: { ...lockBase, '@angular/cdk': '20.2.14', '@nebular/theme': '16.0.0' }, files: before }), { to: 21 }), 21, '@angular/cdk');
  assert.deepEqual([moved.to, moved.held], ['21.0.0', { version: '21.1.0', until: null }]);
});

test('a library a sibling moves to a release too young makes its major wait, and keeps nothing named against its first pick', async () => {
  // cdk's first pick is 21.0.0, with 21.1.0 named as newer, and Nebular 17 then needs ^21.1.0, out ten minutes.
  const before = { '.npmrc': `before=${new Date(Date.now() - 60 * 60e3).toISOString()}\n` };
  const cdk21 = pkg('@angular/cdk', { '20.2.14': { peer: '^20.0.0', at: '2025-11-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '21.1.0': { peer: '^21.0.0', ago: 10 } });
  const theme = pkg('@nebular/theme', { '16.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { '@angular/cdk': '^20.0.0' } }, '17.0.0': { peer: '^21.0.0', at: '2026-01-15', peers: { '@angular/cdk': '^21.1.0' } } });
  const r = await plan(world(cdk21, theme), app({ deps: { ...base, '@angular/cdk': '20.2.14', '@nebular/theme': '16.0.0' }, lock: { ...lockBase, '@angular/cdk': '20.2.14', '@nebular/theme': '16.0.0' }, files: before }), { to: 21 });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.blockers.map((b) => [b.name, b.kind, b.version]), [['@angular/cdk', 'too-young', '21.1.0']]);
  assert.equal(r.plan.waiting.libs.find((l) => l.name === '@angular/cdk').held, undefined, 'the release it now takes is no newer one');
});

test('from Angular CLI 22.1, ng update skips a young Angular patch itself, so the command keeps the major and the hop shows what it installs', async () => {
  const [core, compiler] = angular();
  youngPatch(core, '22.2.1', '22.2.0');
  const r = await plan([core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} })], pnpm21({}), { to: 22, manager: pnpm12 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.plan.hops[0].angular, '22.2.0');
  assert.equal(r.plan.hops[0].angularNewer.version, '22.2.1');
  assert.ok(r.plan.hops[0].command.endsWith(' @angular/core@22 @angular/cli@22'), r.plan.hops[0].command);
  const text = (await plan([core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} })], pnpm21({}), { to: 22, text: true, manager: pnpm12 })).stdout;
  assert.match(text, /^Angular 22 \(22\.2\.0; 22\.2\.1 is newer, but too young for pnpm and ng update until \d{4}-\d\d-\d\d \d\d:\d\d UTC\)$/m);
});

test('below Angular CLI 22.1, ng update takes Angular\'s newest patch however young, so the command names the newest old enough', async () => {
  // pnpm 12.16.1's install then let a young release in by writing an exemption nobody approved under its default age,
  // and refused it under an age the team set: ERR_PNPM_NO_MATURE_MATCHING_VERSION.
  const [core, compiler] = angular();
  youngPatch(core, '21.2.1', '21.2.0');
  const cli = pkg('@angular/cli', { '21.2.0': { at: '2025-11-28' }, '21.2.1': { ago: 30 } });
  const packages = () => [core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} }), cli];
  const proj = () => app({ deps: base, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.')) } });
  const r = await plan(packages(), proj(), { to: 21, manager: pnpm12 });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.plan.hops[0].command.endsWith(' @angular/core@21.2.0 @angular/cli@21.2.0'), r.plan.hops[0].command);
  const free = await plan(packages(), proj(), { to: 21 });
  assert.ok(free.plan.hops[0].command.endsWith(' @angular/core@21 @angular/cli@21'), 'the control: with no age, the majors');
});

test('an installed release is never held back, since the lockfile has it and the manager checks it against its exemptions', async () => {
  // M7's 21.4.0 was installed when it was 40 minutes old, with an exemption in pnpm-workspace.yaml. This 21.0.0 came
  // out after 21.1.0, as a backport does, so held back it would be swapped for 21.1.0 rather than picked again later.
  const lib = pkg('ui-lib', { '21.0.0': { peer: '^21.0.0 || ^22.0.0', ago: 40 }, '21.1.0': { peer: '^21.0.0 || ^22.0.0', at: '2025-12-01' } });
  const r = await plan(world(lib), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: pnpm12 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(libIn(r, 22, 'ui-lib').to, '21.0.0');
});

test('yarn from 4.11 and pnpm 10 hold back a release the registry gives no publish time, however old, so its major waits for an exemption', async () => {
  // yarn 4.11.0 to 4.18.1 gate a release whose time is undefined (typeof a>"u" in the gate): 4.11.0 said YN0082:
  // lib@npm:^1.1.0: No candidates found, and 4.18.1 YN0016: lib@npm:^1.1.0: All versions satisfying "^1.1.0" are
  // quarantined, until npmPreapprovedPackages listed it. pnpm 10.34.9 keeps only releases with a time before its cutoff:
  // ERR_PNPM_NO_MATURE_MATCHING_VERSION Version 1.1.0 (released NaN minutes ago) of lib does not meet the
  // minimumReleaseAge constraint, until minimumReleaseAgeExclude listed it. ng update 22.2.6 takes such a release, since
  // isReleaseAgeSatisfied finds no time for it, so once it's exempted the plain command runs, with nothing going in first.
  const gate = { '.yarnrc.yml': 'npmMinimalAgeGate: 1440\n' };
  const cases = [
    [yarnApp(), yarn18, 'yarn\'s npmMinimalAgeGate'],
    [yarnApp(undefined, gate), { '--version': '4.11.0' }, 'yarn\'s npmMinimalAgeGate'],
    [pnpm21({ 'ui-lib': '^21.0.0' }, { files: { 'pnpm-workspace.yaml': 'minimumReleaseAge: 1440\n' } }), { '--version': '10.34.9' }, 'pnpm\'s minimumReleaseAge'],
  ];
  for (const [proj, manager, setting] of cases) {
    const r = await plan(world(undated()), proj, { to: 22, manager });
    assert.equal(r.code, 2, `${manager['--version']}: ${r.stderr}`);
    assert.deepEqual(r.plan.blockers.map((b) => [b.name, b.kind, b.version, b.until, b.noPublishTime]), [['ui-lib', 'too-young', '22.0.0', null, true]], manager['--version']);
    assert.equal(r.plan.blockers[0].reason, `22.0.0 has no publish time on the registry, so ${setting} can't tell its age and holds it back however old it is, until the registry gives it one or the person exempts it`);
    assert.deepEqual([r.plan.waiting.until, r.plan.waiting.sooner], [null, r.plan.waiting.command], manager['--version']);
  }
  const text = (await plan(world(undated()), yarnApp(), { to: 22, text: true, manager: yarn18 })).stdout;
  assert.match(text, /^Result: BLOCKED\. Angular 22 needs releases with no publish time on the registry, which yarn holds back however old they are, so this project stays on 21 until the registry gives them one\.$/m, text);
  assert.match(text, /^Angular 22 \(22\.2\.0\), waiting on a publish time from the registry$/m);
  assert.match(text, /^ {2}ui-lib: 21\.0\.0 -> 22\.0\.0; supports it \(\^22\.0\.0\); missing its publish time on the registry, which yarn holds back$/m);
  assert.ok(text.includes(`\n  Sooner, once the person approves exempting ui-lib 22.0.0 and that is committed by itself: node ${quotePath(UPDATE)} @angular/core@22 @angular/cli@22 ui-lib@22.0.0\n`), text);
  assert.doesNotMatch(text, /^ {2}(From |Run: )/m, 'no time to wait for, and nothing to run');
  // The control: yarn 4.10.1's gate read new Date(undefined), whose time is NaN, so it took the release.
  const old = await plan(world(undated()), yarnApp(undefined, gate), { to: 22, manager: { '--version': '4.10.1' } });
  assert.deepEqual([old.code, libIn(old, 22, 'ui-lib')?.to], [0, '22.0.0'], old.stderr);
});

test('yarn takes a release it can date over one with no publish time, waits for a dated one first, and the command never leaves ng update the undated one', async () => {
  // yarn 4.18.1 took 1.0.0 for ^1.0.0 over 1.1.0, which had no time. ng update from Angular CLI 22.1 takes Angular's
  // newest that it doesn't skip as too young, and it never skips one with no time, so @angular/core@22 would bring it.
  const lib = undated({ '22.0.0': { peer: '^22.0.0', ago: 5 * 1440 }, '22.1.0': { peer: '^22.0.0' } });
  const passed = await plan(world(lib), yarnApp(), { to: 22, manager: yarn18 });
  assert.deepEqual([libIn(passed, 22, 'ui-lib')?.to, libIn(passed, 22, 'ui-lib')?.held], ['22.0.0', { version: '22.1.0', until: null, noPublishTime: true }], passed.stderr);
  const text = (await plan(world(lib), yarnApp(), { to: 22, text: true, manager: yarn18 })).stdout;
  assert.match(text, /^ {2}ui-lib: 21\.0\.0 -> 22\.0\.0; supports it \(\^22\.0\.0\); 22\.1\.0 is newer, but the registry gives it no publish time, which yarn holds back$/m, text);
  // A release old enough in a day beats one with no time, which never is.
  const soon = undated({ '22.1.0': { peer: '^22.0.0', ago: 10 } });
  const waits = await plan(world(soon), yarnApp(), { to: 22, manager: yarn18 });
  assert.deepEqual([waits.plan.waiting?.libs.find((l) => l.name === 'ui-lib').to, waits.plan.waiting?.until], ['22.1.0', ripeAt(soon, '22.1.0', 1440)], waits.stderr);
  const r = await plan(undatedPatch(), yarnApp({}), { to: 22, manager: yarn18 });
  assert.ok(r.plan.hops[0]?.command.endsWith(' @angular/core@22.2.0 @angular/cli@22.2.0'), r.stdout + r.stderr);
  const angularText = (await plan(undatedPatch(), yarnApp({}), { to: 22, text: true, manager: yarn18 })).stdout;
  assert.match(angularText, /^Angular 22 \(22\.2\.0; 22\.3\.0 is newer, but the registry gives it no publish time, which yarn holds back\)$/m, angularText);
});

test('with no publish time, tooling that follows Angular\'s major, a patch and Angular itself say what yarn holds back, and give no time', async () => {
  const eslint = pkg('@angular-eslint/schematics', { '21.0.0': { at: '2025-12-01' }, '22.0.0': {} });
  const tooling = await plan(world(eslint), yarnApp({ '@angular-eslint/schematics': '^21.0.0' }), { to: 22, manager: yarn18 });
  assert.equal(tooling.plan.unchecked.find((u) => u.name === '@angular-eslint/schematics')?.reason, 'its 22.x releases have no publish time on the registry, which yarn holds back, and it follows Angular\'s major', tooling.stdout + tooling.stderr);
  const on22 = () => app({ deps: { ...base, '@angular/core': '^22.2.0', '@angular/cli': '^22.2.0' }, files: { 'yarn.lock': '' } });
  const patch = await plan(undatedPatch(), on22(), { to: 22, manager: yarn18 });
  assert.deepEqual(patch.plan.patchesHeld, ['@angular/core', '@angular/cli'].map((name) => ({ name, version: '22.3.0', until: null, noPublishTime: true })), patch.stdout + patch.stderr);
  const patchText = (await plan(undatedPatch(), on22(), { to: 22, text: true, manager: yarn18 })).stdout;
  assert.match(patchText, /^Already on Angular 22\. Nothing to upgrade until the registry gives them a publish time:$/m, patchText);
  assert.match(patchText, /^ {2}@angular\/core: 22\.3\.0 is missing its publish time on the registry, which yarn holds back$/m);
  // Angular 23's one release has no time, so the hop has nothing yarn takes, and nothing goes in before Angular.
  const [core, compiler] = angular();
  for (const doc of [core, compiler]) { doc.versions['23.0.0'] = { ...doc.versions['22.2.0'], version: '23.0.0' }; doc['dist-tags'].latest = '23.0.0'; }
  const next = await plan([core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} })], on22(), { manager: yarn18 });
  assert.equal(next.code, 2, next.stderr);
  assert.deepEqual(next.plan.blockers.map((b) => [b.name, b.kind, b.noPublishTime]), [['@angular/core', 'too-young', true]]);
  assert.equal(next.plan.waiting.noSooner, 'Angular 23 itself has no publish time on the registry, which yarn holds back');
});

test('npm, bun and ng update count a release with no publish time old enough, and pnpm from 11.23 then checks none of its package', async () => {
  // npm 11.19.0 installed it under before and under min-release-age, as npm-pick-manifest's isBefore passes a release with
  // no time, bun 1.4.2 under minimumReleaseAge, and ng update 22.2.6's isReleaseAgeSatisfied counts it old enough. pnpm
  // 11.28.11 drops a package's times when any release lacks one (dropIncompletePublishTimes), and 11.28.11, 12.4.2 and
  // 12.16.1 then installed its release from 5 minutes before, warning: The metadata of lib is missing the "time" field;
  // skipping the minimumReleaseAge check for this package. pnpm view printed it no time either, so ng update skips none.
  // pnpm 11.0.0 kept the times, as pnpm 10 does: it installed 1.0.0 for ^1.0.0 over a 1.1.0 with no time and a 1.2.0
  // five minutes old, and pnpm view printed 1.2.0's time for ng update to skip it by. dropIncompletePublishTimes came in
  // pnpm 11.23.0 (pnpm/pnpm#13750), and 11.22.0 doesn't have it.
  const before = `before=${new Date(Date.now() - 60 * 60e3).toISOString()}\n`;
  const bun = app({ deps: { ...base, '@angular/core': '^21.0.0', 'ui-lib': '^21.0.0' }, files: { 'bun.lock': '{}', 'bunfig.toml': '[install]\nminimumReleaseAge = 86400\n' } });
  for (const proj of [npmApp(before), bun]) {
    const r = await plan(world(undated()), proj, { to: 22 });
    assert.deepEqual([r.code, libIn(r, 22, 'ui-lib')?.to], [0, '22.0.0'], r.stderr);
  }
  // 21.0.0 has no time, and 22.0.0 is ten minutes old.
  const young = undated({ '21.0.0': { peer: '^21.0.0' }, '22.0.0': { peer: '^22.0.0', ago: 10 } });
  for (const [version, code] of [['11.0.0', 2], ['11.22.0', 2], ['11.23.0', 0], ['11.28.11', 0], ['12.16.1', 0]]) {
    const r = await plan(world(young), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: { '--version': version } });
    const lib = (r.plan.waiting ?? r.plan.hops.at(-1))?.libs.find((l) => l.name === 'ui-lib');
    assert.deepEqual([r.code, lib?.to], [code, '22.0.0'], `${version}: ${r.stderr}`);
  }
  const dated = await plan(world(youngLib()), pnpm21({ 'ui-lib': '^21.0.0' }), { to: 22, manager: pnpm12 });
  assert.equal(dated.code, 2, 'the control: with 21.0.0 dated too, pnpm 12 holds 22.0.0 back');
});

test('a release younger than pnpm\'s minimum release age makes its major wait, with when, instead of printing a command ng update refuses', async () => {
  // M7: the team's 22.0.0 was minutes old, the plan called Angular 22 reachable, and Angular CLI 22.2's ng update skipped
  // it, saying only: Package "@acme/ui-core" has an incompatible peer dependency to "@angular/common" (requires "^21.2.0", would install "22.2.5").
  const packages = acme(10);
  const r = await plan(world(), pnpm21(acmeDeps), { to: 22, own: { scope: '@acme', packages }, manager: pnpm12 });
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.plan.reachable, 21);
  assert.deepEqual(r.plan.hops, [], 'a command that would fail is never a hop');
  assert.deepEqual(r.plan.blockers.map((b) => [b.major, b.name, b.kind, b.version]), [[22, '@acme/ui-core', 'too-young', '22.0.0'], [22, '@acme/ui-forms', 'too-young', '22.0.0']]);
  assert.equal(r.plan.waiting.until, ripeAt(packages[1], '22.0.0', 1440), 'until the last of them is old enough');
  assert.match(r.plan.blockers[0].reason, /; from Angular CLI 22\.1, ng update skips it until then too and reads no exemption list$/);
  assert.equal(r.plan.ownBlockers, undefined, 'they are upgraded already, so upgrading them first is no answer');
  assert.ok(r.plan.waiting.sooner.endsWith(' --install-first @acme/ui-core --install-first @acme/ui-forms @angular/core@22 @angular/cli@22 @acme/ui-core@22.0.0 @acme/ui-forms@22.0.0'), r.plan.waiting.sooner);
  const text = (await plan(world(), pnpm21(acmeDeps), { to: 22, text: true, own: { scope: '@acme', packages }, manager: pnpm12 })).stdout;
  assert.match(text, /^Result: BLOCKED until \d{4}-\d\d-\d\d \d\d:\d\d UTC\. Angular 22 needs releases too young for pnpm and ng update until then/m);
  assert.match(text, /^Angular 22 \(22\.2\.0\), waiting until \d{4}-\d\d-\d\d \d\d:\d\d UTC$/m);
  assert.match(text, /^ {2}From \d{4}-\d\d-\d\d \d\d:\d\d UTC: /m);
  assert.match(text, /^ {2}Sooner, once the person approves exempting @acme\/ui-core 22\.0\.0 and @acme\/ui-forms 22\.0\.0 and that is committed by itself: /m);
  assert.doesNotMatch(text, /^ {2}Run: /m, 'no Run: line for a waiting major');
  // The control: a day and ten minutes on, the same releases make the hop ready.
  const later = await plan(world(), pnpm21(acmeDeps), { to: 22, own: { scope: '@acme', packages: acme(1450) }, manager: pnpm12 });
  assert.equal(later.code, 0, later.stderr);
  assert.ok(later.plan.hops[0].command.endsWith(' @acme/ui-core@22.0.0 @acme/ui-forms@22.0.0'));
});

test('the age is the one the team set, and the wait is for the first release that fits', async () => {
  const lib = pkg('ui-lib', { '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '22.0.0': { peer: '^22.0.0', ago: 5 * 1440 }, '22.1.0': { peer: '^22.0.0', ago: 10 } });
  const week = await plan(world(lib), pnpm21({ 'ui-lib': '^21.0.0' }, { files: { 'pnpm-workspace.yaml': 'minimumReleaseAge: 10080\n' } }), { to: 22, manager: pnpm12 });
  assert.equal(week.code, 2, week.stderr);
  assert.equal(week.plan.waiting.libs.find((l) => l.name === 'ui-lib').to, '22.0.0', 'in two days 22.0.0 is old enough, and 22.1.0 still is not');
  assert.equal(week.plan.waiting.until, ripeAt(lib, '22.0.0', 10080));
});

test('yarn 4.18.1 holds a release back by npmMinimalAgeGate, while yarn 4.9.4, which doesn\'t know it, and yarn 1 hold nothing back', async () => {
  // yarn 4.18.1 printed 1440 with nothing set. yarn 4.9.4 failed: Couldn't find a configuration settings named "npmMinimalAgeGate".
  const proj = (files = {}) => app({ deps: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0', 'ui-lib': '^21.0.0' }, files: { 'yarn.lock': '', ...files } });
  const r = await plan(world(youngLib()), proj(), { to: 22, manager: { '--version': '4.18.1' } });
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.plan.blockers[0].kind, 'too-young');
  assert.ok(r.plan.waiting.sooner.startsWith(`node ${quotePath(UPDATE)} --install-first ui-lib @angular/core@22`), r.plan.waiting.sooner);
  // A question it fails counts as no age, as ng update counts it, so nothing goes unchecked either.
  for (const version of ['4.9.4', '1.22.22']) {
    const free = await plan(world(youngLib()), proj(), { to: 22, manager: { '--version': version } });
    assert.equal(free.code, 0, `${version}: ${free.stderr}`);
    assert.deepEqual([free.plan.releaseAge, free.plan.unchecked.filter((u) => u.name === 'release age')], [null, []], version);
  }
  // yarn's grammar takes a unit too, as in 3d, which it prints as 4320.
  const days = await plan(world(), proj({ '.yarnrc.yml': 'npmMinimalAgeGate: 3d\n' }), { to: 22, manager: { '--version': '4.18.1' } });
  assert.equal(days.plan.releaseAge.minutes, 3 * 1440);
});

test('npm\'s min-release-age holds a release back at install, where ng update reads only before, so an approved exemption is enough', { skip: !npmKnowsAge && 'this npm has no min-release-age' }, async () => {
  // npm 11.19.0 printed null for `npm config get before` with min-release-age=1 set, then refused the release:
  // npm error code ETARGET, No matching version found for young@2.0.0 with a date before ...
  const r = await plan(world(youngLib()), npmApp('min-release-age=1\n'), { to: 22 });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.releaseAge, { manager: 'npm', setting: 'min-release-age', minutes: 1440, ngUpdateReads: false });
  assert.equal(r.plan.waiting.sooner, r.plan.waiting.command);
  assert.equal((await plan(world(youngLib()), npmApp(''), { to: 22 })).code, 0, 'the control: npm holds nothing back by default');
});

test('npm\'s before is a date, so a release after it waits with no time to wait for, and nothing gets it past ng update sooner', async () => {
  const rc = `before=${new Date(Date.now() - 60 * 60e3).toISOString()}\n`;
  const r = await plan(world(youngLib()), npmApp(rc), { to: 22 });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.blockers.map((b) => [b.kind, b.until]), [['too-young', null]]);
  assert.equal(r.plan.waiting.sooner, null);
  const text = (await plan(world(youngLib()), npmApp(rc), { to: 22, text: true })).stdout;
  assert.match(text, /^Result: BLOCKED\. Angular 22 needs releases newer than npm's before, \d{4}-\d\d-\d\d \d\d:\d\d UTC, so this project stays on 21 until that setting moves\.$/m);
  assert.match(text, /^Angular 22 \(22\.2\.0\), waiting on npm's before$/m);
  assert.match(text, /^ {2}ui-lib: 21\.0\.0 -> 22\.0\.0; supports it \(\^22\.0\.0\); newer than npm's before$/m);
  assert.match(text, /^ {2}No sooner way: ng update applies npm's before to every package and reads no exemption list\.$/m);
  assert.doesNotMatch(text, /^ {2}(From \d|Run: )/m, 'no time to wait for, and nothing to run');
  const after = await plan(world(youngLib()), npmApp(`before=${new Date(Date.now() + 60e3).toISOString()}\n`), { to: 22 });
  assert.equal(after.code, 0, after.stderr);
});

test('npm 11.10 to 11.14 turn min-release-age into a before that many days back, which ng update reads, so the wait has a time', async () => {
  // npm 11.13.0 with min-release-age=1 listed min-release-age as null and before as a day back to the second, and
  // `npm config get before` printed that date. Here npm_config_npm_version stands in for that npm. npm sets it for the
  // scripts it runs, npm test included, and it beats a project's .npmrc.
  const rc = (minutes) => `before=${new Date(Date.now() - minutes * 60e3).toISOString()}\n`;
  const npm1113 = { env: { npm_config_npm_version: '11.13.0' } };
  const lib = youngLib();
  const r = await plan(world(lib), npmApp(rc(1440)), { to: 22, ...npm1113 });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.releaseAge, { manager: 'npm', setting: 'min-release-age', minutes: 1440, ngUpdateReads: true });
  assert.equal(r.plan.waiting.until, ripeAt(lib, '22.0.0', 1440));
  assert.equal(r.plan.waiting.noSooner, 'ng update applies npm\'s min-release-age to every package and reads no exemption list');
  const set = await plan(world(youngLib()), npmApp(rc(1470)), { to: 22, ...npm1113 });
  assert.equal(set.plan.releaseAge.setting, 'before', 'the control: a before half an hour off a whole day is one someone set');
});

test('an npm before 11.17 has no min-release-age-exclude, so there is no sooner way, and npm exempts a package, not a release', async () => {
  // npm 11.16.0 has no such setting: it warned `Unknown project config "min-release-age-exclude"`. Node 24.18 bundles it.
  // Here npm_config_npm_version stands in for that npm. ng update below 22.1 doesn't apply before, so only the install
  // holds the release back.
  const lib = pkg('ui-lib', { '20.1.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', ago: 10 } });
  const proj = () => app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.1.0' }, files: { '.npmrc': `before=${new Date(Date.now() - 60 * 60e3).toISOString()}\n` } });
  const old = await plan(world(lib), proj(), { to: 21, text: true, env: { npm_config_npm_version: '11.16.0' } });
  assert.match(old.stdout, /^ {2}No sooner way: this npm has no min-release-age-exclude, which npm 11\.17 added\.$/m, old.stdout);
  const now = await plan(world(lib), proj(), { to: 21, text: true, env: { npm_config_npm_version: '11.17.0' } });
  assert.match(now.stdout, /^ {2}Sooner, once the person approves exempting ui-lib and that is committed by itself: npx --no-install ng update /m, now.stdout);
});

test('a major out for less than the minimum release age waits as a whole, and Angular itself never goes in first', async () => {
  const [core, compiler] = angular({ 20: '2025-05-28', 21: '2025-11-19' });
  for (const doc of [core, compiler]) youngPatch(doc, '22.0.0', '21.0.0', 120);
  const r = await plan([core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} })], pnpm21({}), { manager: pnpm12 });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.blockers.map((b) => [b.name, b.kind]), [['@angular/core', 'too-young']]);
  assert.equal(r.plan.waiting.sooner, null);
  assert.match(r.plan.waiting.noSooner, /^Angular 22 itself is too young/);
});

test('with Angular and a library both too young, the no-sooner line gives Angular\'s own time, which can come first', async () => {
  // The From time is the last release's. Once Angular itself is old enough, a sooner way for the library can open.
  const [core, compiler] = angular({ 20: '2025-05-28', 21: '2025-11-19' });
  for (const doc of [core, compiler]) youngPatch(doc, '22.0.0', '21.0.0', 120);
  const r = await plan([core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} }), youngLib()], pnpm21({ 'ui-lib': '^21.0.0' }), { manager: pnpm12, text: true });
  const [, angularUntil] = /^ {2}Angular 22: @angular\/core: .* until (\d{4}-\d\d-\d\d \d\d:\d\d UTC), /m.exec(r.stdout) || [];
  const [, from] = /^ {2}From (\d{4}-\d\d-\d\d \d\d:\d\d UTC): /m.exec(r.stdout) || [];
  assert.ok(angularUntil && from && angularUntil !== from, r.stdout);
  assert.match(r.stdout, new RegExp(`^ {2}No sooner way: Angular 22 itself is too young until ${angularUntil}\\.$`, 'm'));
});

test('a young library that ships migrations can only wait, since installing it first would skip them', async () => {
  // The control is the M7 test above: the same releases without migrations get a Sooner command.
  const r = await plan(world(), pnpm21(acmeDeps), { to: 22, own: { scope: '@acme', packages: acme(10, { migrations: true }) }, manager: pnpm12 });
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.plan.waiting.sooner, null);
  assert.match(r.plan.waiting.noSooner, /@acme\/ui-core ships migrations/);
});

test('a follower whose only release that fits is too young waits with its major, instead of reading as a peer conflict', async () => {
  const icons = { ...evaIcons('16.0.0', '16.0.0'), '17.0.0': { peers: { '@nebular/theme': '17.0.0', 'eva-icons': '^1.1.3' }, ago: 10 } };
  const rc = `before=${new Date(Date.now() - 60 * 60e3).toISOString()}\n`;
  const r = await plan(world(...nebularWith(icons)), app({ deps: nebularDeps, lock: nebularLock, files: { '.npmrc': rc } }), { to: 21 });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.blockers.map((b) => [b.name, b.kind]), [['@nebular/eva-icons', 'too-young']]);
});

test('on a --next hop, a CLI prerelease younger than the age makes the major wait until the CLI is old enough', async () => {
  // A CLI can come out hours after core: 22.1.0 did, three hours later.
  const packages = nextWorld('23.0.0-rc.1');
  const cli = packages.find((p) => p.name === '@angular/cli');
  // Every release dated, since pnpm from 11.23 checks none of a package with one that isn't.
  for (const v of Object.keys(cli.versions)) cli.time[v] = '2026-05-28T00:00:00.000Z';
  cli.time['23.0.0-rc.1'] = new Date(Date.now() - 30 * 60e3).toISOString();
  const proj = () => app({ deps: { ...base, '@angular/core': '^22.0.0', '@angular/cli': '^22.0.0' }, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: '22.2.0', cli: '22.2.0' })) } });
  const r = await plan(packages, proj(), { next: true, manager: pnpm12 });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.waiting.held.map((h) => [h.name, h.version, h.until]), [['@angular/cli', '23.0.0-rc.1', ripeAt(cli, '23.0.0-rc.1', 1440)]]);
  assert.match(r.plan.waiting.noSooner, /^Angular 23 itself is too young/);
  assert.equal((await plan(packages, proj(), { next: true })).code, 0, 'the control: with no age, the prerelease is the hop');
});

test('a CLI younger than the age holds its major back though core is old enough, since ng update leaves a young CLI behind', async () => {
  // On npm the CLI came out after core by 30 minutes at 22.0.0 and by 3 hours 41 at 22.2.0. CLI 22.2.6's resolver gives
  // a young CLI no target, so its package group stays on the old major while core's moves.
  const [core, compiler] = angular();
  for (const doc of [core, compiler]) youngPatch(doc, '23.0.0', '22.2.0', 1445);
  const cli = (ago) => pkg('@angular/cli', { '22.2.0': { at: '2026-05-28' }, '23.0.0': { ago } });
  const young = cli(1400);
  const proj = () => app({ deps: { ...base, '@angular/core': '^22.0.0', '@angular/cli': '^22.0.0' }, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: '22.2.0', cli: '22.2.0' })) } });
  const r = await plan([core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} }), young], proj(), { manager: pnpm12 });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.plan.waiting.held.map((h) => [h.name, h.version, h.until]), [['@angular/cli', '23.0.0', ripeAt(young, '23.0.0', 1440)]]);
  assert.match(r.plan.waiting.noSooner, /^Angular 23 itself is too young/);
  const ready = await plan([core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} }), cli(1450)], proj(), { manager: pnpm12 });
  assert.equal(ready.code, 0, 'the control: with the CLI old enough too, the hop runs');
});

test('on the target major, a patch too young is named, and the newest old enough is offered', async () => {
  const [core, compiler] = angular();
  youngPatch(core, '22.3.0', '22.2.0');
  // The CLI comes out after core, by 3 hours 41 at 22.2.0.
  const cli = pkg('@angular/cli', { '22.0.0': { at: '2026-05-27' }, '22.2.0': { at: '2026-05-28' }, '22.3.0': { ago: 10 } });
  const packages = () => [core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} }), cli];
  const proj = (v = '22.0.0') => app({ deps: { ...base, '@angular/core': '^22.0.0', '@angular/cli': '^22.0.0' }, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: v, cli: v })) } });
  const r = await plan(packages(), proj(), { to: 22, manager: pnpm12 });
  assert.ok(r.plan.patches.command.endsWith(' @angular/core@22.2.0 @angular/cli@22.2.0'), r.plan.patches.command);
  assert.equal(r.plan.patches.packages[0].held.version, '22.3.0');
  // ng update skips young releases from the installed CLI 22.1 on, and this app is on 22.0.0.
  const text = (await plan(packages(), proj(), { to: 22, text: true, manager: pnpm12 })).stdout;
  assert.match(text, /^ {2}@angular\/core: 22\.0\.0 -> 22\.2\.0; 22\.3\.0 is newer, but too young for pnpm until \d{4}-\d\d-\d\d \d\d:\d\d UTC$/m);
  const free = await plan(packages(), proj(), { to: 22 });
  assert.ok(free.plan.patches.command.endsWith(' @angular/core@22.3.0 @angular/cli@22.3.0'), 'the control: with no age, the newest');
  // On the newest old enough already, only the young one is left, and it's named with when.
  const none = await plan(packages(), proj('22.2.0'), { to: 22, manager: pnpm12 });
  assert.equal(none.plan.patches, undefined);
  assert.deepEqual(none.plan.patchesHeld, [{ name: '@angular/core', version: '22.3.0', until: ripeAt(core, '22.3.0', 1440) }, { name: '@angular/cli', version: '22.3.0', until: ripeAt(cli, '22.3.0', 1440) }]);
  const noneText = (await plan(packages(), proj('22.2.0'), { to: 22, text: true, manager: pnpm12 })).stdout;
  // Core's patch is old enough first, and from then it's an upgrade on its own.
  const [, coreUntil] = /^ {2}@angular\/core: 22\.3\.0 is too young for pnpm and ng update until (\d{4}-\d\d-\d\d \d\d:\d\d UTC)$/m.exec(noneText) || [];
  assert.match(noneText, new RegExp(`^Already on Angular 22\\. Nothing to upgrade until ${coreUntil}:$`, 'm'));
  assert.match(noneText, /^ {2}@angular\/cli: 22\.3\.0 is too young for pnpm and ng update until \d{4}-\d\d-\d\d \d\d:\d\d UTC$/m);
  assert.doesNotMatch(noneText, /Run: /);
});

test('a waiting major prints after the one that is ready, and the result says how far the project gets today', async () => {
  const lib = pkg('ui-lib', { '20.1.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '22.0.0': { peer: '^22.0.0', ago: 10 } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.')) } }), { to: 22, text: true, manager: pnpm12 });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stdout, /^Result: BLOCKED at Angular 22 until \d{4}-\d\d-\d\d \d\d:\d\d UTC\. Angular 21 is the highest version everything supports today, and Angular 22 needs releases too young for pnpm and ng update until then\.$/m);
  assert.match(r.stdout, /^Angular 21 \(21\.2\.0\)\n[^]*?^ {2}Run: [^\n]*\n\nAngular 22 \(22\.2\.0\), waiting until /m);
});
