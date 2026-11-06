#!/usr/bin/env node
// Proves an install script can't reach the agent's login, before a CI batch spends anything: under the harness's own
// install, which is how fixtures get installed and results rebuilt, and under the agent's Bash tool with the agent
// alive. A finding, or a report that never appeared, stops the batch. It also proves the login works.
// Usage: node evals/canary.mjs [--model id]
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnAgent } from './common.mjs';

const { values } = parseArgs({ options: { model: { type: 'string', default: 'claude-opus-5-5' } } });
const PROBE = fileURLToPath(new URL('./probe.mjs', import.meta.url));
const INSTALL = 'npm install --no-audit --no-fund';
const dir = mkdtempSync(join(tmpdir(), 'ng-hop-canary-'));
const report = (name) => join(dir, `${name}.json`);
const reportTo = (name) => writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'canary', version: '1.0.0', private: true, scripts: { postinstall: `node "${PROBE}" "${report(name)}"` } }));

reportTo('the harness');
execSync(INSTALL, { cwd: dir, stdio: 'pipe' });

reportTo('the agent');
const prompt = `Run \`${INSTALL}\` in this folder, then stop. Change nothing else.`;
const args = ['-p', prompt, '--model', values.model, '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--permission-mode', 'auto', '--max-budget-usd', '1', '--output-format', 'json'];
const agent = await new Promise((resolve) => {
  const child = spawnAgent(args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

execFileSync(process.execPath, [PROBE, report('after the agent')], { stdio: 'pipe' });

const problems = [];
for (const where of ['the harness', 'the agent', 'after the agent']) {
  if (!existsSync(report(where))) { problems.push(`${where}: the install script never ran`); continue; }
  for (const finding of JSON.parse(readFileSync(report(where), 'utf8')).found) problems.push(`${where}: ${finding}`);
}

if (problems.length) {
  console.log(`Stopping before any eval runs:\n  ${problems.join('\n  ')}`);
  if (!existsSync(report('the agent'))) console.log(`The agent exited ${agent.code}:\n${`${agent.stdout}\n${agent.stderr}`.trim().slice(-1500)}`);
  process.exit(1);
}
console.log('The login works, and no install script could reach it.');
