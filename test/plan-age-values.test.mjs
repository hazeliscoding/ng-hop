import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { ageOf, app, base, pnpm12, pnpm21, pnpmImporter, pnpmLock, webApp, xdgWith, yarn21 } from './helpers/plan-fixtures.mjs';

// ---- Release age: what the package manager and ng update hold back --------------------------------------------------

test('pnpm reads a whole number of minutes, quoted or not, and leaves a value pnpm 12 refuses unknown, naming the file and the value', async () => {
  // pnpm 12.16.1: 60, "60", 60 # a comment, +60 and 0x3C read as 60, and 0 as no age; 1d, -5, 60.5, 1e3, 060 and a number
  // past 2^64 made every pnpm command fail with "invalid u64". It passed over an empty value to its config.yaml, and
  // read no pnpm-workspace.yml, and not the key under another one.
  const ageWith = (files, env) => ageOf(pnpm21({}, { files }), { manager: pnpm12, env });
  for (const value of ['60', '"60"', "'60'", '60 # an hour', '+60', '0x3C']) assert.equal((await ageWith({ 'pnpm-workspace.yaml': `minimumReleaseAge: ${value}\n` }))?.minutes, 60, value);
  assert.equal(await ageWith({ 'pnpm-workspace.yaml': 'minimumReleaseAge: 0\n' }), null);
  for (const value of ['', ' Null', ' NULL']) assert.equal((await ageWith({ 'pnpm-workspace.yaml': `minimumReleaseAge:${value}\n` }, xdgWith('minimumReleaseAge: 31\n')))?.minutes, 31, value);
  for (const value of ['1d', '-5', '60.5', '1e3', '060', '99999999999999999999', '18446744073709551616']) {
    const p = pnpm21({}, { files: { 'pnpm-workspace.yaml': `minimumReleaseAge: ${value}\n` } });
    assert.equal(await ageOf(p, { manager: pnpm12 }), `${join(p.dir, 'pnpm-workspace.yaml')} sets minimumReleaseAge to "${value}", which pnpm 12.16.1 refuses: every pnpm command fails on it until it is a whole number of minutes, so ask the person to fix it`);
  }
  // pnpm 12.16.1, 11.28.11 and 10.34.9 read 1_440 as 1440, which the plan doesn't follow, and 12.16.1 read 2^64 - 1, as
  // 18446744073709551615 or 0xFFFFFFFFFFFFFFFF, a number that rounds up to 2^64.
  const underscore = pnpm21({}, { files: { 'pnpm-workspace.yaml': 'minimumReleaseAge: 1_440\n' } });
  assert.equal(await ageOf(underscore, { manager: pnpm12 }), `${join(underscore.dir, 'pnpm-workspace.yaml')} sets minimumReleaseAge to "1_440", which is in a form the plan can't read, so the plan can't tell pnpm's minimum release age, and a release younger than that can still stop a command; ask the person to check it with pnpm config get minimum-release-age`);
  for (const value of ['18446744073709551615', '0xFFFFFFFFFFFFFFFF']) assert.match(await ageWith({ 'pnpm-workspace.yaml': `minimumReleaseAge: ${value}\n` }), new RegExp(`sets minimumReleaseAge to "${value}", too long for the plan to give the date`), value);
  // pnpm 12.16.1, 11.28.11 and 10.34.9 all failed on a key set twice: "duplicate mapping key".
  const twice = pnpm21({}, { files: { 'pnpm-workspace.yaml': 'minimumReleaseAge: 10\nminimumReleaseAge: 20\n' } });
  assert.equal(await ageOf(twice, { manager: pnpm12 }), `${join(twice.dir, 'pnpm-workspace.yaml')} sets minimumReleaseAge more than once, which pnpm 12.16.1 refuses: every pnpm command fails on it until it is set once, so ask the person to fix it`);
  // Whatever the key: all three failed on packages set twice in a pnpm-workspace.yaml, here one above the app, where the
  // plan read the default of a day, and 12.16.1 and 11.28.11 on any key set twice in their config.yaml, which pnpm 10
  // doesn't read.
  const packages = webApp({ 'pnpm-workspace.yaml': 'minimumReleaseAge: 60\npackages:\n  - other/*\npackages:\n  - apps/*\n' });
  for (const version of ['12.16.1', '10.34.9']) assert.equal(await ageOf(packages, { manager: { '--version': version } }), `${join(packages.root, 'pnpm-workspace.yaml')} sets packages more than once, which pnpm ${version} refuses: every pnpm command fails on it until it is set once, so ask the person to fix it`);
  const config = xdgWith('autoInstallPeers: true\nautoInstallPeers: true\n');
  assert.match(await ageWith({}, config), /config\.yaml sets autoInstallPeers more than once, which pnpm 12\.16\.1 refuses: /);
  assert.equal(await ageOf(pnpm21({}), { manager: { '--version': '10.34.9' }, env: config }), null, 'the control: pnpm 10');
  // 12.16.1 failed over 1d in its config.yaml or the nearest pnpm-workspace.yaml whatever set the age, the environment
  // or another file, and in one whose packages left the app out; 11.28.11 read the age that won.
  const day = { 'pnpm-workspace.yaml': 'minimumReleaseAge: 1d\n' }, env = { pnpm_config_minimum_release_age: '20' };
  assert.match(await ageWith(day, env), /pnpm-workspace\.yaml sets minimumReleaseAge to "1d", which pnpm 12\.16\.1 refuses/);
  assert.match(await ageWith({ 'pnpm-workspace.yaml': 'minimumReleaseAge: 10\n' }, xdgWith('minimumReleaseAge: 1d\n')), /config\.yaml sets minimumReleaseAge to "1d", which pnpm 12\.16\.1 refuses/);
  assert.match(await ageOf(webApp({ 'pnpm-workspace.yaml': 'minimumReleaseAge: 1d\npackages:\n  - other/*\n' }), { manager: pnpm12 }), /which pnpm 12\.16\.1 refuses/);
  assert.equal((await ageOf(pnpm21({}, { files: day }), { manager: { '--version': '11.28.11' }, env }))?.minutes, 20, 'the control: pnpm 11');
  for (const files of [{ 'pnpm-workspace.yml': 'minimumReleaseAge: 60\n' }, { 'pnpm-workspace.yaml': 'settings:\n  minimumReleaseAge: 60\n' }]) assert.equal((await ageWith(files))?.from, 'default', JSON.stringify(files));
});

