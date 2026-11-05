#!/usr/bin/env node
// Does the skill fire when it should, and stay quiet when it shouldn't? Each query runs in a clean headless session in
// an Angular project, and stops as soon as the skill loads or the agent settles on doing something else.
// This does skill-creator's trigger check. Its own script calls select() on pipes, which doesn't work on Windows.
// Usage: node evals/trigger.mjs --iteration 1 [--split all|train|test] [--runs 2] [--model id] [--concurrency 2]
import { execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PLUGIN, TEMPLATES, WORKSPACE } from './common.mjs';
import { TRIGGER_QUERIES } from './trigger-queries.mjs';

const { values } = parseArgs({ options: {
  iteration: { type: 'string', default: '1' }, split: { type: 'string', default: 'all' }, runs: { type: 'string', default: '2' },
  model: { type: 'string', default: 'claude-opus-5-5' }, concurrency: { type: 'string', default: '2' }, timeout: { type: 'string', default: '120' },
} });
const outDir = join(WORKSPACE, `trigger-${values.iteration}`);
const project = join(outDir, 'project');
mkdirSync(outDir, { recursive: true });
if (!existsSync(project)) {
  mkdirSync(project, { recursive: true });
  // A real project, so a query that needs one finds it. It has no install, which the skill's plan doesn't need.
  for (const f of ['package.json', 'package-lock.json', 'angular.json', 'tsconfig.json', '.gitignore']) cpSync(join(TEMPLATES, 'plain-20', f), join(project, f));
  cpSync(join(TEMPLATES, 'plain-20', 'src'), join(project, 'src'), { recursive: true });
  execSync('git init -q -b main && git add -A && git -c user.name=F -c user.email=f@example.invalid commit -q -m start', { cwd: project, stdio: 'ignore' });
}

const queries = TRIGGER_QUERIES.filter((q) => values.split === 'all' || q.split === values.split);

function runOnce(query) {
  const args = ['-p', query, '--model', values.model, '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence',
    '--permission-mode', 'auto', '--plugin-dir', PLUGIN, '--max-budget-usd', '1', '--disallowedTools', 'Edit', 'Write', 'Bash(git push*)', 'Bash(npm install*)', 'Bash(npm i *)', 'Bash(npx --no-install ng update*)', 'Bash(npx ng update*)',
    '--output-format', 'stream-json', '--verbose'];
  const env = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
  delete env.CLAUDECODE;
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: project, env, stdio: ['ignore', 'pipe', 'ignore'] });
    let buffer = '';
    let triggered = false;
    let toolsSeen = 0;
    let settled = false;
    let cost = 0;
    const stop = () => {
      if (settled) return;
      settled = true;
      if (process.platform === 'win32') { try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ } } else child.kill('SIGTERM');
    };
    const timer = setTimeout(stop, Number(values.timeout) * 1000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'result') cost = event.total_cost_usd || 0;
        if (event.type !== 'assistant') continue;
        for (const part of event.message?.content || []) {
          if (part.type !== 'tool_use') continue;
          toolsSeen += 1;
          if (part.name === 'Skill' && String(part.input?.skill).includes('ng-hop')) { triggered = true; stop(); }
          // An agent that wanted the skill loads it early. Six other tool calls in, it has chosen another way.
          if (toolsSeen >= 6) stop();
        }
      }
    });
    child.on('close', () => { clearTimeout(timer); resolve({ triggered, cost }); });
  });
}

const jobs = queries.flatMap((q) => Array.from({ length: Number(values.runs) }, () => q));
const results = new Map(queries.map((q) => [q.query, []]));
let next = 0;
let spent = 0;
await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
  while (next < jobs.length) {
    const q = jobs[next++];
    const { triggered, cost } = await runOnce(q.query);
    results.get(q.query).push(triggered);
    spent += cost;
  }
}));

const rows = queries.map((q) => {
  const runs = results.get(q.query);
  const rate = runs.filter(Boolean).length / runs.length;
  return { ...q, rate, ok: q.should_trigger ? rate >= 0.5 : rate < 0.5 };
});
writeFileSync(join(outDir, `results-${values.split}-${values.model}.json`), JSON.stringify(rows, null, 2));
for (const split of ['train', 'test']) {
  const part = rows.filter((r) => r.split === split);
  if (part.length) console.log(`${split}: ${part.filter((r) => r.ok).length}/${part.length} correct`);
}
for (const r of rows.filter((x) => !x.ok)) console.log(`  WRONG (${r.should_trigger ? 'should fire' : 'should stay quiet'}, fired ${Math.round(r.rate * 100)}%) [${r.split}] ${r.query.slice(0, 120).replace(/\n/g, ' ')}`);
console.log(`Known-cost spend: $${spent.toFixed(2)} (sessions stopped early don't report a cost)`);
