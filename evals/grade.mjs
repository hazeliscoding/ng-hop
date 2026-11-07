// Grades one run. Everything here comes from the transcript's commands, the git history and a fresh rebuild of the
// result, because an agent's own account of its work is exactly what an eval can't take on trust.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installCommand, PLUGIN, testCommand } from './common.mjs';

const SMOKE = join(PLUGIN, 'skills', 'ng-hop', 'scripts', 'smoke.mjs');
const env = { ...process.env, NG_CLI_ANALYTICS: 'false', CHROME_BIN: process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '') };

function attempt(cmd, cwd, timeout = 600000) {
  try {
    const out = execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8', timeout, env });
    return { ok: true, out };
  } catch (err) {
    const text = `${err.stdout || ''}\n${err.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = text.split(/\r?\n/).filter((l) => /error|ERR!|failed|FAILED|TS\d+|Cannot|Could not/i.test(l)).slice(0, 6);
    return { ok: false, out: (lines.join(' | ') || text.slice(-300) || err.message).slice(0, 500) };
  }
}

// Reinstalls from the lockfile with peer checks on, then builds, tests and runs what the agent left behind.
function verifyResult(projectDir) {
  const result = {};
  rmSync(join(projectDir, 'node_modules'), { recursive: true, force: true });
  result.install = attempt(installCommand(projectDir), projectDir);
  if (!result.install.ok) return { ...result, build: { ok: false, out: 'skipped: install failed' }, test: { ok: false, out: 'skipped: install failed' }, smoke: { ok: false, out: 'skipped: install failed' } };
  result.build = attempt('npx ng build', projectDir);
  result.test = attempt(testCommand(projectDir), projectDir);
  const smoke = attempt(`node "${SMOKE}" --port ${4500 + (process.pid % 400)}`, projectDir, 420000);
  result.smoke = { ok: smoke.ok, out: smoke.out.slice(0, 500) };
  return result;
}

export async function grade(c, { config, facts, parsed, projectDir, runDir, verify }) {
  const pkgPath = join(projectDir, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
  const verifiedPath = join(runDir, 'verification.json');
  let verification = existsSync(verifiedPath) ? JSON.parse(readFileSync(verifiedPath, 'utf8')) : null;
  if (verify) {
    verification = verifyResult(projectDir);
    writeFileSync(verifiedPath, JSON.stringify(verification, null, 2));
  }
  const ctx = {
    ...parsed, facts, pkg, deps: { ...pkg?.devDependencies, ...pkg?.dependencies },
    exists: (p) => existsSync(join(projectDir, p)),
    read: (p) => { const f = join(projectDir, p); return existsSync(f) ? readFileSync(f, 'utf8') : null; },
    major: (v) => { const m = /(\d+)/.exec(String(v ?? '')); return m ? Number(m[1]) : null; },
    around: (m) => m.input.slice(Math.max(0, m.index - 30), m.index + Math.min(m[0].length, 140) + 30).replace(/\s+/g, ' ').trim(),
    changedFiles: (suffix) => (facts.changedFiles || []).filter((f) => f.endsWith(suffix)).join('\n'),
    verified: (step) => {
      const v = verification?.[step];
      if (!v) return [false, 'Not verified'];
      if (v.out?.startsWith('skipped:')) return [null, v.out];
      return [v.ok, v.ok ? 'Passed when the grader ran it' : `Failed: ${v.out}`];
    },
  };
  const expectations = [];
  for (const a of c.assertions) {
    if (a.skillOnly && config !== 'with_skill') continue;
    let passed = false;
    let evidence;
    try { [passed, evidence] = a.run(ctx); } catch (err) { evidence = `Grader error: ${err.message}`; }
    // A check that couldn't run says nothing about the result, and the failure that stopped it is already counted.
    if (passed === null) continue;
    expectations.push({ text: a.text, passed: Boolean(passed), evidence: String(evidence) });
  }
  const passedCount = expectations.filter((e) => e.passed).length;
  const grading = {
    expectations,
    summary: { passed: passedCount, failed: expectations.length - passedCount, total: expectations.length, pass_rate: expectations.length ? Number((passedCount / expectations.length).toFixed(2)) : 0 },
    execution_metrics: {
      tool_calls: parsed.tools,
      total_tool_calls: Object.values(parsed.tools).reduce((a, b) => a + b, 0),
      total_steps: parsed.result?.num_turns ?? 0,
      errors_encountered: parsed.result?.is_error ? 1 : 0,
      output_chars: (parsed.finalText || '').length,
      transcript_chars: 0,
    },
  };
  writeFileSync(join(runDir, 'grading.json'), JSON.stringify(grading, null, 2));
  return grading;
}
