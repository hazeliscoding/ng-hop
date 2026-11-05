import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { angular, pkg, plan, PLAN, project, runScript, startRegistry, typescript } from './helpers/harness.mjs';

const made = [];
const app = (opts) => { const p = project(opts); made.push(p); return p; };
after(() => made.forEach((p) => p.remove()));

const base = { '@angular/core': '^20.0.0', '@angular/cli': '^20.0.0', typescript: '~5.8.0', rxjs: '~7.8.0' };
const lockBase = { '@angular/core': '20.2.0', typescript: '5.8.3', rxjs: '7.8.2' };
const world = (...extra) => [...angular(), typescript(), pkg('rxjs', { '7.8.2': {} }), ...extra];
const libIn = (result, major, name) => result.plan.hops.find((h) => h.major === major)?.libs.find((l) => l.name === name);

// ---- Which release gets chosen ----------------------------------------------------------------------------------

test('a library that names each major moves through a release per major', async () => {
  const lib = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '22.0.0': { peer: '^22.0.0', at: '2026-06-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' } }));
  assert.equal(r.code, 0);
  assert.equal(r.plan.status, 'ok');
  assert.equal(r.plan.reachable, 22);
  assert.equal(libIn(r, 21, 'ui-lib').to, '21.0.0');
  assert.equal(libIn(r, 22, 'ui-lib').to, '22.0.0');
});

test('version numbers that do not match Angular are followed by their peer range', async () => {
  const lib = pkg('@clr/angular', { '17.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '18.5.0': { peer: '^21.1.0 || 22', at: '2026-06-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, '@clr/angular': '^17.0.0' }, lock: { ...lockBase, '@clr/angular': '17.0.0' } }));
  assert.equal(libIn(r, 22, '@clr/angular').to, '18.5.0');
  assert.equal(libIn(r, 22, '@clr/angular').support, 'declared');
});

test('an installed release that already names the major stays put', async () => {
  const lib = pkg('ui-lib', { '5.0.0': { peer: '^20.0.0 || ^21.0.0 || ^22.0.0', at: '2025-06-01' }, '6.0.0': { peer: '^22.0.0', at: '2026-06-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^5.0.0' }, lock: { ...lockBase, 'ui-lib': '5.0.0' } }), { to: 21 });
  assert.equal(libIn(r, 21, 'ui-lib').to, '5.0.0');
  assert.ok(!r.plan.hops[0].command.includes('ui-lib@'), 'an unchanged library stays out of the command');
});

test('a release older than the installed one is never chosen, even when it names the major', async () => {
  const lib = pkg('ui-lib', { '3.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '4.0.0': { peer: '^20.0.0', at: '2025-06-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^4.0.0' }, lock: { ...lockBase, 'ui-lib': '4.0.0' } }), { to: 21 });
  assert.equal(r.code, 2);
  assert.equal(r.plan.blockers[0].name, 'ui-lib');
});

test('prereleases are never chosen, and are reported as an option on the blocker', async () => {
  const lib = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0-rc.1': { peer: '^21.0.0', at: '2025-12-01' } }, { latest: '20.0.0' });
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' } }), { to: 21 });
  assert.equal(r.code, 2);
  assert.equal(r.plan.blockers[0].prerelease, '21.0.0-rc.1');
});

test('deprecated releases are skipped in favour of a good one', async () => {
  const lib = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '21.0.1': { peer: '^21.0.0', at: '2025-12-02', deprecated: 'broken build' } }, { latest: '21.0.1' });
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' } }), { to: 21 });
  assert.equal(libIn(r, 21, 'ui-lib').to, '21.0.0');
});

test('a stable release above the latest tag is not chosen', async () => {
  const lib = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '99.0.0': { peer: '^21.0.0', at: '2026-01-01' } }, { latest: '21.0.0' });
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' } }), { to: 21 });
  assert.equal(libIn(r, 21, 'ui-lib').to, '21.0.0');
});

// ---- Open-ended ranges ------------------------------------------------------------------------------------------

