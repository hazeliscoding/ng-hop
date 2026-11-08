// Grader checks that read an agent's own words are easy to get wrong in both directions, so these hold real answers to
// them. Both of the correct ones here were marked as failures by an earlier version of the pattern.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CASES, check as checks } from '../evals/cases.mjs';
import { grade } from '../evals/grade.mjs';

const check = (caseName, text) => CASES.find((c) => c.name === caseName).assertions.find((a) => a.text === text);
const says = (assertion, finalText) => assertion.run({ finalText, around: (m) => m[0] })[0];

test('"21 is the furthest" accepts the ways agents really say it, and not an answer that goes further', () => {
  const furthest = check('ask-how-far', 'Says 21 is the furthest it can go today');
  for (const answer of [
    'You can get to **Angular 21** right now. Angular 22 is out (22.2.5), but one library isn\'t ready for it yet.',
    'Right now you can only go to **Angular 21**. Angular 22 is out, but **Nebular** is what stops you going further.',
    '**You can upgrade to Angular 21 today, but not 22 yet.**',
    'The furthest you can go is Angular 21.',
  ]) assert.ok(says(furthest, answer), answer);

  for (const answer of [
    'You can upgrade all the way to Angular 22.',
    'You can go to 22 right now, and 21 is fine too.',
    'Angular 22 is out and everything here supports it.',
  ]) assert.ok(!says(furthest, answer), answer);
});

test('a plain answer that gets it right passes, whichever words it uses', () => {
  const noPeers = check('ask-no-peer-info', 'Says npm cannot confirm it either way');
  assert.ok(says(noPeers, 'Neither version declares Angular as a peer dependency. npm won\'t warn you if the versions don\'t match.'));
  assert.ok(!says(noPeers, 'Syncfusion 30 works on Angular 22, so you are all set.'));

  const flexLayout = check('ask-deprecated-lib', 'Says npm cannot confirm it works on 21');
  assert.ok(says(flexLayout, 'Its peer dependencies require Angular 15, so the project is already out of range.'));
  assert.ok(says(flexLayout, '15.0.0-beta.42 is the last version ever published, and there won\'t be releases for Angular 16 through 21.'));
  assert.ok(says(flexLayout, '`15.0.0-beta.42` was the last release, from late 2022, and there won\'t be a version for Angular 16 or later.'));
  assert.ok(says(flexLayout, 'The library is dead. There will never be a version that supports Angular 21.'));
  assert.ok(says(flexLayout, 'No version supports Angular 16 or later, and none ever will.'));
  assert.ok(!says(flexLayout, 'That library is fine on Angular 21.'));

  const agGrid = check('upgrade-open-range', 'Flags AG Grid support as unconfirmed by npm');
  assert.ok(says(agGrid, 'npm can\'t confirm that AG Grid 36.3.0 supports Angular 21 or 22, because it accepts any Angular from 20 up.'));
  assert.ok(says(agGrid, 'AG Grid\'s npm package says it works with "Angular 17 or later", which doesn\'t tell you whether anyone has checked it against 22.'));
  assert.ok(!says(agGrid, 'AG Grid supports Angular 22.'));

  const waits = check('paste-peer-error', 'Offers waiting or replacing');
  assert.ok(says(waits, 'If you\'d rather not run an unsupported combination, the other option is to stay on Angular 21 until `ngx-toastr` releases a version for 22.'));
  assert.ok(!says(waits, 'Yes, just use --force.'));

  const options = check('upgrade-blocked', 'Offers waiting, replacing or forcing');
  assert.ok(says(options, 'Upgrade to Angular 21 now, and do 22 once Nebular supports it. Or upgrade to 22 anyway, using `overrides` in `package.json`. Or replace Nebular.'));
  assert.ok(!says(options, 'Nebular blocks this, so I stopped.'));
});

