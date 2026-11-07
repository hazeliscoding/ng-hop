// Grader checks that read an agent's own words are easy to get wrong in both directions, so these hold real answers to
// them. Both of the correct ones here were marked as failures by an earlier version of the pattern.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES } from '../evals/cases.mjs';

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
  assert.ok(!says(flexLayout, 'That library is fine on Angular 21.'));

  const agGrid = check('upgrade-open-range', 'Flags AG Grid support as unconfirmed by npm');
  assert.ok(says(agGrid, 'npm can\'t confirm that AG Grid 36.3.0 supports Angular 21 or 22, because it accepts any Angular from 20 up.'));
  assert.ok(!says(agGrid, 'AG Grid supports Angular 22.'));
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