test('an open-ended range from after the major shipped is allowed and flagged as unconfirmed', async () => {
  const lib = pkg('ag-grid-angular', { '35.0.0': { peer: '>=20.0.0', at: '2025-06-01' }, '36.0.0': { peer: '>=20.0.0', at: '2026-08-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ag-grid-angular': '^35.0.0' }, lock: { ...lockBase, 'ag-grid-angular': '35.0.0' } }));
  assert.equal(r.plan.status, 'ok');
  assert.equal(libIn(r, 22, 'ag-grid-angular').to, '36.0.0');
  assert.equal(libIn(r, 22, 'ag-grid-angular').support, 'open');
});

test('a floor that names the major counts as declared, not as open-ended', async () => {
  const lib = pkg('ng2-charts', { '10.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '11.0.0': { peer: '>=22.0.0', at: '2026-06-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ng2-charts': '^10.0.0' }, lock: { ...lockBase, 'ng2-charts': '10.0.0' } }), { to: 22 });
  assert.equal(libIn(r, 22, 'ng2-charts').support, 'declared');
});

test('the ngx-toastr trap: an old open-ended release is rejected instead of downgrading to it', async () => {
  const toastr = pkg('ngx-toastr', { '19.1.0': { peer: '>=16.0.0-0', at: '2025-09-16' }, '20.0.5': { peer: '^21.0.0', at: '2026-02-06' } });
  const r = await plan(world(toastr), app({ deps: { ...base, '@angular/core': '^21.0.0', 'ngx-toastr': '^20.0.5' }, lock: { ...lockBase, '@angular/core': '21.2.0', 'ngx-toastr': '20.0.5' } }), { to: 22 });
  assert.equal(r.code, 2);
  assert.equal(r.plan.status, 'blocked');
  assert.equal(r.plan.reachable, 21);
  const b = r.plan.blockers[0];
  assert.equal(b.name, 'ngx-toastr');
  assert.equal(b.olderAccepts, '19.1.0');
  assert.match(b.reason, /downgrade/);
  assert.equal(r.plan.hops.length, 0);
});

test('an installed release older than the major stays, flagged, because moving it is impossible and npm will not object', async () => {
  const lib = pkg('old-directive', { '3.0.0': { peer: '>=14.0.0', at: '2024-01-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'old-directive': '^3.0.0' }, lock: { ...lockBase, 'old-directive': '3.0.0' } }), { to: 22 });
  assert.equal(r.plan.status, 'ok');
  assert.equal(libIn(r, 22, 'old-directive').support, 'stale');
});

test('an older release is not taken for fresh just because no date is known', async () => {
  const lib = pkg('no-dates', { '3.0.0': { peer: '>=14.0.0' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'no-dates': '^3.0.0' }, lock: { ...lockBase, 'no-dates': '3.0.0' } }), { to: 21 });
  assert.equal(libIn(r, 21, 'no-dates').support, 'open');
});

// ---- Blockers and the ceiling --------------------------------------------------------------------------------------

test('a library with no release for a major sets the ceiling below it', async () => {
  const nebular = pkg('@nebular/theme', { '16.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '17.0.0': { peer: '^21.0.0', at: '2026-01-15' } });
  const r = await plan(world(nebular), app({ deps: { ...base, '@nebular/theme': '^16.0.0' }, lock: { ...lockBase, '@nebular/theme': '16.0.0' } }));
  assert.equal(r.code, 2);
  assert.equal(r.plan.reachable, 21);
  assert.equal(r.plan.blockedAt, 22);
  assert.deepEqual(r.plan.hops.map((h) => h.major), [21]);
  assert.equal(r.plan.blockers[0].latest, '17.0.0');
  assert.equal(r.plan.blockers[0].lastPublished, '2026-01-15');
});

test('blocked on the very next major means no hops at all', async () => {
  const lib = pkg('stuck', { '1.0.0': { peer: '^20.0.0', at: '2025-06-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, stuck: '^1.0.0' }, lock: { ...lockBase, stuck: '1.0.0' } }));
  assert.equal(r.code, 2);
  assert.equal(r.plan.reachable, 20);
  assert.deepEqual(r.plan.hops, []);
});

test('every blocker up to the target is listed, not only the first', async () => {
  const a = pkg('stops-at-20', { '1.0.0': { peer: '^20.0.0', at: '2025-06-01' } });
  const b = pkg('stops-at-21', { '1.0.0': { peer: '^20.0.0 || ^21.0.0', at: '2025-12-01' } });
  const r = await plan(world(a, b), app({ deps: { ...base, 'stops-at-20': '^1.0.0', 'stops-at-21': '^1.0.0' }, lock: { ...lockBase, 'stops-at-20': '1.0.0', 'stops-at-21': '1.0.0' } }));
  assert.deepEqual(r.plan.blockers.map((b2) => `${b2.major}:${b2.name}`), ['21:stops-at-20', '22:stops-at-20', '22:stops-at-21']);
});

test('a dev dependency blocks too, because npm enforces its peers the same way', async () => {
  const lib = pkg('jest-preset-angular', { '1.0.0': { peer: '>=20.0.0 <22.0.0', at: '2025-12-01' } });
  const r = await plan(world(lib), app({ deps: base, devDeps: { 'jest-preset-angular': '^1.0.0' }, lock: { ...lockBase, 'jest-preset-angular': '1.0.0' } }));
  assert.equal(r.plan.reachable, 21);
  assert.equal(r.plan.blockers[0].name, 'jest-preset-angular');
});

test('a deprecated package says so on its blocker, so replacing it is an informed choice', async () => {
  const lib = pkg('@angular/flex-layout', { '15.0.0': { peer: '^20.0.0', at: '2023-01-01', deprecated: 'This package has been deprecated' } });
  const r = await plan(world(lib), app({ deps: { ...base, '@angular/flex-layout': '^15.0.0' }, lock: { ...lockBase, '@angular/flex-layout': '15.0.0' } }));
  assert.match(r.plan.blockers[0].reason, /deprecated/);
});

test('a deprecated library that npm still lets through stays unconfirmed, and the report says it is deprecated', async () => {
  const lib = pkg('@angular/flex-layout', { '15.0.0-beta.42': { peer: '>=15.0.0', at: '2022-11-01', deprecated: 'This package has been deprecated' } }, { latest: '15.0.0-beta.42' });
  const proj = { deps: { ...base, '@angular/flex-layout': '15.0.0-beta.42' }, lock: { ...lockBase, '@angular/flex-layout': '15.0.0-beta.42' } };
  const r = await plan(world(lib), app(proj), { to: 21 });
  assert.equal(r.plan.status, 'ok');
  assert.equal(libIn(r, 21, '@angular/flex-layout').support, 'stale');
  assert.match(libIn(r, 21, '@angular/flex-layout').deprecated, /deprecated/);
  const text = await plan(world(lib), app(proj), { to: 21, text: true });
  assert.match(text.stdout, /DEPRECATED on npm: "This package has been deprecated"/);
});

// ---- Things npm cannot answer ---------------------------------------------------------------------------------------

test('a library with no Angular peer is reported as unchecked and does not block', async () => {
  const lib = pkg('@syncfusion/ej2-angular-grids', { '35.1.42': { at: '2026-10-27' } });
  const r = await plan(world(lib), app({ deps: { ...base, '@syncfusion/ej2-angular-grids': '*' }, lock: { ...lockBase, '@syncfusion/ej2-angular-grids': '35.1.42' } }));
  assert.equal(r.plan.status, 'ok');
  assert.match(r.plan.unchecked.find((u) => u.name.includes('syncfusion')).reason, /no Angular version/);
});

test('an unrelated package is ignored without noise', async () => {
  const lib = pkg('lodash', { '4.17.21': {} });
  const r = await plan(world(lib), app({ deps: { ...base, lodash: '^4.17.21' }, lock: { ...lockBase, lodash: '4.17.21' } }));
  assert.deepEqual(r.plan.unchecked, []);
  assert.ok(r.plan.hops.every((h) => h.libs.length === 0));
});

test('git, file and workspace dependencies are reported instead of being looked up', async () => {
  const hits = [];
  const r = await plan(world(), app({ deps: { ...base, 'my-lib': 'file:../my-lib', 'other-lib': 'github:me/other-lib' }, lock: lockBase }), { registryOptions: { hits } });
  assert.equal(r.plan.unchecked.length, 2);
  assert.ok(!hits.includes('my-lib'));
});

test('a dependency name that is not a real npm name never reaches a URL or a command', async () => {
  const hits = [];
  const evil = 'evil&calc';
  const r = await plan(world(), app({ deps: { ...base, [evil]: '^1.0.0', '../../etc/passwd': '^1.0.0' }, lock: lockBase }), { registryOptions: { hits } });
  assert.equal(r.code, 0);
  assert.equal(r.plan.unchecked.length, 2);
  assert.ok(r.plan.unchecked.every((u) => /not a valid npm package name/.test(u.reason)));
  assert.ok(!hits.some((h) => h.includes('evil') || h.includes('passwd')));
});

test('an npm: alias is reported, because its name is not the package it installs', async () => {
  const hits = [];
  const r = await plan(world(), app({ deps: { ...base, 'my-alias': 'npm:ui-lib@^1.0.0' }, lock: lockBase }), { registryOptions: { hits } });
  assert.match(r.plan.unchecked[0].reason, /declared as "npm:ui-lib/);
  assert.ok(!hits.includes('my-alias'));
});

test('a package missing from the registry that looks like an Angular one is reported', async () => {
  const r = await plan(world(), app({ deps: { ...base, 'ngx-private-thing': '^1.0.0' }, lock: { ...lockBase, 'ngx-private-thing': '1.0.0' } }));
  assert.match(r.plan.unchecked[0].reason, /not found/);
});

test('eslint packages with no peers follow Angular by major', async () => {
  const lib = pkg('@angular-eslint/schematics', { '20.0.0': { migrations: true }, '21.0.0': { migrations: true }, '22.0.0': { migrations: true } });
  const r = await plan(world(lib), app({ deps: base, devDeps: { '@angular-eslint/schematics': '^20.0.0' }, lock: { ...lockBase, '@angular-eslint/schematics': '20.0.0' } }));
  assert.equal(libIn(r, 22, '@angular-eslint/schematics').to, '22.0.0');
  assert.equal(libIn(r, 22, '@angular-eslint/schematics').support, 'aligned');
});

test('aligned tooling: historical Angular peers do not reject the eligible current line', async () => {
  const lib = pkg('@angular-eslint/builder', {
    '22.1.0': { peers: { '@angular/cli': '>=22.0.0 <23.0.0' } },
    '22.5.0': { peers: { eslint: '^9.0.0 || ^10.0.0', typescript: '*' } },
    '22.6.0': { peers: { eslint: '^9.0.0 || ^10.0.0', typescript: '*' } },
  });
  for (const version of ['22.5.0', '22.6.0']) lib.versions[version].dependencies = { '@angular-devkit/core': '>=22.0.0 <23.0.0', '@angular-devkit/architect': '>=0.2200.0 <0.2300.0' };
  const r = await plan(world(lib), app({ deps: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' }, devDeps: { '@angular-eslint/builder': '^22.5.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', '@angular-eslint/builder': '22.5.0' } }), { to: 22 });
  assert.equal(r.code, 0, JSON.stringify(r.plan.blockers));
  assert.equal(r.plan.reachable, 22);
  assert.equal(libIn(r, 22, '@angular-eslint/builder').to, '22.6.0');
  assert.equal(libIn(r, 22, '@angular-eslint/builder').support, 'aligned');
  assert.match(r.plan.hops[0].command, /@angular-eslint\/builder@22\.6\.0/);
  assert.doesNotMatch(r.plan.hops[0].command, /--force|--allow-dirty/);
});

test('aligned tooling: explicit peers on eligible releases still block an incompatible major', async () => {
  const lib = pkg('@angular-eslint/builder', { '22.1.0': { peer: '^22.0.0' }, '22.5.0': { peer: '^21.0.0' }, '22.6.0': { peer: '^21.0.0' } });
  const r = await plan(world(lib), app({ deps: { ...base, '@angular/core': '^21.0.0' }, devDeps: { '@angular-eslint/builder': '^22.5.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', '@angular-eslint/builder': '22.5.0' } }), { to: 22 });
  assert.equal(r.code, 2);
  assert.equal(r.plan.blockers[0].name, '@angular-eslint/builder');
  assert.equal(r.plan.hops.length, 0);
});

test('aligned tooling: a higher installed line is not downgraded to infer compatibility', async () => {
  const lib = pkg('@angular-eslint/builder', { '22.1.0': { peer: '^22.0.0' }, '22.6.0': {}, '23.0.0': {} });
  const r = await plan(world(lib), app({ deps: { ...base, '@angular/core': '^21.0.0' }, devDeps: { '@angular-eslint/builder': '^23.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', '@angular-eslint/builder': '23.0.0' } }), { to: 22 });
  assert.equal(r.code, 2);
  assert.equal(r.plan.blockers[0].installed, '23.0.0');
  assert.equal(r.plan.hops.length, 0);
});

test('aligned tooling: even a peerless history never selects a release below the installed floor', async () => {
  const lib = pkg('@angular-eslint/builder', { '22.6.0': {}, '23.0.0': {} });
  const r = await plan(world(lib), app({ deps: { ...base, '@angular/core': '^21.0.0' }, devDeps: { '@angular-eslint/builder': '^23.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', '@angular-eslint/builder': '23.0.0' } }), { to: 22 });
  assert.equal(libIn(r, 22, '@angular-eslint/builder'), undefined);
  assert.ok(r.plan.unchecked.some((u) => u.name === '@angular-eslint/builder'));
  assert.ok(r.plan.hops.every((h) => !h.command.includes('@angular-eslint/builder@22.6.0')));
});

test('aligned tooling: the rule does not infer support for an ordinary library that lost peers', async () => {
  const lib = pkg('ngx-example-controls', { '21.0.0': { peer: '^21.0.0' }, '22.0.0': {} });
  const r = await plan(world(lib), app({ deps: { ...base, '@angular/core': '^21.0.0', 'ngx-example-controls': '^22.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', 'ngx-example-controls': '22.0.0' } }), { to: 22 });
  assert.equal(r.code, 2);
  assert.equal(r.plan.blockers[0].name, 'ngx-example-controls');
});

test('aligned tooling: explicit compatibility still works when there is no target-numbered line', async () => {
  const lib = pkg('@angular-eslint/builder', { '21.0.0': { peer: '^21.0.0 || ^22.0.0' } });
  const r = await plan(world(lib), app({ deps: { ...base, '@angular/core': '^21.0.0' }, devDeps: { '@angular-eslint/builder': '^21.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', '@angular-eslint/builder': '21.0.0' } }), { to: 22 });
  assert.equal(r.code, 0);
  assert.equal(libIn(r, 22, '@angular-eslint/builder').to, '21.0.0');
  assert.equal(libIn(r, 22, '@angular-eslint/builder').support, 'declared');
  assert.deepEqual(r.plan.unchecked, []);
});

// ---- Shared peers ------------------------------------------------------------------------------------------------------

test('TypeScript moves the smallest step the major needs', async () => {
  const r = await plan(world(), app({ deps: base, lock: lockBase }));
  assert.deepEqual(r.plan.hops.find((h) => h.major === 21).shared.map((s) => [s.name, s.to]), [['typescript', '5.9.3']]);
  assert.deepEqual(r.plan.hops.find((h) => h.major === 22).shared.map((s) => [s.from, s.to]), [['5.9.3', '6.0.3']], 'each major builds on the last');
});

test('TypeScript that already fits stays put', async () => {
  const r = await plan(world(), app({ deps: base, lock: { ...lockBase, typescript: '5.9.3' } }), { to: 21 });
  assert.deepEqual(r.plan.hops[0].shared, []);
});

test('a library needing an extra package brings it along when the project declares it', async () => {
  const md = pkg('ngx-markdown', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { marked: '^15.0.0' } }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', peers: { marked: '^17.0.0 || ^18.0.0' } } });
  const marked = pkg('marked', { '15.0.0': {}, '17.0.0': {}, '17.0.2': {}, '18.0.0': {} });
  const r = await plan(world(md, marked), app({ deps: { ...base, 'ngx-markdown': '^20.0.0', marked: '^15.0.0' }, lock: { ...lockBase, 'ngx-markdown': '20.0.0', marked: '15.0.0' } }), { to: 21 });
  assert.deepEqual(r.plan.hops[0].shared.find((s) => s.name === 'marked').to, '17.0.2');
});

test('an extra package the project does not declare is left for npm to install', async () => {
  const md = pkg('ngx-markdown', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { marked: '^15.0.0' } }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', peers: { marked: '^17.0.0' } } });
  const r = await plan(world(md), app({ deps: { ...base, 'ngx-markdown': '^20.0.0' }, lock: { ...lockBase, 'ngx-markdown': '20.0.0' } }), { to: 21 });
  assert.equal(r.plan.status, 'ok');
  assert.ok(!r.plan.hops[0].shared.some((s) => s.name === 'marked'));
});

test('an optional peer the project does not declare is ignored', async () => {
  const lib = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', peers: { 'not-installed': '^9.0.0' } } });
  lib.versions['21.0.0'].peerDependenciesMeta = { 'not-installed': { optional: true } };
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' } }), { to: 21 });
  assert.equal(r.plan.status, 'ok');
});

test('two libraries wanting incompatible TypeScript block the major with both named', async () => {
  const fire = pkg('@angular/fire', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', peers: { typescript: '>=5.8 <5.9' } } });
  const r = await plan(world(fire), app({ deps: { ...base, '@angular/fire': '^20.0.0' }, lock: { ...lockBase, '@angular/fire': '20.0.0' } }), { to: 21 });
  assert.equal(r.code, 2);
  const b = r.plan.blockers[0];
  assert.equal(b.kind, 'peer-conflict');
  assert.equal(b.name, 'typescript');
  assert.match(b.reason, /@angular\/fire wants >=5.8 <5.9/);
  assert.match(b.reason, /@angular\/compiler-cli wants/);
});

test('sibling libraries whose chosen versions disagree block instead of breaking at install time', async () => {
  const store = pkg('@ngrx/store', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' } });
  const effects = pkg('@ngrx/effects', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { '@ngrx/store': '20.0.0' } }, '21.0.1': { peer: '^21.0.0', at: '2025-12-02', peers: { '@ngrx/store': '21.0.1' } } });
  const r = await plan(world(store, effects), app({ deps: { ...base, '@ngrx/store': '^20.0.0', '@ngrx/effects': '^20.0.0' }, lock: { ...lockBase, '@ngrx/store': '20.0.0', '@ngrx/effects': '20.0.0' } }), { to: 21 });
  assert.equal(r.plan.blockers[0].kind, 'peer-conflict');
  assert.equal(r.plan.blockers[0].name, '@ngrx/store');
});

const cdk = () => pkg('@angular/cdk', { '20.2.14': { peer: '^20.0.0 || ^21.0.0', at: '2025-11-01' }, '21.2.14': { peer: '^21.0.0 || ^22.0.0', at: '2026-05-01' } });
const nebular = () => pkg('@nebular/theme', {
  '16.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { '@angular/cdk': '^20.0.0' } },
  '17.0.0': { peer: '^21.0.0', at: '2026-01-15', peers: { '@angular/cdk': '^21.0.0' } },
});
const cdkApp = () => app({ deps: { ...base, '@angular/cdk': '20.2.14', '@nebular/theme': '16.0.0' }, lock: { ...lockBase, '@angular/cdk': '20.2.14', '@nebular/theme': '16.0.0' } });

test('a library that could have stayed moves when a sibling needs it newer', async () => {
  const r = await plan(world(cdk(), nebular()), cdkApp(), { to: 21 });
  assert.equal(r.code, 0, JSON.stringify(r.plan?.blockers));
  assert.equal(r.plan.status, 'ok');
  assert.equal(libIn(r, 21, '@angular/cdk').to, '21.2.14');
  assert.equal(libIn(r, 21, '@nebular/theme').to, '17.0.0');
  assert.match(r.plan.hops[0].command, /@angular\/cdk@21\.2\.14/);
});

test('that move still leaves the real blocker at the next major', async () => {
  const r = await plan(world(cdk(), nebular()), cdkApp());
  assert.equal(r.plan.reachable, 21);
  assert.equal(r.plan.blockedAt, 22);
  assert.deepEqual(r.plan.blockers.map((b) => b.name), ['@nebular/theme']);
});

test('a chain of siblings follows through, and an old release stops counting once it moves', async () => {
  const lib = pkg('needs-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { 'shared-lib': '^1.0.0' } }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', peers: { 'shared-lib': '^2.0.0' } } });
  const shared = pkg('shared-lib', {
    '1.0.0': { peer: '^20.0.0 || ^21.0.0', at: '2025-06-01', peers: { 'third-lib': '^1.0.0' } },
    '2.0.0': { peer: '^20.0.0 || ^21.0.0', at: '2025-12-01', peers: { 'third-lib': '^2.0.0' } },
  });
  const third = pkg('third-lib', { '1.0.0': { peer: '^20.0.0 || ^21.0.0', at: '2025-06-01' }, '2.0.0': { peer: '^20.0.0 || ^21.0.0', at: '2025-12-01' } });
  const versions = { 'needs-lib': '20.0.0', 'shared-lib': '1.0.0', 'third-lib': '1.0.0' };
  const r = await plan(world(lib, shared, third), app({ deps: { ...base, ...versions }, lock: { ...lockBase, ...versions } }), { to: 21 });
  assert.equal(r.code, 0, JSON.stringify(r.plan?.blockers));
  assert.equal(libIn(r, 21, 'shared-lib').to, '2.0.0');
  assert.equal(libIn(r, 21, 'third-lib').to, '2.0.0');
});

test('when no release of the sibling can satisfy it, that is a real conflict', async () => {
  const fussy = pkg('fussy', { '1.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '2.0.0': { peer: '^21.0.0', at: '2025-12-01', peers: { '@angular/cdk': '>=21.5.0 <22.0.0' } } });
  const r = await plan(world(cdk(), fussy), app({ deps: { ...base, '@angular/cdk': '20.2.14', fussy: '1.0.0' }, lock: { ...lockBase, '@angular/cdk': '20.2.14', fussy: '1.0.0' } }), { to: 21 });
  assert.equal(r.code, 2);
  assert.equal(r.plan.blockers[0].kind, 'peer-conflict');
  assert.equal(r.plan.blockers[0].name, '@angular/cdk');
});

test('--help prints usage instead of a stack trace', async () => {
  const r = await runScript(PLAN, ['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage:/);
});

test('an unknown option says so in one line', async () => {
  const r = await runScript(PLAN, ['--nope']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--nope/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('sibling libraries that agree pass', async () => {
  const store = pkg('@ngrx/store', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.1': { peer: '^21.0.0', at: '2025-12-01' } });
  const effects = pkg('@ngrx/effects', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { '@ngrx/store': '20.0.0' } }, '21.0.1': { peer: '^21.0.0', at: '2025-12-02', peers: { '@ngrx/store': '21.0.1' } } });
  const r = await plan(world(store, effects), app({ deps: { ...base, '@ngrx/store': '^20.0.0', '@ngrx/effects': '^20.0.0' }, lock: { ...lockBase, '@ngrx/store': '20.0.0', '@ngrx/effects': '20.0.0' } }), { to: 21 });
  assert.equal(r.plan.status, 'ok');
  assert.match(r.plan.hops[0].command, /@ngrx\/effects@21\.0\.1/);
  assert.match(r.plan.hops[0].command, /@ngrx\/store@21\.0\.1/);
});

// ---- Commands, migrations, Node --------------------------------------------------------------------------------------

test('the command names Angular and every library that moves, and never forces', async () => {
  const lib = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' } }), { to: 21 });
  assert.equal(r.plan.hops[0].command, 'npx ng update @angular/core@21 @angular/cli@21 ui-lib@21.0.0');
  assert.doesNotMatch(r.stdout, /--force/);
});

test('a library that ships migrations is flagged', async () => {
  const lib = pkg('@angular/material', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', migrations: true }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', migrations: true } });
  const r = await plan(world(lib), app({ deps: { ...base, '@angular/material': '^20.0.0' }, lock: { ...lockBase, '@angular/material': '20.0.0' } }), { to: 21 });
  assert.equal(libIn(r, 21, '@angular/material').migrations, true);
});

for (const [lockfile, runner, manager] of [['pnpm-lock.yaml', 'pnpm exec', 'pnpm'], ['yarn.lock', 'yarn', 'yarn'], ['bun.lock', 'bunx', 'bun']]) {
  test(`${manager} projects get ${manager} commands`, async () => {
    const r = await plan(world(), app({ deps: base, files: { [lockfile]: '' } }), { to: 21 });
    assert.equal(r.plan.project.packageManager, manager);
    assert.ok(r.plan.hops[0].command.startsWith(`${runner} ng update`));
  });
}

test('Node outside a major\'s range is reported on that major', async () => {
  const [core, compiler] = angular();
  core.versions['21.2.0'].engines = { node: '>=999.0.0' };
  core.versions['22.2.0'].engines = { node: '>=1.0.0 <2.0.0' };
  const r = await plan([core, compiler, typescript(), pkg('rxjs', { '7.8.2': {} })], app({ deps: base, lock: lockBase }));
  assert.equal(r.plan.hops.find((h) => h.major === 21).node.status, 'too-old');
  assert.equal(r.plan.hops.find((h) => h.major === 22).node.status, 'unsupported');
});

// ---- Project state and refusing to guess ------------------------------------------------------------------------------

test('the lockfile wins over the declared range, so a resumed upgrade starts where it stopped', async () => {
  const r = await plan(world(), app({ deps: { ...base, '@angular/core': '^20.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0' } }));
  assert.equal(r.plan.project.angular, '21.2.0');
  assert.deepEqual(r.plan.hops.map((h) => h.major), [22]);
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

// ---- The report people read ---------------------------------------------------------------------------------------------

test('the text report leads with the result and names the blocker', async () => {
  const nebular = pkg('@nebular/theme', { '16.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '17.0.0': { peer: '^21.0.0', at: '2026-01-15' } });
  const r = await plan(world(nebular), app({ deps: { ...base, '@nebular/theme': '^16.0.0' }, lock: { ...lockBase, '@nebular/theme': '16.0.0' } }), { text: true });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /Result: BLOCKED at Angular 22\. Angular 21 is the highest version everything supports today\./);
  assert.match(r.stdout, /@nebular\/theme: no stable release/);
  assert.match(r.stdout, /Run: npx ng update @angular\/core@21 @angular\/cli@21 @nebular\/theme@17\.0\.0/);
});

test('the text report calls out unconfirmed libraries', async () => {
  const lib = pkg('ag-grid-angular', { '36.0.0': { peer: '>=20.0.0', at: '2026-08-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ag-grid-angular': '^36.0.0' }, lock: { ...lockBase, 'ag-grid-angular': '36.0.0' } }), { text: true, to: 22 });
  assert.match(r.stdout, /UNCONFIRMED/);
});
