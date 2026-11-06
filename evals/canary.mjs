#!/usr/bin/env node
// Proves an install script can't get the agent's login, before a CI batch spends anything: under the harness's own
// install, which is how fixtures get installed and results rebuilt, and under the agent's Bash tool with the agent
// alive. The script tries to read the login, and tries to point the agent at a server here that counts its requests. A
// finding, a request, or a report that never appeared stops the batch. A clean pass also proves the login works.
// Usage: node evals/canary.mjs [--model id]
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { describeLogin, spawnAgent } from './common.mjs';

const { values } = parseArgs({ options: { model: { type: 'string', default: 'claude-opus-5-5' } } });
const PROBE = fileURLToPath(new URL('./probe.mjs', import.meta.url));
const INSTALL = 'npm install --no-audit --no-fund';
const AGENT_LIMIT_MS = 5 * 60000;

// Reads nothing from a request, so a login sent here goes no further than this process's memory.
let redirected = 0;
const server = createServer((req, res) => { redirected += 1; res.writeHead(401).end(); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirectTo = `http://127.0.0.1:${server.address().port}`;

const dir = mkdtempSync(join(tmpdir(), 'ng-hop-canary-'));
const report = (name) => join(dir, `${name}.json`);
const reportTo = (name) => writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'canary', version: '1.0.0', private: true, scripts: { postinstall: `node "${PROBE}" "${report(name)}" ${redirectTo}` } }));

reportTo('the harness');
execSync(INSTALL, { cwd: dir, stdio: 'pipe' });

reportTo('the agent');
const prompt = `Run \`${INSTALL}\` in this folder, then stop. Change nothing else.`;
const args = ['-p', prompt, '--model', values.model, '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--permission-mode', 'auto', '--max-budget-usd', '1', '--output-format', 'json'];
const agent = await new Promise((resolve) => {
  const child = spawnAgent(args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), AGENT_LIMIT_MS);
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
});

execFileSync(process.execPath, [PROBE, report('after the agent')], { cwd: dir, stdio: 'pipe' });
server.close();

const problems = [];
if (redirected) problems.push(`the agent sent ${redirected} request(s) to a server an install script chose`);
for (const where of ['the harness', 'the agent', 'after the agent']) {
  if (!existsSync(report(where))) { problems.push(`${where}: the install script never ran`); continue; }
  for (const finding of JSON.parse(readFileSync(report(where), 'utf8')).found) problems.push(`${where}: ${finding}`);
}

if (problems.length) {
  console.log(`Stopping before any eval runs:\n  ${problems.join('\n  ')}`);
  if (!existsSync(report('the agent'))) console.log(`The login: ${describeLogin()}.\nThe agent exited ${agent.code}:\n${`${agent.stdout}\n${agent.stderr}`.trim().slice(-1500)}`);
  process.exit(1);
}
console.log('The login works, and no install script could get it or redirect the agent.');
process.exit(0);
