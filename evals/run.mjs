#!/usr/bin/env node
// Runs eval cases in clean, headless Claude sessions, with the skill and without it, in the folder layout the
// skill-creator viewer reads. Sessions run one at a time by default because each can hold gigabytes with a real build.
// A run already finished is skipped, so an interrupted batch picks up where it stopped.
// Usage: node evals/run.mjs --iteration 1 [--case name[,name]] [--tier plan|upgrade] [--config with_skill|without_skill]
//        [--runs 1] [--model id] [--max-seconds 560]
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CASES } from './cases.mjs';
import { installCommand, PLUGIN, spawnAgent, TEMPLATES, WORKSPACE } from './common.mjs';
import { grade } from './grade.mjs';

const { values } = parseArgs({ options: {
  iteration: { type: 'string', default: '1' }, case: { type: 'string' }, tier: { type: 'string' }, config: { type: 'string' },
  runs: { type: 'string', default: '1' }, model: { type: 'string', default: 'claude-opus-5-5' }, 'max-seconds': { type: 'string' },
  'min-free-gb': { type: 'string', default: '2.5' }, 'regrade': { type: 'boolean' },
} });
const started = Date.now();
const maxMs = values['max-seconds'] ? Number(values['max-seconds']) * 1000 : Infinity;
const minFree = Number(values['min-free-gb']) * 1024 ** 3;
const iterationDir = join(WORKSPACE, `iteration-${values.iteration}`);
const wanted = values.case ? values.case.split(',') : null;
const configs = values.config ? [values.config] : ['with_skill', 'without_skill'];
const cases = CASES.filter((c) => (!wanted || wanted.includes(c.name)) && (!values.tier || c.tier === values.tier));
if (wanted) for (const w of wanted) if (!CASES.some((c) => c.name === w)) throw new Error(`No case named ${w}`);

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prepareProject(c, dir) {
  rmSync(dir, { recursive: true, force: true });
  // The whole project except what a checkout wouldn't have. Copying node_modules takes minutes on Windows with file
  // scanning, so an upgrade installs for itself, and a question doesn't need an install at all.
  cpSync(join(TEMPLATES, c.fixture), dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|dist|\.angular)$/.test(src) && !/\.ng-hop-ok$/.test(src) });
  if (c.tier !== 'plan' && !c.noInstall) sh(installCommand(dir), dir);
  if (c.patchPackage) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    c.patchPackage(pkg);
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    rmSync(join(dir, 'package-lock.json'), { force: true });
  }
  sh('git init -q -b main && git add -A && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -q -m "chore: start of the fixture app"', dir);
  if (c.setup) c.setup(dir, sh);
  return sh('git rev-parse HEAD', dir).trim();
}

function runClaude(c, config, projectDir, runDir) {
  // No setting sources, because an install script can write a settings file that sends the agent's login elsewhere.
  const args = ['-p', c.prompt, '--model', values.model, '--setting-sources', '', '--strict-mcp-config',
    '--no-session-persistence', '--permission-mode', 'auto', '--max-budget-usd', String(c.budget ?? (c.tier === 'plan' ? 2 : 12)),
    '--disallowedTools', 'Bash(git push*)', 'Bash(gh *)', 'Bash(nvm *)', 'Bash(npm install -g*)', 'Bash(npm i -g*)',
    'PowerShell(git push*)', 'PowerShell(gh *)', 'PowerShell(nvm *)', 'PowerShell(npm install -g*)', 'PowerShell(npm i -g*)',
    'PushNotification', 'RemoteTrigger', 'CronCreate', 'ScheduleWakeup',
    '--output-format', 'stream-json', '--verbose'];
  if (config === 'with_skill') args.push('--plugin-dir', PLUGIN);
  const env = { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', NG_CLI_ANALYTICS: 'false' };
  return new Promise((resolve) => {
    const out = [];
    const child = spawnAgent(args, { cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      if (process.platform === 'win32') { try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ } } else child.kill('SIGTERM');
    }, (c.timeoutMinutes ?? (c.tier === 'plan' ? 20 : 45)) * 60000);
    child.on('close', (code) => {
      clearTimeout(timer);
      writeFileSync(join(runDir, 'transcript.jsonl'), Buffer.concat(out));
      writeFileSync(join(runDir, 'stderr.txt'), stderr);
      resolve(code);
    });
  });
}

