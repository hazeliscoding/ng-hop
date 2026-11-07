// The agent's login must reach the agent and nothing else, because evals install real npm packages. These prove the
// checks fail on what they exist to catch, using a fake token and a fake `claude`, with no model involved.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EVALS = fileURLToPath(new URL('../evals/', import.meta.url));
const COMMON = pathToFileURL(join(EVALS, 'common.mjs')).href;
const PROBE = join(EVALS, 'probe.mjs');
const CANARY = join(EVALS, 'canary.mjs');
const WORKFLOW = readFileSync(fileURLToPath(new URL('../.github/workflows/evals.yml', import.meta.url)), 'utf8');
const MACHINE = readFileSync(fileURLToPath(new URL('../.github/actions/eval-machine/action.yml', import.meta.url)), 'utf8');
const TOKEN = 'sk-ant-oat01-not-a-real-token';

const made = [];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'ng-hop-login-')); made.push(dir); return dir; };

// Everything that names the login removed and an empty home, so the machine running these tests can't change the answer.
const emptyHome = tempDir();
function cleanEnv(extra = {}) {
  const env = { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome, ...extra };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'NG_HOP_LOGIN_ON_STDIN']) if (!(name in extra)) delete env[name];
  if (!('CLAUDE_CODE_OAUTH_TOKEN' in extra)) delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

const runModule = (source, options) => spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', ...options });
const probe = (env) => spawnSync(process.execPath, [PROBE], { encoding: 'utf8', env });

