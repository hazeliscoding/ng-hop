import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseSteps, selectSteps } from '../plugins/ng-hop/skills/ng-hop/scripts/guide.mjs';
import { GUIDE, project, runScript } from './helpers/harness.mjs';

const DATA = `
export enum ApplicationComplexity { Basic = 1, Medium = 2, Advanced = 3 }
export interface Step { step: string; action: string; }
export const RECOMMENDATIONS: Step[] = [
  // a comment between steps
  { possibleIn: 2100, necessaryAsOf: 2100, level: ApplicationComplexity.Basic, step: 'old', action: 'Old step, done by 21.' },
  { possibleIn: 2200, necessaryAsOf: 2200, level: ApplicationComplexity.Basic, step: 'during', action: 'It\\'s required with \`ng update\`.' },
  {
    possibleIn: 2100,
    necessaryAsOf: 2300,
    level: ApplicationComplexity.Medium,
    step: 'before',
    action:
      'Joined ' +
      "across lines.",
  },
  { possibleIn: 2200, necessaryAsOf: 2200, level: ApplicationComplexity.Advanced, step: 'advanced', action: 'Only for advanced apps.' },
  { possibleIn: 2200, necessaryAsOf: 2200, level: ApplicationComplexity.Basic, material: true, step: 'mat', action: 'Material only.' },
  { possibleIn: 2200, necessaryAsOf: 2200, level: ApplicationComplexity.Basic, windows: false, step: 'nix', action: 'Not on Windows.' },
  { possibleIn: 2300, necessaryAsOf: 2400, level: ApplicationComplexity.Basic, step: 'future', action: 'Later.' },
];
`;
const options = { ngUpgrade: false, material: false, windows: false };
const ids = (list) => list.map((s) => s.step);

test('parses every step, with escapes and strings joined across lines', () => {
  const steps = parseSteps(DATA);
  assert.equal(steps.length, 7);
  assert.equal(steps[1].action, "It's required with `ng update`.");
  assert.equal(steps[2].action, 'Joined across lines.');
  assert.equal(steps[2].level, 2);
  assert.equal(steps[4].material, true);
  assert.equal(steps[5].windows, false);
});

test('never evaluates the data, so hostile text stays text', () => {
  const steps = parseSteps("const RECOMMENDATIONS: Step[] = [{ possibleIn: 2200, necessaryAsOf: 2200, level: ApplicationComplexity.Basic, step: 'x', action: 'process.exit(9)' }];");
  assert.equal(steps[0].action, 'process.exit(9)');
  assert.throws(() => parseSteps('const RECOMMENDATIONS: Step[] = [{ action: process.exit(9) }];'), /Unexpected value/);
});

test('sorts steps into before, during and after the way angular.dev does', () => {
  const chosen = selectSteps(parseSteps(DATA), { from: 21, to: 22, level: 3, options });
  assert.deepEqual(ids(chosen.before), ['before']);
  assert.deepEqual(ids(chosen.during), ['during', 'advanced', 'nix']);
  assert.deepEqual(ids(chosen.after), []);
});

test('a lower level hides harder steps', () => {
  const chosen = selectSteps(parseSteps(DATA), { from: 21, to: 22, level: 1, options });
  assert.ok(!ids(chosen.during).includes('advanced'));
  assert.ok(!ids(chosen.before).includes('before'));
});

test('options show or hide steps', () => {
  const on = selectSteps(parseSteps(DATA), { from: 21, to: 22, level: 3, options: { ...options, material: true, windows: true } });
  assert.ok(ids(on.during).includes('mat'));
  assert.ok(!ids(on.during).includes('nix'));
});

test('the CLI reads the project for its options and prints a usable report', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ng-hop-guide-')), 'rec.ts');
  writeFileSync(file, DATA);
  const p = project({ deps: { '@angular/core': '^21.0.0', '@angular/material': '^21.0.0' } });
  const r = await runScript(GUIDE, ['--from', '21', '--to', '22', '--project', p.dir, '--source', file], { cwd: p.dir });
  p.remove();
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Options: material/);
  assert.match(r.stdout, /\[mat\] Material only\./);
  assert.match(r.stdout, /update-guide\?v=21\.0-22\.0&l=3/);
});

test('one major at a time, because that is all ng update allows', async () => {
  const r = await runScript(GUIDE, ['--from', '20', '--to', '22']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /one major at a time/);
});

test('when the data cannot be read it says so and points at the page, instead of reporting no steps', async () => {
  const r = await runScript(GUIDE, ['--from', '21', '--to', '22', '--source', join(tmpdir(), 'no-such-guide.ts')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /update-guide\?v=21\.0-22\.0/);
});

test('data in an unexpected shape fails loudly instead of reporting no steps', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ng-hop-guide-')), 'rec.ts');
  writeFileSync(file, 'export const SOMETHING_ELSE = [];');
  const r = await runScript(GUIDE, ['--from', '21', '--to', '22', '--source', file]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /RECOMMENDATIONS was not found/);
});
