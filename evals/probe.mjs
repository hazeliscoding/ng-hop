#!/usr/bin/env node
// Looks for every way an npm install script could reach the agent's login, the way a compromised package would, and
// says where it found one without ever printing the value. With a report path it always exits 0, because a failing
// install script would change what the agent does next: canary.mjs reads the report, and treats a missing one as a failure.
// Usage: node evals/probe.mjs [report.json]
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NAMED = /^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)=./;
const SHAPED = /sk-ant-[\w-]{8,}/;
const holdsLogin = (entry) => NAMED.test(entry) || SHAPED.test(entry);
const read = (path) => { try { return readFileSync(path, 'latin1'); } catch { return null; } };
const filesIn = (path) => { try { return statSync(path).isDirectory() ? readdirSync(path, { recursive: true }).map((f) => join(path, f)) : [path]; } catch { return []; } };
// shortcut: skips big files, because a login is saved in small ones and a developer's folder can hold gigabytes.
const small = (file) => { try { return statSync(file).size < 1024 * 1024; } catch { return false; } };

const found = [];
for (const [name, value] of Object.entries(process.env)) if (holdsLogin(`${name}=${value}`)) found.push(`own environment: ${name}`);
for (const start of [join(homedir(), '.claude.json'), join(homedir(), '.claude'), '/home/claude/.claude']) {
  for (const file of filesIn(start)) if (small(file) && SHAPED.test(read(file) || '')) found.push(`saved in ${file}`);
}

if (process.platform === 'linux') {
  // A variable deleted from a process still shows here: this keeps what the process was started with.
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    if (read(`/proc/${pid}/environ`)?.split('\0').some(holdsLogin)) found.push(`/proc/${pid}/environ`);
    if (SHAPED.test(read(`/proc/${pid}/cmdline`) || '')) found.push(`/proc/${pid}/cmdline`);
  }
  // sudo or docker could read the secret straight out of the runner's memory, which is how real attacks on CI got theirs.
  if (spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status === 0) found.push('sudo works');
  if (spawnSync('docker', ['ps'], { stdio: 'ignore' }).status === 0) found.push('docker works');
  if (existsSync('/home/runner') && read('/home/runner/.bashrc') !== null) found.push("the runner's home folder is readable");
  // At 0, a process can read the memory of any other with the same user, including the agent's.
  if (!Number(read('/proc/sys/kernel/yama/ptrace_scope'))) found.push('ptrace_scope lets a process read its siblings');
}

const [report] = process.argv.slice(2);
if (report) writeFileSync(report, JSON.stringify({ found }, null, 2));
else {
  console.log(found.length ? found.join('\n') : 'nothing found');
  process.exitCode = found.length ? 1 : 0;
}