test('a value on the line below its key, or in a file indented as a whole, is read, and a form the plan can\'t read is unknown, never refused', async () => {
  // pnpm 12.16.1, 11.28.11 and 10.34.9 read 60 from each of these, and yarn 4.18.1 45 from each of its own. The plan
  // read the default of a day from a value on the line below its key or in a file indented as a whole, and said yarn
  // refuses npmMinimalAgeGate with 45 below it.
  const pnpmWith = (text) => ageOf(pnpm21({}, { files: { 'pnpm-workspace.yaml': text } }), { manager: pnpm12 });
  for (const text of ['minimumReleaseAge:\n  60\n', 'minimumReleaseAge: # an hour\n  60\n', 'minimumReleaseAge:\n\n  60\n', '  minimumReleaseAge: 60\n', '# settings\n  minimumReleaseAge: 60\n', '---\n  minimumReleaseAge: 60\n', '--- # settings\nminimumReleaseAge: 60\n', 'minimumReleaseAge: 60\n...\n', '"minimumReleaseAge": 60\n']) {
    assert.equal((await pnpmWith(text))?.minutes, 60, text);
  }
  // Indented as a whole, a workspace's packages list sits under its key or at the key's own indentation.
  for (const [packages, minutes] of [['  packages:\n    - apps/*\n', 60], ['  packages:\n  - apps/*\n', 60], ['  packages:\n    - other/*\n', 1440]]) {
    assert.equal((await ageOf(webApp({ 'pnpm-workspace.yaml': `  minimumReleaseAge: 60\n${packages}` }), { manager: pnpm12 }))?.minutes, minutes, packages);
  }
  const yarnWith = (text) => ageOf(yarn21({ files: { '.yarnrc.yml': text } }), { manager: { '--version': '4.18.1' } });
  for (const text of ['npmMinimalAgeGate:\n  45\n', '  npmMinimalAgeGate: 45\n', 'npmMinimalAgeGate: 45\n...\n', '"npmMinimalAgeGate": 45\n']) assert.equal((await yarnWith(text))?.minutes, 45, text);
  // pnpm 12.16.1 read the tag !!int "60" and the flow document as 60, and refused 60 with 70 on the line below it, 60 and
  // 70 on the two lines below the key, and a colon with no space after it; yarn 4.18.1 refused !!int "45" and read the
  // anchor &a 45 as 45. All three pnpm and yarn failed every command over a second document, a string document starting
  // --- |, and "" with a value on the line below it, where the plan read the age. All three pnpm read the escape in
  // "6\x30" as 60, and yarn "4\x35" as 45, where the plan said they refuse it. The plan follows none of them, so it names
  // the line it can't read instead of guessing what the manager makes of it.
  const unread = (file, line, shown, check) => `line ${line} of ${file}, "${shown}", is in a form the plan can't read, so the plan can't tell ${check.split(' ')[0]}'s minimum release age, and a release younger than that can still stop a command; ask the person to check it with ${check}`;
  for (const [text, shown, line = 1] of [['minimumReleaseAge: !!int "60"\n', 'minimumReleaseAge: !!int "60"'], ['minimumReleaseAge: 60\n  70\n', 'minimumReleaseAge: 60'], ['minimumReleaseAge:\n  60\n  70\n', 'minimumReleaseAge:'], ['minimumReleaseAge:60\n', 'minimumReleaseAge:60'], ['{minimumReleaseAge: 60}\n', '{minimumReleaseAge: 60}'],
    ['---\nminimumReleaseAge: 60\n---\n', '---', 3], ['--- |\n  minimumReleaseAge: 60\n', '--- |'], ['minimumReleaseAge: ""\n  60\n', 'minimumReleaseAge: ""'], ['minimumReleaseAge: "6\\x30"\n', 'minimumReleaseAge: "6\\x30"']]) {
    const p = pnpm21({}, { files: { 'pnpm-workspace.yaml': text } });
    assert.equal(await ageOf(p, { manager: pnpm12 }), unread(join(p.dir, 'pnpm-workspace.yaml'), line, shown, 'pnpm config get minimum-release-age'), text);
  }
  for (const [text, shown, line = 1] of [['npmMinimalAgeGate: !!int "45"\n', 'npmMinimalAgeGate: !!int "45"'], ['npmMinimalAgeGate: &a 45\n', 'npmMinimalAgeGate: &a 45'], ['---\nnpmMinimalAgeGate: 45\n---\n', '---', 3], ['npmMinimalAgeGate: "4\\x35"\n', 'npmMinimalAgeGate: "4\\x35"']]) {
    const p = yarn21({ files: { '.yarnrc.yml': text } });
    assert.equal(await ageOf(p, { manager: { '--version': '4.18.1' } }), unread(join(p.dir, '.yarnrc.yml'), line, shown, 'yarn config get npmMinimalAgeGate'), text);
  }
  // A yarnPath the plan can't read leaves yarn's version unknown too, since it names the release yarn hands over to, and
  // so does an ignorePath it can't read, which says whether yarn hands over: yarn 4.18.1 failed on !!bool true. Read as
  // no ignorePath, it would give yarn 4.9.4, which holds nothing back.
  const path = yarn21({ pin: 'yarn@4.18.1', files: { '.yarnrc.yml': 'yarnPath: &p .yarn/releases/yarn-4.10.1.cjs\n' } });
  assert.equal(await ageOf(path, { manager: { '--version': '4.18.1' } }), unread(join(path.dir, '.yarnrc.yml'), 1, 'yarnPath: &p .yarn/releases/yarn-4.10.1.cjs', 'yarn config get npmMinimalAgeGate'));
  const ignore = yarn21({ pin: 'yarn@4.18.1', files: { '.yarnrc.yml': 'yarnPath: .yarn/releases/yarn-4.9.4.cjs\nignorePath: !!bool true\n' } });
  assert.equal(await ageOf(ignore, { manager: { '--version': '4.18.1' } }), unread(join(ignore.dir, '.yarnrc.yml'), 2, 'ignorePath: !!bool true', 'yarn config get npmMinimalAgeGate'));
});

