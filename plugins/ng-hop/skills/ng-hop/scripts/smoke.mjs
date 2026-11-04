#!/usr/bin/env node
// Runs the app for real, because a passing build and passing tests can still hide an app that won't start: on one
// real upgrade `ng serve` broke while both stayed green. It starts the dev server, fetches the page, and when Chrome
// is available renders it and collects errors. Compare the result with the same check from before the upgrade.
// Exit codes: 0 the app runs, 1 it doesn't (or the check couldn't run).
// Usage: smoke.mjs [--project .] [--app <name>] [--port 4287] [--path /] [--timeout 300] [--no-browser] [--json]
import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const READY = /(Local:\s+https?:\/\/|Compiled successfully|Application bundle generation complete)/;
const FAILED = /(Application bundle generation failed|Failed to compile|\[ERROR\]|^\s*Error:|An unhandled exception occurred|Port \d+ is already in use)/m;
// shortcut: Chrome's log doesn't record a message's level, so this matches the text of Angular's error handler and of
// uncaught errors, and misses a plain console.error('oops'). Move to the DevTools protocol if that ever matters.
const CONSOLE_ERROR = /^\s*"?(ERROR\b|Uncaught|Error:|NG0\d+|Failed to load)/;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

function findChrome() {
  const paths = process.platform === 'win32'
    ? ['Program Files', 'Program Files (x86)'].map((p) => `C:\\${p}\\Google\\Chrome\\Application\\chrome.exe`)
      .concat(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')] : [])
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return [process.env.CHROME_BIN, ...paths].find((p) => p && existsSync(p)) || null;
}

function rootSelector(dir) {
  const index = join(dir, 'src', 'index.html');
  if (!existsSync(index)) return null;
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(readFileSync(index, 'utf8'));
  return /<([a-z][a-z0-9]*-[a-z0-9-]*)/i.exec(body?.[1] || '')?.[1] || null;
}

function renderInChrome(chrome, url, selector) {
  return new Promise((done) => {
    const profile = mkdtempSync(join(tmpdir(), 'ng-hop-chrome-'));
    const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${profile}`, '--enable-logging=stderr', '--virtual-time-budget=8000', '--dump-dom', url];
    execFile(chrome, args, { maxBuffer: 64 * 1024 * 1024, timeout: 90000 }, (err, stdout, stderr) => {
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome can hold its profile briefly, and this is only a temp folder */ }
      if (err && !stdout) return done({ ran: false, reason: String(err.message).split('\n')[0] });
      const errors = [];
      for (const line of stderr.split(/\r?\n/)) {
        const message = /CONSOLE[^\]]*\]\s*(.*)$/.exec(line)?.[1];
        if (message && CONSOLE_ERROR.test(message)) errors.push(message.replace(/, source:.*$/, '').slice(0, 300));
      }
      const content = selector
        ? new RegExp(`<${selector}[^>]*>([\\s\\S]*?)</${selector}>`, 'i').exec(stdout)?.[1]
        : /<body[^>]*>([\s\S]*)<\/body>/i.exec(stdout)?.[1];
      const text = (content || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '').trim();
      done({ ran: true, rendered: text.length > 0, errors: [...new Set(errors)] });
    });
  });
}

function stopTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } }
}

function startServer(dir, { app, port, timeoutMs }) {
  const ng = join(dir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  if (!existsSync(ng)) return Promise.resolve({ state: 'no-cli', log: `No Angular CLI at ${ng}. Install the project's dependencies first.` });
  const args = [ng, 'serve', ...(app ? [app] : []), '--port', String(port), '--host', '127.0.0.1'];
  const child = spawn(process.execPath, args, { cwd: dir, env: { ...process.env, NG_CLI_ANALYTICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let log = '';
  return new Promise((done) => {
    let finished = false;
    const finish = (state) => { if (finished) return; finished = true; clearTimeout(timer); done({ state, log: stripAnsi(log), child }); };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    const onData = (chunk) => {
      log += chunk;
      const clean = stripAnsi(log);
      if (FAILED.test(clean)) { setTimeout(() => finish('failed'), 500); return; }
      if (READY.test(clean)) finish('ready');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => finish(code === 0 ? 'exited' : 'failed'));
    child.on('error', (err) => { log += String(err); finish('failed'); });
  });
}

async function fetchPage(url) {
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res = await fetch(url);
      return { status: res.status, body: await res.text() };
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return { status: null, error: last?.cause?.code || last?.message };
}

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, app: { type: 'string' }, port: { type: 'string' }, path: { type: 'string' },
    timeout: { type: 'string' }, 'no-browser': { type: 'boolean' }, json: { type: 'boolean' },
  } });
  const dir = resolve(values.project || '.');
  const port = Number(values.port || 4287);
  const path = values.path || '/';
  const result = { ok: false, serve: 'not started', http: null, browser: 'not run', rendered: null, consoleErrors: [], serverErrors: [] };

  const server = await startServer(dir, { app: values.app, port, timeoutMs: Number(values.timeout || 300) * 1000 });
  result.serve = server.state;
  if (server.state !== 'ready') {
    result.serverErrors = server.log.split('\n').filter((l) => /error|cannot|failed|could not/i.test(l)).slice(0, 15).map((l) => l.trim().slice(0, 300));
    if (!result.serverErrors.length) result.serverErrors = [server.log.trim().slice(-400)];
  } else {
    try {
      const url = `http://127.0.0.1:${port}${path}`;
      const page = await fetchPage(url);
      result.http = page.status;
      const chrome = values['no-browser'] ? null : findChrome();
      if (values['no-browser']) result.browser = 'skipped';
      else if (!chrome) result.browser = 'no Chrome found, so only the server and the page fetch were checked';
      else {
        const render = await renderInChrome(chrome, url, rootSelector(dir));
        result.browser = render.ran ? 'chrome' : `could not run: ${render.reason}`;
        if (render.ran) { result.rendered = render.rendered; result.consoleErrors = render.errors; }
      }
      result.ok = page.status === 200 && result.rendered !== false && result.consoleErrors.length === 0;
    } finally {
      // The server writes errors after startup too, such as a module it can't resolve on first request.
      const late = stripAnsi(server.log);
      if (FAILED.test(late)) result.serverErrors = late.split('\n').filter((l) => FAILED.test(l)).slice(0, 15).map((l) => l.trim().slice(0, 300));
    }
  }
  if (result.serverErrors.length) result.ok = false;
  if (server.child) stopTree(server.child);

  if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    const lines = [`App check: ${result.ok ? 'PASS' : 'FAIL'}`, `  dev server: ${result.serve}`, `  page fetch: ${result.http ?? 'not reached'}`, `  browser: ${result.browser}${result.rendered === null ? '' : `, rendered ${result.rendered ? 'content' : 'NOTHING'}`}`];
    for (const e of result.serverErrors) lines.push(`  server error: ${e}`);
    for (const e of result.consoleErrors) lines.push(`  console error: ${e}`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