function parseTranscript(runDir) {
  const lines = readFileSync(join(runDir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const result = lines.find((l) => l.type === 'result');
  const commands = [];
  const tools = {};
  const skills = [];
  let lastText = '';
  for (const l of lines) {
    if (l.type !== 'assistant') continue;
    for (const part of l.message?.content || []) {
      if (part.type === 'text' && part.text.trim()) lastText = part.text;
      if (part.type !== 'tool_use') continue;
      tools[part.name] = (tools[part.name] || 0) + 1;
      if (part.name === 'Bash' || part.name === 'PowerShell') commands.push(part.input.command);
      if (part.name === 'Skill') skills.push(part.input.skill);
    }
  }
  return { result, commands, tools, skills, finalText: result?.result || lastText };
}

function capture(projectDir, runDir, base, parsed) {
  const outputs = join(runDir, 'outputs');
  mkdirSync(outputs, { recursive: true });
  const git = (cmd) => { try { return sh(`git ${cmd}`, projectDir); } catch (err) { return String(err.message); } };
  const facts = {
    baseCommit: base,
    commits: git(`log --reverse --format=%H%x09%s ${base}..HEAD`).trim().split('\n').filter(Boolean).map((l) => { const [sha, ...rest] = l.split('\t'); return { sha, subject: rest.join('\t') }; }),
    status: git('status --short').trim(),
    branch: git('rev-parse --abbrev-ref HEAD').trim(),
    changedFiles: git(`diff ${base} --name-only --ignore-cr-at-eol`).trim().split('\n').filter(Boolean),
  };
  for (const commit of facts.commits) {
    try {
      const pkg = JSON.parse(git(`show ${commit.sha}:package.json`));
      commit.angular = { ...pkg.devDependencies, ...pkg.dependencies }['@angular/core'];
    } catch { commit.angular = null; }
  }
  writeFileSync(join(runDir, 'facts.json'), JSON.stringify(facts, null, 2));
  writeFileSync(join(outputs, 'final-message.md'), parsed.finalText || '(no final message)');
  writeFileSync(join(outputs, 'commands.txt'), parsed.commands.join('\n---\n'));
  writeFileSync(join(outputs, 'git-log.txt'), git(`log --stat --format=%n%h%x20%s ${base}..HEAD`));
  writeFileSync(join(outputs, 'working-tree.txt'), facts.status || '(clean)');
  writeFileSync(join(outputs, 'diff-excluding-lockfile.patch'), git(`diff ${base} --ignore-cr-at-eol -- . ":(exclude)package-lock.json" ":(exclude)pnpm-lock.yaml"`).slice(0, 400000));
  if (existsSync(join(projectDir, 'package.json'))) copyFileSync(join(projectDir, 'package.json'), join(outputs, 'package.json'));
  return facts;
}

for (const c of cases) {
  const evalDir = join(iterationDir, `eval-${c.name}`);
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, 'eval_metadata.json'), JSON.stringify({ eval_id: CASES.indexOf(c), eval_name: c.name, prompt: c.prompt, assertions: c.assertions.map((a) => a.text) }, null, 2));
  for (const config of configs) {
    for (let run = 1; run <= Number(values.runs); run++) {
      const runDir = join(evalDir, config, `run-${run}`);
      const projectDir = join(runDir, 'project');
      if (existsSync(join(runDir, 'grading.json')) && !values.regrade) continue;
      if (Date.now() - started > maxMs) { console.log('time budget reached, stopping cleanly; run again to continue'); process.exit(0); }
      if (values.regrade) {
        if (!existsSync(join(runDir, 'transcript.jsonl'))) continue;
        const parsed = parseTranscript(runDir);
        // Results from CI come without .git: an install script could have written its config, and git would run that.
        const saved = JSON.parse(readFileSync(join(runDir, 'facts.json'), 'utf8'));
        const facts = existsSync(join(projectDir, '.git')) ? capture(projectDir, runDir, saved.baseCommit, parsed) : saved;
        const g = await grade(c, { config, facts, parsed, projectDir, runDir, verify: false });
        console.log(`${c.name} ${config}: regraded ${g.summary.passed}/${g.summary.total}`);
        continue;
      }
      while (freemem() < minFree) {
        console.log(`waiting for memory: ${(freemem() / 1024 ** 3).toFixed(1)} GB free`);
        await sleep(30000);
        if (Date.now() - started > maxMs) { console.log('time budget reached while waiting for memory'); process.exit(0); }
      }
      mkdirSync(runDir, { recursive: true });
      const base = prepareProject(c, projectDir);
      const t0 = Date.now();
      const code = await runClaude(c, config, projectDir, runDir);
      const seconds = (Date.now() - t0) / 1000;
      const parsed = parseTranscript(runDir);
      const facts = capture(projectDir, runDir, base, parsed);
      const usage = parsed.result?.usage || {};
      const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      writeFileSync(join(runDir, 'timing.json'), JSON.stringify({ total_tokens: tokens, duration_ms: Math.round(seconds * 1000), total_duration_seconds: seconds, cost_usd: parsed.result?.total_cost_usd ?? null, exit_code: code }, null, 2));
      const g = await grade(c, { config, facts, parsed, projectDir, runDir, verify: c.tier === 'upgrade' });
      const failed = g.expectations.filter((e) => !e.passed).map((e) => e.text);
      console.log(`${c.name} ${config}: ${g.summary.passed}/${g.summary.total} in ${Math.round(seconds)}s, $${(parsed.result?.total_cost_usd ?? 0).toFixed(2)}${failed.length ? `\n   failed: ${failed.join(' | ').slice(0, 700)}` : ''}`);
      // Real projects are large, and only the graded results and transcript are needed afterwards.
      if (c.tier === 'upgrade') rmSync(join(projectDir, 'node_modules'), { recursive: true, force: true });
    }
  }
}
console.log('done');