// Stands in for Claude Code: takes the login the way the real one does, and can run an install as its Bash tool would.
function fakeClaude(behaviour) {
  const dir = tempDir();
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/usr/bin/env node
const fs = require('node:fs');
const fd = process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR;
const viaDescriptor = fd ? fs.readFileSync(Number(fd), 'utf8').trim() : null;
delete process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR;
${behaviour}
console.log(JSON.stringify({ result: 'done', viaDescriptor, inEnvironment: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null, args: process.argv.slice(2) }));
`);
  chmodSync(path, 0o755);
  return `${dir}${delimiter}${process.env.PATH}`;
}
const RUN_INSTALL = "require('node:child_process').execSync('npm install --no-audit --no-fund', { stdio: 'ignore' });";

function runAgent(env, input) {
  return runModule(`
    import { spawnAgent } from ${JSON.stringify(COMMON)};
    const child = spawnAgent(['-p', 'hello'], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.pipe(process.stdout);
  `, { env, input });
}

test('the harness takes the login out of its own environment before anything can install', () => {
  const result = runModule(`
    import ${JSON.stringify(COMMON)};
    console.log(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? 'gone', process.env.ANTHROPIC_API_KEY ?? 'gone');
  `, { env: cleanEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, ANTHROPIC_API_KEY: TOKEN }) });
  assert.equal(result.stdout.trim(), 'gone gone', result.stderr);
});

test('a login passed in the environment still reaches the agent', { skip: process.platform === 'win32' }, () => {
  const result = runAgent(cleanEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, PATH: fakeClaude('') }));
  assert.equal(JSON.parse(result.stdout).inEnvironment, TOKEN, result.stderr);
});

test('a login on stdin reaches the agent over a descriptor, and never in its environment', { skip: process.platform === 'win32' }, () => {
  const result = runAgent(cleanEnv({ NG_HOP_LOGIN_ON_STDIN: '1', PATH: fakeClaude('') }), TOKEN);
  const seen = JSON.parse(result.stdout);
  assert.equal(seen.viaDescriptor, TOKEN, result.stderr);
  assert.equal(seen.inEnvironment, null);
});

test('an empty login on stdin stops the harness and says which secret to add', () => {
  const result = runModule(`import ${JSON.stringify(COMMON)};`, { env: cleanEnv({ NG_HOP_LOGIN_ON_STDIN: '1' }), input: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CLAUDE_CODE_OAUTH_TOKEN repository secret/);
});

test('every harness script starts the agent through the one place that handles the login, with no settings it could be redirected by', () => {
  for (const script of ['run.mjs', 'trigger.mjs', 'canary.mjs']) {
    const source = readFileSync(join(EVALS, script), 'utf8');
    assert.match(source, /spawnAgent\(/, script);
    assert.doesNotMatch(source, /spawn\('claude'/, script);
    assert.match(source, /'--setting-sources', ''/, script);
  }
});

test('a login on stdin leaves out any login in the environment too', { skip: process.platform === 'win32' }, () => {
  const result = runAgent(cleanEnv({ NG_HOP_LOGIN_ON_STDIN: '1', ANTHROPIC_API_KEY: TOKEN, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-another-fake-token', PATH: fakeClaude('') }), TOKEN);
  const seen = JSON.parse(result.stdout);
  assert.equal(seen.viaDescriptor, TOKEN, result.stderr);
  assert.equal(seen.inEnvironment, null);
});

test('the probe finds a login in its own environment, and names it without printing it', () => {
  const result = probe(cleanEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }));
  assert.match(result.stdout, /own environment: CLAUDE_CODE_OAUTH_TOKEN/);
  assert.ok(!result.stdout.includes(TOKEN));
  assert.equal(result.status, 1);
});

test('the probe finds a token by its shape under any name', () => {
  assert.match(probe(cleanEnv({ SOME_SETTING: TOKEN })).stdout, /own environment: SOME_SETTING/);
});

test('the probe stays quiet about an environment with no login in it', () => {
  assert.doesNotMatch(probe(cleanEnv()).stdout, /own environment/);
});

test('the probe finds a token left in the agent\'s settings', () => {
  const home = tempDir();
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'state.json'), JSON.stringify({ saved: TOKEN }));
  const result = probe(cleanEnv({ HOME: home, USERPROFILE: home }));
  assert.match(result.stdout, /state\.json/);
  assert.ok(!result.stdout.includes(TOKEN));
});

test('the probe really does try to redirect the agent, so a clean canary means something', () => {
  const dir = tempDir();
  const url = 'http://127.0.0.1:9/';
  const home = tempDir();
  const report = join(dir, 'report.json');
  spawnSync(process.execPath, [PROBE, report, url], { cwd: dir, env: cleanEnv({ HOME: home, USERPROFILE: home }) });
  for (const file of [join(dir, '.claude', 'settings.json'), join(dir, '.claude', 'settings.local.json'), join(dir, '.env'), join(home, '.claude.json'), join(home, '.claude', 'settings.json')]) {
    assert.ok(readFileSync(file, 'utf8').includes(url), file);
  }
  assert.ok(Array.isArray(JSON.parse(readFileSync(report, 'utf8')).found));
});

test('the probe says when the agent\'s config or the harness can be changed', { skip: process.platform !== 'linux' }, () => {
  const home = tempDir();
  const { stdout } = probe(cleanEnv({ HOME: home }));
  assert.match(stdout, /\.claude\.json can be changed/);
  assert.match(stdout, /the harness can be changed/);
});

test('the probe finds a login in another process\'s environment, the hole a deleted variable leaves', { skip: process.platform !== 'linux' }, async () => {
  const sleep = (env) => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { env, stdio: 'ignore' });
  const holding = sleep(cleanEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }));
  const clean = sleep(cleanEnv());
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { stdout } = probe(cleanEnv());
    assert.ok(stdout.includes(`/proc/${holding.pid}/environ`), stdout);
    assert.ok(!stdout.includes(`/proc/${clean.pid}/environ`), stdout);
  } finally {
    holding.kill();
    clean.kill();
  }
});

const canary = (env, input) => spawnSync(process.execPath, [CANARY], { encoding: 'utf8', env, input });

test('the canary fails when a login in the environment is visible to an install script', { skip: process.platform === 'win32' }, () => {
  const result = canary(cleanEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, PATH: fakeClaude(RUN_INSTALL) }));
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /the agent: own environment: CLAUDE_CODE_OAUTH_TOKEN/);
  assert.ok(!(result.stdout + result.stderr).includes(TOKEN));
});

test('the canary fails when the agent never ran the install, instead of calling that clean', { skip: process.platform === 'win32' }, () => {
  const result = canary(cleanEnv({ NG_HOP_LOGIN_ON_STDIN: '1', PATH: fakeClaude('') }), TOKEN);
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /the agent: the install script never ran/);
  assert.match(output, new RegExp(`The login: ${TOKEN.length} characters, no whitespace, starts like a setup token`));
  assert.ok(!output.includes(TOKEN), 'describing the login must never print it');
});

test('the canary finds no login when it comes in on stdin', { skip: process.platform === 'win32' }, () => {
  const result = canary(cleanEnv({ NG_HOP_LOGIN_ON_STDIN: '1', PATH: fakeClaude(RUN_INSTALL) }), TOKEN);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /own environment|never ran/);
  // Linux runners really do have sudo, so that part only passes on the machine the workflow sets up.
  if (process.platform === 'darwin') assert.equal(result.status, 0, output);
});

test('evals only run when someone starts them, and only the jobs that need the login name it', () => {
  const triggers = /^on:\n([\s\S]*?)^permissions:/m.exec(WORKFLOW)[1];
  assert.match(triggers, /workflow_dispatch/);
  assert.doesNotMatch(triggers, /^\s{2}(push|pull_request|pull_request_target|schedule):/m);

  const jobs = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:'));
  const job = (name) => new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  \\w+:\\n|$(?![\\s\\S]))`, 'm').exec(jobs)[0];
  for (const name of ['prepare', 'report']) assert.doesNotMatch(job(name), /secrets\./, name);
  for (const name of ['canary', 'run', 'triggers']) assert.match(job(name), /secrets\.CLAUDE_CODE_OAUTH_TOKEN/, name);
  // Agent output isn't masked the way the secret is, and this job has no collect step to check it.
  assert.doesNotMatch(job('triggers'), /upload-artifact/);
});

