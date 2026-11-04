#!/usr/bin/env node
// Prints one iteration's results: a line per case and setup, with every failed check under it.
// Usage: node evals/summary.mjs --iteration 1 [--case name] [--failures-only]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WORKSPACE } from './common.mjs';

const { values } = parseArgs({ options: { iteration: { type: 'string', default: '1' }, case: { type: 'string' }, 'failures-only': { type: 'boolean' } } });
const dir = join(WORKSPACE, `iteration-${values.iteration}`);
const totals = {};
for (const evalName of readdirSync(dir).filter((d) => d.startsWith('eval-')).sort()) {
  if (values.case && evalName !== `eval-${values.case}`) continue;
  for (const config of ['with_skill', 'without_skill']) {
    const configDir = join(dir, evalName, config);
    if (!existsSync(configDir)) continue;
    for (const run of readdirSync(configDir).filter((d) => d.startsWith('run-'))) {
      const gradingPath = join(configDir, run, 'grading.json');
      if (!existsSync(gradingPath)) continue;
      const g = JSON.parse(readFileSync(gradingPath, 'utf8'));
      const t = existsSync(join(configDir, run, 'timing.json')) ? JSON.parse(readFileSync(join(configDir, run, 'timing.json'), 'utf8')) : {};
      const total = (totals[config] ||= { passed: 0, total: 0, seconds: 0, cost: 0, runs: 0 });
      total.passed += g.summary.passed; total.total += g.summary.total; total.seconds += t.total_duration_seconds || 0; total.cost += t.cost_usd || 0; total.runs += 1;
      const failed = g.expectations.filter((e) => !e.passed);
      if (values['failures-only'] && failed.length === 0) continue;
      console.log(`${evalName.slice(5).padEnd(30)} ${config.padEnd(14)} ${`${g.summary.passed}/${g.summary.total}`.padEnd(6)} ${String(Math.round(t.total_duration_seconds || 0)).padStart(5)}s  $${(t.cost_usd || 0).toFixed(2)}`);
      for (const f of failed) console.log(`    FAIL ${f.text}\n         ${f.evidence.slice(0, 200)}`);
    }
  }
}
console.log('');
for (const [config, t] of Object.entries(totals)) {
  console.log(`${config.padEnd(14)} ${t.passed}/${t.total} checks (${t.total ? Math.round((100 * t.passed) / t.total) : 0}%), ${t.runs} runs, ${Math.round(t.seconds / 60)} min, $${t.cost.toFixed(2)}`);
}