test('searching a log for a flag is not the same as running it', () => {
  const optional = check('upgrade-markdown-chain', 'Ran no optional migrations');
  const passes = (...commands) => optional.run({ commands })[0];
  assert.ok(passes('npx ng update @angular/core@22 > /tmp/ng.log 2>&1; grep -E "Optional migrations|ng update .*--name|UPDATE" /tmp/ng.log'));
  assert.ok(!passes('npx ng update @angular/core --name router-current-navigation'));
  assert.ok(!passes('git status && npx --no-install ng update @angular/cli --name=use-application-builder 2>&1 | tail -5'));
});

test('two packages that pin each other can stay or move, but not split', () => {
  const together = check('upgrade-open-range', 'Kept ag-grid-community and ag-grid-angular on the same version');
  const agrees = (angular, community) => together.run({ deps: { 'ag-grid-angular': angular, 'ag-grid-community': community } })[0];
  assert.ok(agrees('34.3.1', '34.3.1'));
  assert.ok(agrees('36.3.0', '36.3.0'));
  assert.ok(!agrees('36.3.0', '34.3.1'));
  assert.ok(!agrees(undefined, undefined));
});

test('handing the decision over can be phrased without a question mark', () => {
  const handsOver = check('upgrade-blocked', 'Stops and hands the decision to the person');
  const ends = (finalText) => handsOver.run({ finalText })[0];
  assert.ok(ends('This is fragile and I wouldn\'t recommend it.\n\nIf you want option 2, I can replace Nebular and then finish the upgrade to 22.'));
  assert.ok(!ends('The app is now on Angular 21.'));
});

test('the license case accepts stopping at 21 or carrying on with a warning, and scores asking first by itself', () => {
  const told = check('upgrade-license-change', 'Tells the person PrimeNG 22 changes its license');
  assert.ok(says(told, '**One thing to decide first: PrimeNG 22 now needs a license key.** It is now a commercial product.'));
  assert.ok(says(told, 'Every primeng release that supports Angular 22 has dropped the MIT license.'));
  assert.ok(!says(told, 'The app is now on Angular 22.2.4, and PrimeNG is on 22.1.4. Nothing blocked the upgrade.'));

  const ends = check('upgrade-license-change', 'package.json ends on Angular 21 or 22');
  const major = (v) => Number(/(\d+)/.exec(String(v))?.[1]);
  for (const [core, ok] of [['^21.2.26', true], ['^22.2.4', true], ['^20.3.0', false]]) assert.equal(ends.run({ deps: { '@angular/core': core }, major })[0], ok, core);

  const commits = check('upgrade-license-change', 'One commit per major, up to where it stopped');
  const run = (core, ...angulars) => commits.run({ deps: { '@angular/core': core }, major, facts: { commits: angulars.map((angular) => ({ angular, subject: '' })) } })[0];
  assert.ok(run('^21.2.26', '21.2.26'));
  assert.ok(run('^22.2.4', '21.2.26', '22.2.4'));
  assert.ok(!run('^22.2.4', '22.2.4'), 'it skipped a major');
  assert.ok(!run('^21.2.26'), 'nothing committed');

  const asked = check('upgrade-license-change', "Asked before moving onto PrimeNG's new license");
  assert.ok(asked.run({ deps: { primeng: '21.1.10' }, major })[0]);
  assert.ok(!asked.run({ deps: { primeng: '22.1.4' }, major })[0]);
});

