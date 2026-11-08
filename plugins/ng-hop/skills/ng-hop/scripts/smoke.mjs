#!/usr/bin/env node
// Runs the app for real, because a passing build and passing tests can still hide an app that won't start: on one
// real upgrade `ng serve` broke while both stayed green. It starts the dev server, fetches the page, and when Chrome
// is available renders it and collects errors. Compare the result with the same check from before the upgrade.
// Exit codes: 0 the app runs, 1 it doesn't (or the check couldn't run).
// Usage: smoke.mjs [--project .] [--app <name>] [--port 4287] [--path /] [--timeout 300] [--no-browser] [--json]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const READY = /(Local:\s+https?:\/\/|Compiled successfully|Application bundle generation complete)/;
const FAILED = /(Application bundle generation failed|Failed to compile|\[ERROR\]|^\s*Error:|An unhandled exception occurred|Port \d+ is already in use)/m;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
const oneLine = (text) => String(text ?? '').split('\n')[0].trim().slice(0, 300);

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

// Chrome's DevTools protocol over --remote-debugging-pipe: Chrome reads commands on its file descriptor 3 and writes
// on 4, as JSON with a null byte after each. That needs no WebSocket and no library, works the same on every platform,
// and gives each console message its level, which Chrome's own log never recorded: a plain console.error('oops') used
// to pass, and the word ERROR in an ordinary log line used to fail.
function renderInChrome(chrome, url, selector, { waitMs = 15000, settleMs = 2000 } = {}) {
  return new Promise((done) => {
    const profile = mkdtempSync(join(tmpdir(), 'ng-hop-chrome-'));
    const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'];
    let child;
    try { child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }); } catch (err) { return done({ ran: false, reason: oneLine(err.message) }); }
    const [, , , toChrome, fromChrome] = child.stdio;
    const pending = new Map();
    const waiters = [];
    const errors = [];
    let nextId = 1;
    let buffer = '';
    let finished = false;

    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      toChrome.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
    const waitFor = (method, ms) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      waiters.push({ method, resolve: () => { clearTimeout(timer); resolve(true); } });
    });
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      const exited = new Promise((r) => { if (child.exitCode !== null) r(); else child.once('exit', r); });
      let giveUp;
      send('Browser.close').catch(() => {});
      Promise.race([exited, new Promise((r) => { giveUp = setTimeout(r, 5000); })]).then(() => {
        // Left running, the timer would hold the whole process open for its full five seconds.
        clearTimeout(giveUp);
        if (child.exitCode === null) child.kill();
        try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome can hold its profile briefly, and this is only a temp folder */ }
        done(result);
      });
    };
    const deadline = setTimeout(() => finish({ ran: false, reason: 'Chrome did not finish within 90 seconds' }), 90000);

    fromChrome.on('data', (chunk) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
        let message;
        try { message = JSON.parse(buffer.slice(0, end)); } catch { message = {}; }
        buffer = buffer.slice(end + 1);
        if (message.id && pending.has(message.id)) {
          const { resolve, reject } = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
          continue;
        }
        const params = message.params || {};
        if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(params.type)) {
          errors.push(oneLine((params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')));
        } else if (message.method === 'Runtime.exceptionThrown') {
          const details = params.exceptionDetails || {};
          errors.push(oneLine(details.exception?.description || details.text));
        } else if (message.method === 'Log.entryAdded' && params.entry?.level === 'error') {
          errors.push(oneLine(`${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`));
        }
        for (const waiter of waiters.filter((w) => w.method === message.method)) waiter.resolve();
      }
    });
    child.on('error', (err) => finish({ ran: false, reason: oneLine(err.message) }));
    child.on('exit', () => finish({ ran: false, reason: 'Chrome exited before the page was checked' }));

    (async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await Promise.all(['Runtime.enable', 'Log.enable', 'Page.enable'].map((method) => send(method, {}, sessionId)));
      const loaded = waitFor('Page.loadEventFired', 30000);
      await send('Page.navigate', { url }, sessionId);
      await loaded;
      // An app can render a moment after the load event, so this waits for the root to fill, then a little longer
      // for errors from its first requests.
      const measure = `(() => { const root = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.body'}; if (!root) return 0; const copy = root.cloneNode(true); copy.querySelectorAll('script').forEach((s) => s.remove()); return copy.innerHTML.replace(/<!--[\\s\\S]*?-->/g, '').trim().length; })()`;
      let rendered = false;
      for (const start = Date.now(); !rendered && Date.now() - start < waitMs;) {
        const { result } = await send('Runtime.evaluate', { expression: measure, returnByValue: true }, sessionId);
        rendered = result?.value > 0;
        if (!rendered) await new Promise((r) => setTimeout(r, 250));
      }
      await new Promise((r) => setTimeout(r, settleMs));
      finish({ ran: true, rendered, errors: [...new Set(errors)] });
    })().catch((err) => finish({ ran: false, reason: oneLine(err.message) }));
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
  // From Angular 22, @angular/build's dev server takes PORT over --port, so a PORT left in the shell would move it.
  const env = { ...process.env, NG_CLI_ANALYTICS: 'false', CI: '1', PORT: String(port) };
  const child = spawn(process.execPath, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
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

const USAGE = 'Usage: smoke.mjs [--project <dir>] [--app <name>] [--port 4287] [--path /] [--timeout 300] [--no-browser] [--json]';

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: {
      project: { type: 'string' }, app: { type: 'string' }, port: { type: 'string' }, path: { type: 'string' },
      timeout: { type: 'string' }, 'no-browser': { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean' },
    } }));
  } catch (err) {
    throw new Error(`${err.message.split('.')[0]}.\n${USAGE}`);
  }
  if (values.help) { console.log(USAGE); return; }
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
