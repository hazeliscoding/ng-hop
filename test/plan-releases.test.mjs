import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pkg, plan, PLAN, runScript, startRegistry } from './helpers/harness.mjs';
import { app, base, libIn, lockBase, nextWorld, world } from './helpers/plan-fixtures.mjs';

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

test('an installed open-ended release stays, flagged, with the newer one named, because moving proves nothing more', async () => {
  // AG Grid: moving 34 to 36 swapped one open-ended range for another and brought two majors of its own changes.
  const lib = pkg('ag-grid-angular', { '35.0.0': { peer: '>=20.0.0', at: '2025-06-01' }, '36.0.0': { peer: '>=20.0.0', at: '2026-08-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ag-grid-angular': '^35.0.0' }, lock: { ...lockBase, 'ag-grid-angular': '35.0.0' } }));
  assert.equal(r.plan.status, 'ok');
  assert.equal(libIn(r, 22, 'ag-grid-angular').to, '35.0.0');
  assert.equal(libIn(r, 22, 'ag-grid-angular').support, 'stale');
  assert.equal(libIn(r, 22, 'ag-grid-angular').newer, '36.0.0');
  assert.ok(!r.plan.hops[1].command.includes('ag-grid-angular'), 'it stays out of the command');
  const text = await plan(world(lib), app({ deps: { ...base, 'ag-grid-angular': '^35.0.0' }, lock: { ...lockBase, 'ag-grid-angular': '35.0.0' } }), { text: true });
  assert.match(text.stdout, /ag-grid-angular: 35\.0\.0, no change; UNCONFIRMED.*36\.0\.0 is newer/);
});

test('an installed release that shipped after the major and accepts it stays put too', async () => {
  const lib = pkg('ag-grid-angular', { '36.0.0': { peer: '>=20.0.0', at: '2026-08-01' }, '36.3.0': { peer: '>=20.0.0', at: '2026-10-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ag-grid-angular': '^36.0.0' }, lock: { ...lockBase, 'ag-grid-angular': '36.0.0' } }));
  assert.equal(libIn(r, 22, 'ag-grid-angular').to, '36.0.0');
  assert.equal(libIn(r, 22, 'ag-grid-angular').support, 'open');
});

