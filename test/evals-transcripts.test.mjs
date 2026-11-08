// The grader reads an agent's commands and last message from its transcript, and each agent writes a different one.
// These hold the shapes each documents, so a run on OpenCode is graded on what it did, not on a parse that found nothing.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parseTranscript } from '../evals/transcripts.mjs';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const transcript = (events) => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-hop-transcript-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'transcript.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\nnot json at all\n`);
  return dir;
};

// `opencode run --format json`: { type, timestamp, sessionID, part } a line.
const oc = (type, part) => ({ type, timestamp: 1, sessionID: 'ses_1', part });
const tool = (name, input) => oc('tool_use', { type: 'tool', tool: name, state: { status: 'completed', input, output: '' } });

test('an OpenCode run: its commands, the skill it loaded, its last message and its cost', () => {
  const p = parseTranscript(transcript([
    oc('step_start', { type: 'step-start' }),
    oc('text', { type: 'text', text: 'Looking at the project first.' }),
    tool('skill', { name: 'ng-hop' }),
    tool('bash', { command: 'node plan.mjs --to 22', description: 'Plan' }),
    oc('step_finish', { type: 'step-finish', cost: 0.01, tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 5, write: 0 } } }),
    oc('step_start', { type: 'step-start' }),
    tool('bash', { command: 'npx --no-install ng update @angular/core@21 @angular/cli@21' }),
    oc('text', { type: 'text', text: 'The app is on Angular 21.' }),
    oc('text', { type: 'text', text: 'Angular 22 is blocked by Nebular.' }),
    oc('step_finish', { type: 'step-finish', cost: 0.02, tokens: { input: 50, output: 10 } }),
  ]));
  assert.deepEqual(p.commands, ['node plan.mjs --to 22', 'npx --no-install ng update @angular/core@21 @angular/cli@21']);
  assert.deepEqual(p.skills, ['ng-hop']);
  assert.equal(p.finalText, 'The app is on Angular 21.\n\nAngular 22 is blocked by Nebular.', 'everything after its last tool call, not the earlier narration');
  assert.equal(p.result.num_turns, 2);
  assert.ok(Math.abs(p.result.total_cost_usd - 0.03) < 1e-9);
  assert.equal(p.result.usage.input_tokens, 185);
  assert.equal(p.tools.bash, 2);
});

test('an OpenCode 2 run: its shell commands, a skill loaded by id, and code that can call the other tools', () => {
  const code = 'return await tools.opencode.session_move({ directory: "/work/app" });';
  const p = parseTranscript(transcript([
    tool('skill', { id: 'ng-hop' }),
    tool('shell', { command: 'node plan.mjs --to 22', workdir: '/work/app' }),
    tool('execute', { code }),
    oc('text', { type: 'text', text: 'Done.' }),
  ]));
  assert.deepEqual(p.skills, ['ng-hop']);
  assert.deepEqual(p.commands, ['node plan.mjs --to 22', code]);
  assert.equal(p.tools.shell, 1);
});

test('an OpenCode run that read the skill\'s file instead of calling the skill tool still loaded it', () => {
  const p = parseTranscript(transcript([tool('read', { filePath: '/home/evals/.config/opencode/skills/ng-hop/SKILL.md' }), oc('text', { type: 'text', text: 'Done.' })]));
  assert.deepEqual(p.skills, ['ng-hop']);
});

test('an OpenCode error is recorded, and a run with no skill has none', () => {
  const p = parseTranscript(transcript([oc('step_start', { type: 'step-start' }), { type: 'error', timestamp: 1, sessionID: 'ses_1', error: { name: 'APIError', data: { message: 'rate limited' } } }]));
  assert.equal(p.result.is_error, true);
  assert.equal(p.result.error, 'rate limited');
  assert.deepEqual(p.skills, []);
  assert.deepEqual(p.commands, []);
});

test('a Claude Code run still reads as before', () => {
  const p = parseTranscript(transcript([
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'ng-hop:ng-hop' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git status --short' } }, { type: 'text', text: 'Done.' }] } },
    { type: 'result', result: 'The app is on Angular 22.', total_cost_usd: 0.5, num_turns: 3 },
  ]));
  assert.deepEqual(p.commands, ['git status --short']);
  assert.deepEqual(p.skills, ['ng-hop:ng-hop']);
  assert.equal(p.finalText, 'The app is on Angular 22.');
  assert.equal(p.result.total_cost_usd, 0.5);
});