test('the workflow never puts the login in the environment of anything it starts', () => {
  assert.doesNotMatch(WORKFLOW, /--preserve-env|sudo -E/);
  assert.doesNotMatch(WORKFLOW, /CLAUDE_CODE_OAUTH_TOKEN:/, 'the secret goes into a step as LOGIN, and out on stdin');
  for (const line of WORKFLOW.split('\n').filter((l) => /\bLOGIN\b/.test(l) && /as-evals/.test(l))) {
    assert.match(line, /printf '%s' "\$LOGIN" \| as-evals/, line);
  }
  const checkouts = WORKFLOW.match(/uses: actions\/checkout@/g).length;
  assert.equal(WORKFLOW.match(/persist-credentials: false/g).length, checkouts);
  for (const file of [WORKFLOW, MACHINE]) assert.doesNotMatch(file, /uses: [^./][^@\n]*@(?![0-9a-f]{40})/, 'a job holding the login pins its actions by commit');
});

test('nothing with sudo or the login runs git on results, follows a link out of them, or publishes a .git', () => {
  const collect = /name: Collect the results[\s\S]*?(?=\n      - uses:)/.exec(WORKFLOW)[0];
  assert.doesNotMatch(collect, /(^|[\s;|(])git /m, 'a .git an install script wrote can run commands in whatever runs git on it');
  assert.match(collect, /-name \.git/);
  assert.match(collect, /-not -type f -not -type d -delete/);
  const removeLinks = collect.indexOf('-not -type f -not -type d -delete');
  assert.ok(removeLinks < collect.indexOf('sudo cp -r'), 'links go before anything copies or uploads');
});

test('grading needs no live repository', () => {
  const grader = readFileSync(join(EVALS, 'grade.mjs'), 'utf8');
  assert.doesNotMatch(grader, /git diff/);
});

test('agents run as a user with no sudo, in an environment with nothing of the runner\'s', () => {
  assert.match(MACHINE, /useradd --create-home evals/);
  assert.match(MACHINE, /exec sudo -u evals -H env -i /);
  assert.doesNotMatch(MACHINE, /usermod|gpasswd|sudoers/, 'the evals user gets no extra rights');
  assert.match(MACHINE, /chown -R root: \/opt\/ng-hop/, 'an install script must not be able to change the harness or the skill');
  assert.doesNotMatch(MACHINE, /\/home\/evals\/ng-hop/, 'the owner of a folder can rename what is in it, whoever owns that');
  assert.match(MACHINE, /chattr \+i \/home\/evals\/\.claude\.json/, 'an env block in this file redirects the agent');
  // The scrub forces the permission mode to default, so these runs would stop matching local ones.
  assert.match(MACHINE, /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0/);
  // pnpm refuses to change a lockfile when it sees CI, which is not what happens on someone's machine.
  assert.doesNotMatch(MACHINE, /\bCI=/);
});