test('an installed release that rejects the major moves to an open-ended one, flagged', async () => {
  const lib = pkg('ag-grid-angular', { '35.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '36.0.0': { peer: '>=20.0.0', at: '2026-08-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ag-grid-angular': '^35.0.0' }, lock: { ...lockBase, 'ag-grid-angular': '35.0.0' } }));
  assert.equal(libIn(r, 22, 'ag-grid-angular').to, '36.0.0');
  assert.equal(libIn(r, 22, 'ag-grid-angular').support, 'open');
});

test('a deprecated installed release moves to an open-ended one instead of staying', async () => {
  const lib = pkg('ag-grid-angular', { '35.0.0': { peer: '>=20.0.0', at: '2025-06-01', deprecated: 'use 36' }, '36.0.0': { peer: '>=20.0.0', at: '2026-08-01' } });
  const r = await plan(world(lib), app({ deps: { ...base, 'ag-grid-angular': '^35.0.0' }, lock: { ...lockBase, 'ag-grid-angular': '35.0.0' } }));
  assert.equal(libIn(r, 22, 'ag-grid-angular').to, '36.0.0');
});

test('a peer a library newly requires is named, because npm and pnpm add it without a word', async () => {
  // ng-select 24 started requiring @angular/cdk, and moved its dropdown onto it.
  const releases = {
    '23.0.0': { peer: '^20.0.0', at: '2025-06-01' },
    '24.0.0': { peers: { '@angular/core': '^21.0.0', '@angular/cdk': '^21.0.0', 'optional-thing': '^1.0.0' }, at: '2025-12-01' },
  };
  const lib = pkg('@ng-select/ng-select', releases);
  lib.versions['24.0.0'].peerDependenciesMeta = { 'optional-thing': { optional: true } };
  const options = { deps: { ...base, '@ng-select/ng-select': '^23.0.0' }, lock: { ...lockBase, '@ng-select/ng-select': '23.0.0' } };
  const r = await plan(world(lib), app(options), { to: 21 });
  assert.deepEqual(libIn(r, 21, '@ng-select/ng-select').newPeers, ['@angular/cdk']);
  const text = await plan(world(lib), app(options), { to: 21, text: true });
  assert.match(text.stdout, /newly needs @angular\/cdk, not in package\.json/);

  const cdk = pkg('@angular/cdk', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' } });
  const listed = await plan(world(lib, cdk), app({ deps: { ...options.deps, '@angular/cdk': '^20.0.0' }, lock: { ...options.lock, '@angular/cdk': '20.0.0' } }), { to: 21 });
  assert.equal(libIn(listed, 21, '@ng-select/ng-select').newPeers, undefined, 'the app already lists it');
});

test('a peer a library newly requires is listed to install, with its version, because yarn does not add it', async () => {
  // On yarn 4, ng-select 24 failed the build with: Could not resolve "@angular/cdk/overlay".
  const lib = pkg('@ng-select/ng-select', { '23.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '24.0.0': { peers: { '@angular/core': '^21.0.0', '@angular/cdk': '^21.0.0' }, at: '2025-12-01' } });
  const cdk = pkg('@angular/cdk', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '21.1.0': { peer: '^21.0.0', at: '2026-01-01' } });
  const options = { deps: { ...base, '@ng-select/ng-select': '^23.0.0' }, lock: { ...lockBase, '@ng-select/ng-select': '23.0.0' } };
  const r = await plan(world(lib, cdk), app(options), { to: 21 });
  assert.deepEqual(r.plan.hops[0].shared.find((s) => s.name === '@angular/cdk'), { name: '@angular/cdk', from: null, to: '21.1.0', ranges: ['^21.0.0'], neededBy: ['@ng-select/ng-select'] });
  const text = await plan(world(lib, cdk), app(options), { to: 21, text: true });
  assert.match(text.stdout, /@angular\/cdk: not installed -> 21\.1\.0, fits \^21\.0\.0; needed by @ng-select\/ng-select/);

  const missing = await plan(world(lib), app(options), { to: 21 });
  assert.ok(missing.plan.unchecked.some((u) => u.name === '@angular/cdk'), 'a peer the registry has no release of is reported, not guessed');
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

test('a blocker from a scope with a registry of its own may be the team\'s, so the plan gives the order to upgrade it in', async () => {
  // Acme's libraries come from the company registry and stop at Angular 20, so the app is waiting on its own team.
  // forms needs theme, so theme goes first, though forms comes first by name.
  const theme = pkg('@acme/theme', { '20.4.0': { peer: '^20.0.0', at: '2025-09-01' } });
  const forms = pkg('@acme/forms', { '20.4.0': { peers: { '@angular/core': '^20.0.0', '@acme/theme': '^20.4.0' }, at: '2025-09-01' } });
  const options = { deps: { ...base, '@acme/forms': '^20.4.0', '@acme/theme': '^20.4.0' }, lock: { ...lockBase, '@acme/forms': '20.4.0', '@acme/theme': '20.4.0' } };
  const r = await plan(world(), app(options), { to: 21, own: { scope: '@acme', packages: [theme, forms] } });
  assert.equal(r.plan.status, 'blocked');
  assert.deepEqual(r.plan.ownBlockers, ['@acme/theme', '@acme/forms']);
  assert.ok(r.plan.blockers.every((b) => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(b.ownRegistry)), JSON.stringify(r.plan.blockers));

  const text = (await plan(world(), app(options), { to: 21, text: true, own: { scope: '@acme', packages: [theme, forms] } })).stdout;
  assert.match(text, /Note: @acme\/theme and @acme\/forms come from the registry your npm config sets for @acme\. If they are your team's, each can be upgraded first, with a release that accepts Angular 21, in this order: @acme\/theme, then @acme\/forms, which needs @acme\/theme\./);
  assert.match(text, /@acme\/forms: no stable release .*; your npm config sets a registry for @acme, http:\/\/127\.0\.0\.1:\d+\/\./);

  // The same libraries on the default registry, as a company-wide mirror would serve them, say nothing about owners.
  const mirrored = await plan(world(theme, forms), app(options), { to: 21 });
  assert.equal(mirrored.plan.status, 'blocked');
  assert.deepEqual(mirrored.plan.blockers.map((b) => b.name), ['@acme/forms', '@acme/theme']);
  assert.equal(mirrored.plan.ownBlockers, undefined);
  assert.ok(mirrored.plan.blockers.every((b) => !b.ownRegistry));
});

test('a licensed vendor sets up its registry the same way, so the plan says only what the npm config shows', async () => {
  // Infragistics serves its licensed Angular packages from a registry set for @infragistics, as a team serves its own.
  const ignite = pkg('@infragistics/igniteui-angular', { '20.1.0': { peer: '^20.0.0', at: '2025-09-01' } });
  const deps = { '@infragistics/igniteui-angular': '20.1.0' };
  const r = await plan(world(), app({ deps: { ...base, ...deps }, lock: { ...lockBase, ...deps } }), { to: 21, own: { scope: '@infragistics', packages: [ignite] } });
  assert.match(r.plan.blockers[0].reason, /; your npm config sets a registry for @infragistics, http:\/\/127\.0\.0\.1:\d+\/$/);
  // One library has no order to give.
  assert.equal(r.plan.notes.at(-1), "@infragistics/igniteui-angular comes from the registry your npm config sets for @infragistics. If it is your team's, it can be upgraded first, with a release that accepts Angular 21.");
});

test('libraries that need each other are named as such, and one that only needs them comes after all of them', async () => {
  // b needs x, and x and y need each other, so x and y go first, together, though b comes first by name.
  const lib = (name, needs) => pkg(name, { '20.4.0': { peers: { '@angular/core': '^20.0.0', [needs]: '^20.4.0' }, at: '2025-09-01' } });
  const libs = [lib('@acme/b', '@acme/x'), lib('@acme/x', '@acme/y'), lib('@acme/y', '@acme/x')];
  const deps = Object.fromEntries(libs.map((l) => [l.name, '20.4.0']));
  const r = await plan(world(), app({ deps: { ...base, ...deps }, lock: { ...lockBase, ...deps } }), { to: 21, own: { scope: '@acme', packages: libs } });
  assert.deepEqual(r.plan.ownBlockers, ['@acme/x', '@acme/y', '@acme/b']);
  assert.match(r.plan.notes.find((n) => n.includes('@acme/b')), /in this order: @acme\/x, which needs @acme\/y, then @acme\/y, which needs @acme\/x, then @acme\/b, which needs @acme\/x\. @acme\/x and @acme\/y need each other, so no order works for them: upgrade and publish them together\.$/);
});

test('a ring of three libraries that need each other is named whole, and apart from another ring', async () => {
  // x needs y, y needs z and z needs x, so each one's release needs the other two's. b only needs x, so it's no part of
  // the ring and comes after all of it, and c and d are a ring of their own.
  const lib = (name, needs) => pkg(name, { '20.4.0': { peers: { '@angular/core': '^20.0.0', [needs]: '^20.4.0' }, at: '2025-09-01' } });
  const ring = [lib('@acme/x', '@acme/y'), lib('@acme/y', '@acme/z'), lib('@acme/z', '@acme/x')];
  for (const [libs, order, together] of [
    [ring, ['@acme/x', '@acme/z', '@acme/y'], '@acme/x, @acme/z and @acme/y'],
    [[lib('@acme/b', '@acme/x'), ...ring], ['@acme/x', '@acme/z', '@acme/y', '@acme/b'], '@acme/x, @acme/z and @acme/y'],
    [[lib('@acme/c', '@acme/d'), lib('@acme/d', '@acme/c'), ...ring], ['@acme/c', '@acme/d', '@acme/x', '@acme/z', '@acme/y'], '@acme/c and @acme/d, and @acme/x, @acme/z and @acme/y'],
  ]) {
    const deps = Object.fromEntries(libs.map((l) => [l.name, '20.4.0']));
    const r = await plan(world(), app({ deps: { ...base, ...deps }, lock: { ...lockBase, ...deps } }), { to: 21, own: { scope: '@acme', packages: libs } });
    assert.deepEqual(r.plan.ownBlockers, order);
    assert.ok(r.plan.notes.at(-1).endsWith(`. ${together} need each other, so no order works for them: upgrade and publish them together.`), r.plan.notes.at(-1));
  }
});

test('an optional peer is no need, so it can\'t turn the order around', async () => {
  // theme works with forms if it's there, and forms needs theme.
  const theme = pkg('@acme/theme', { '20.4.0': { peers: { '@angular/core': '^20.0.0', '@acme/forms': '^20.4.0' }, at: '2025-09-01' } });
  theme.versions['20.4.0'].peerDependenciesMeta = { '@acme/forms': { optional: true } };
  const forms = pkg('@acme/forms', { '20.4.0': { peers: { '@angular/core': '^20.0.0', '@acme/theme': '^20.4.0' }, at: '2025-09-01' } });
  const deps = { '@acme/forms': '20.4.0', '@acme/theme': '20.4.0' };
  const r = await plan(world(), app({ deps: { ...base, ...deps }, lock: { ...lockBase, ...deps } }), { to: 21, own: { scope: '@acme', packages: [theme, forms] } });
  assert.deepEqual(r.plan.ownBlockers, ['@acme/theme', '@acme/forms']);
});

test('a scope pointed at the default registry, as a mirror is set up, says nothing about owners and still blocks', async () => {
  const theme = pkg('@acme/theme', { '20.4.0': { peer: '^20.0.0', at: '2025-09-01' } });
  const registry = await startRegistry(world(theme));
  const p = app({ deps: { ...base, '@acme/theme': '^20.4.0' }, lock: { ...lockBase, '@acme/theme': '20.4.0' }, files: { '.npmrc': `@acme:registry=${registry.url}\n` } });
  try {
    const r = await runScript(PLAN, ['--project', p.dir, '--to', '21', '--json'], { cwd: p.dir, env: { npm_config_registry: registry.url } });
    const result = JSON.parse(r.stdout);
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.blockers.map((b) => b.name), ['@acme/theme']);
    assert.equal(result.ownBlockers, undefined);
  } finally {
    await registry.close();
  }
});

// ---- --next ----------------------------------------------------------------------------------------------------

const on22 = { deps: { ...base, '@angular/core': '^22.0.0', '@angular/cli': '^22.0.0' }, lock: { ...lockBase, '@angular/core': '22.2.0', '@angular/cli': '22.2.0' } };

test('--next offers a minor prerelease of the current major as a patch, and says it is one', async () => {
  const r = await plan(nextWorld('22.3.0-next.4'), app(on22), { next: true });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.plan.status, 'already-there');
  assert.equal(r.plan.next, '22.3.0-next.4');
  assert.equal(r.plan.patches.command, 'npx --no-install ng update @angular/core@22.3.0-next.4 @angular/cli@22.3.0-next.4');
  const text = await plan(nextWorld('22.3.0-next.4'), app(on22), { next: true, text: true });
  assert.match(text.stdout, /prerelease/);
});

test('--next takes a prerelease of the next major as a hop of its own, and lets libraries use prereleases too', async () => {
  const lib = pkg('ui-lib', { '22.0.0': { peer: '^22.0.0', at: '2026-06-01' }, '23.0.0-rc.0': { peer: '^23.0.0-0', at: '2026-10-31' } });
  const stuck = pkg('old-lib', { '22.0.0': { peer: '^22.0.0', at: '2026-06-01' } });
  const deps = { ...on22.deps, 'ui-lib': '^22.0.0' };
  const lock = { ...on22.lock, 'ui-lib': '22.0.0' };
  const r = await plan(nextWorld('23.0.0-rc.1', lib), app({ deps, lock }), { next: true });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.plan.hops[0].major, 23);
  assert.equal(r.plan.hops[0].angular, '23.0.0-rc.1');
  assert.equal(libIn(r, 23, 'ui-lib').to, '23.0.0-rc.0');
  assert.equal(r.plan.hops[0].command, 'npx --no-install ng update @angular/core@23.0.0-rc.1 @angular/cli@23.0.0-rc.1 ui-lib@23.0.0-rc.0');

  const blocked = await plan(nextWorld('23.0.0-rc.1', lib, stuck), app({ deps: { ...deps, 'old-lib': '^22.0.0' }, lock: { ...lock, 'old-lib': '22.0.0' } }), { next: true });
  assert.equal(blocked.code, 2);
  assert.equal(blocked.plan.blockers[0].name, 'old-lib');
});

test('--next plans the stable majors below a prerelease major from stable releases', async () => {
  const r = await plan(nextWorld('23.0.0-rc.1'), app({ deps: { ...base, '@angular/core': '^21.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0' } }), { next: true });
  assert.deepEqual(r.plan.hops.map((h) => h.angular), ['22.2.0', '23.0.0-rc.1']);
});

test('without --next, a major with only a prerelease out says how to try it', async () => {
  const r = await plan(nextWorld('23.0.0-rc.1'), app(on22), { to: 23 });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Angular 23 isn't released/);
  assert.match(r.stderr, /23\.0\.0-rc\.1/);
  assert.match(r.stderr, /--next/);
});

test('--next with no prerelease newer than the latest release, or with another --to, makes no plan', async () => {
  const none = await plan(world(), app({ deps: base, lock: lockBase }), { next: true });
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no prerelease/);
  const mismatch = await plan(nextWorld('23.0.0-rc.1'), app(on22), { next: true, to: 22 });
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.stderr, /--next/);
});