test('no settings file a repo writes can stall the plan, with a long run of spaces or blank lines, many keys or a packages pattern full of wildcards', async () => {
  // Cutting a comment backtracked over a run of spaces, and the packages patterns over wildcards: 150,000 spaces took
  // 21 s, 16 ** parts against an app 16 folders down 47 s, and 8 *s against a folder name 60 letters long 56 s. Looking
  // for a key set twice compared each key with every other: 100,000 keys took 33 s. And the \s* starting each line of
  // bun's bunfig.toml and of the .npmrc pnpm 10 reads ran on over every blank line below it, as did the pattern reading
  // the keys of an app's own .npmrc below a pnpm workspace's root, which also backtracked over one long line: 40,000
  // blank lines took 1.5 s, and a line of 150,000 spaces 16.5 s, or 17.4 s with [ \t]* and [^=\n] in the pattern.
  const below = (pattern, rel) => {
    const p = app({ files: { 'pnpm-workspace.yaml': `minimumReleaseAge: 60\npackages:\n  - '${pattern}'\n`, [`${rel}/package.json`]: JSON.stringify({ name: 'web', dependencies: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' } }), [`${rel}/pnpm-lock.yaml`]: pnpmLock(pnpmImporter('.', { core: '21.2.0', cli: '21.2.0' })) } });
    return { dir: join(p.dir, rel) };
  };
  // pnpm 10 lays an app's own .npmrc over its workspace root's, so the plan takes the keys it sets from npm's listing.
  const appRc = (rc) => {
    const p = app({ files: { 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n", 'pnpm-lock.yaml': pnpmLock('  .: {}\n', pnpmImporter('apps/web', { core: '21.2.0', cli: '21.2.0' })), 'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' } }), 'apps/web/.npmrc': rc } });
    return { dir: join(p.dir, 'apps', 'web') };
  };
  const cases = [
    [pnpm21({}, { files: { 'pnpm-workspace.yaml': `minimumReleaseAge: 60${' '.repeat(150000)}x\n` } }), /sets minimumReleaseAge to "60 x", which pnpm 12\.16\.1 refuses/],
    [pnpm21({}, { files: { 'pnpm-workspace.yaml': `${Array.from({ length: 100000 }, (_, i) => `k${i}: 1\n`).join('')}minimumReleaseAge: 60\n` } }), 60],
    [app({ deps: { ...base, '@angular/core': '^21.0.0' }, files: { 'bun.lock': '{}', 'bunfig.toml': `${'\n'.repeat(150000)}[install]\nminimumReleaseAge = 3600\n` } }), 60],
    [pnpm21({}, { files: { '.npmrc': `${'\n'.repeat(150000)}; an hour\nminimum-release-age=60\n` } }), 60, { '--version': '10.34.9' }],
    [appRc(`${'\n'.repeat(150000)}; an hour\nminimum-release-age=60\n`), 60, { '--version': '10.34.9' }],
    [appRc(`a${' '.repeat(300000)}x\nminimum-release-age=60\n`), 60, { '--version': '10.34.9' }],
    [below(`apps/${'*a'.repeat(8)}b`, `apps/${'a'.repeat(60)}`), 1440],
    [below(`${'**/'.repeat(16)}x`, Array.from({ length: 16 }, (_, i) => `d${i}`).join('/')), 1440],
  ];
  // Each case is timed against an ordinary plan with the same manager just before it, since a busy machine slows both:
  // with 72 busy processes on 12 CPUs, the 150,000 spaces took 15.2 s with nothing backtracking. The heaviest ordinary
  // plan here, an app's own .npmrc, has pnpm 10's npm read settings twice, and the backtracking took 16.5 s or more on
  // top of a plan on an idle machine, so a case gets twice an ordinary plan and 5 s more.
  for (const [proj, expected, manager = pnpm12] of cases) {
    let started = Date.now();
    await ageOf(appRc('minimum-release-age=60\n'), { manager });
    const ordinary = Date.now() - started;
    started = Date.now();
    const age = await ageOf(proj, { manager });
    const took = Date.now() - started;
    assert.ok(took < 2 * ordinary + 5e3, `planning took ${took} ms, and an ordinary plan ${ordinary} ms`);
    if (expected instanceof RegExp) assert.match(age, expected); else assert.equal(age?.minutes, expected);
  }
  // The controls: the same patterns still take in an app they name.
  assert.equal((await ageOf(below(`${'**/'.repeat(16)}d15`, Array.from({ length: 16 }, (_, i) => `d${i}`).join('/')), { manager: pnpm12 }))?.minutes, 60);
  assert.equal((await ageOf(below(`apps/${'*a'.repeat(8)}`, `apps/${'a'.repeat(60)}`), { manager: pnpm12 }))?.minutes, 60);
});

test('yarn reads a duration by its own grammar, and ng update only the whole minutes yarn prints, so a fraction holds back only the install', async () => {
  // yarn 4.18.1 printed 3d as 4320, 90m as 90, "2h" as 120, 1w as 10080, 1.5h as 90, 30s as 0.5 and "60" as 60, and failed
  // on every command over "1 d", 2days, 2H, -5 and 1e3. ng update parses what yarn prints with ^(\d+)(ms|s|m|h|d|w)?$,
  // so 0.5 is no age to it, though yarn's install still holds a release back for half a minute.
  const yarnAge = (value) => ageOf(yarn21({ files: { '.yarnrc.yml': `npmMinimalAgeGate: ${value}\n` } }), { manager: { '--version': '4.18.1' } });
  for (const [value, minutes] of [['3d', 4320], ['90m', 90], ['"2h"', 120], ['1w', 10080], ['1.5h', 90], ['"60"', 60]]) {
    const age = await yarnAge(value);
    assert.deepEqual([age?.minutes, age?.ngUpdateReads], [minutes, true], value);
  }
  const half = await yarnAge('30s');
  assert.deepEqual([half?.minutes, half?.ngUpdateReads], [0.5, false]);
  for (const value of ['1 d', '2days', '2H', '-5', '1e3']) assert.match(await yarnAge(value), new RegExp(`\\.yarnrc\\.yml sets npmMinimalAgeGate to "${value}", which yarn 4\\.18\\.1 refuses: every yarn command fails on it until it is a number with an optional unit \\(ms, s, m, h, d or w\\), so ask the person to fix it$`), value);
});
