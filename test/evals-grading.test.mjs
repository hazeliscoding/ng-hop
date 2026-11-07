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