test('a check that could not run is left out, because the failure that stopped it is already counted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-hop-grade-'));
  try {
    writeFileSync(join(dir, 'verification.json'), JSON.stringify({ install: { ok: false, out: 'Error: ERR_PNPM_IGNORED_BUILDS' }, build: { ok: false, out: 'skipped: install failed' }, test: { ok: true, out: '' } }));
    const c = { assertions: [checks.installs(), checks.builds(), checks.testsPass()] };
    const g = await grade(c, { config: 'without_skill', facts: {}, parsed: { tools: {} }, projectDir: dir, runDir: dir, verify: false });
    assert.deepEqual(g.expectations.map((e) => e.passed), [false, true], 'the failed install and the passing tests stay, and the skipped build goes');
    assert.equal(g.summary.total, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('facts an upgrade report owes the person, in the words real answers used', () => {
  const peer = check('upgrade-clean-path', 'Says ng-select now needs @angular/cdk');
  assert.ok(says(peer, 'ng-select 24 needs a new package. It now positions its dropdown with the Angular CDK.'));
  assert.ok(!says(peer, 'All libraries moved, and nothing broke.'));

  const node = check('upgrade-clean-path', 'Says Angular 22 needs a newer Node');
  assert.ok(says(node, '**Node:** Angular 22 needs ^22.22.3, ^24.15.0 or >=26.0.0, so check your CI.'));
  assert.ok(says(node, 'Node has to be at least 22.22 or 24.15 now.'));
  assert.ok(says(node, '## Node\nAngular 22 needs **`^22.22.3 || ^24.15.0 || >=26.0.0`**. This machine is on 24.20.0, so it\'s fine.'), 'an OpenCode answer');
  assert.ok(!says(node, 'Your Node version is fine.'));

  // Real wording: readme-wizard's PR, a run before the rule, and the misleading line that led to the rule.
  for (const name of ['real-readme-wizard', 'real-readme-wizard-no-tests']) {
    const none = CASES.find((c) => c.name === name).assertions.find((a) => /no unit test/i.test(a.text));
    assert.ok(says(none, 'No unit test ran at any point, because the suite already fails to compile on main.'), name);
    assert.ok(says(none, 'One spec has a type error, so Karma never runs any tests.'), name);
    assert.ok(!says(none, 'All results matched the starting point, including the one test failure.'), name);
    assert.ok(!says(none, 'Tests pass on every major.'), name);
  }
  assert.ok(!says(node, '## Node\n\nUnchanged.\n\n## Versions\n24.15 of the docs'), 'a heading reaches only the line under it');

  const wrong = check('ask-open-range', 'Does not claim 34.3.1 stops working on the newer Angular');
  assert.ok(!says(wrong, "So 34.3.1 won't work past Angular 20, and 36.3.0 is the version to plan around."));
  assert.ok(says(wrong, "34.3.1 accepts Angular 22 through an open-ended range, which doesn't prove it works."));
});

test('more right answers an earlier pattern missed, from the final benchmark', () => {
  const flexLayout = check('ask-deprecated-lib', 'Says npm cannot confirm it works on 21');
  assert.ok(says(flexLayout, '15.0.0-beta.42 was the last release. It will never support Angular 16+, let alone 21.'));

  const agGrid = check('upgrade-open-range', 'Flags AG Grid support as unconfirmed by npm');
  assert.ok(says(agGrid, "npm can't vouch for 34.3.1 on Angular 21 or 22, because it accepts any Angular from 17 up rather than naming these versions."));
  assert.ok(says(agGrid, "AG Grid's npm package accepts any Angular from 17 up (`>= 17`), so npm would never warn about a mismatch and that told me nothing."));
  assert.ok(!says(agGrid, 'AG Grid supports Angular 22.'));
});

test("git's own --force is not forcing past a peer check", () => {
  const forcing = check('upgrade-blocked', 'Never forced past peer checks (--force, --legacy-peer-deps)');
  const passes = (...commands) => forcing.run({ commands })[0];
  assert.ok(passes('t=$(mktemp -d) && git worktree add -q $t/base main && cd $t/base && npm ci --silent; cd - >/dev/null; git worktree remove --force $t/base'));
  assert.ok(!passes('npx ng update @angular/core@22 --force'));
  assert.ok(!passes('git worktree remove --force $t; npm install --legacy-peer-deps'), 'forcing after a git command still counts');
});
