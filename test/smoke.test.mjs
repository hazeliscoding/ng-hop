import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { after, test } from 'node:test';
import { project, runScript, SMOKE } from './helpers/harness.mjs';

const made = [];
after(() => made.forEach((p) => p.remove()));

const CHROME = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
// A port the system says is free, since one worked out from the process id can be taken already: WSL's relay held
// 127.0.0.1:4311, and a run whose process id gave a test that port failed with EADDRINUSE.
// shortcut: another process can take the port in the moment between this and the stand-in server listening on it; if
// that shows up, have smoke.mjs take --port 0 and report the port the server got.
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// A stand-in for the Angular CLI, so the script's real process handling runs in seconds.
function fakeApp(cliBody, { index = '<html><body><app-root></app-root></body></html>' } = {}) {
  const cli = `const http = require('http');\nconst port = Number(process.argv[process.argv.indexOf('--port') + 1]);\n${cliBody}`;
  const p = project({ deps: { '@angular/core': '^21.0.0' }, files: { 'node_modules/@angular/cli/bin/ng.js': cli, 'src/index.html': index } });
  made.push(p);
  return p;
}
const server = (html) => `http.createServer((q, r) => { r.writeHead(200, {'content-type':'text/html'}); r.end(${JSON.stringify(html)}); }).listen(port, '127.0.0.1', () => console.log('  Local:   http://127.0.0.1:' + port + '/'));`;
const check = async (p, ...extra) => {
  const r = await runScript(SMOKE, ['--project', p.dir, '--port', String(await freePort()), '--timeout', '20', '--json', ...extra], { cwd: p.dir });
  return { code: r.code, result: JSON.parse(r.stdout || '{}'), stderr: r.stderr };
};

test('a server that starts and serves the page passes', async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root>hello</app-root></body></html>')), '--no-browser');
  assert.equal(code, 0);
  assert.equal(result.serve, 'ready');
  assert.equal(result.http, 200);
});

test('positive control: a build error from the dev server fails, even with a passing page', async () => {
  const { code, result } = await check(fakeApp("console.error('X [ERROR] Could not resolve \"marked-katex-extension\"');\nconsole.error('Application bundle generation failed.');\nsetTimeout(() => process.exit(1), 100);"), '--no-browser');
  assert.equal(code, 1);
  assert.equal(result.serve, 'failed');
  assert.match(result.serverErrors.join(), /marked-katex-extension/);
});

test('a server that dies quietly fails', async () => {
  const { code, result } = await check(fakeApp('process.exit(3);'), '--no-browser');
  assert.equal(code, 1);
  assert.equal(result.serve, 'failed');
});

test('a server that never gets ready fails on the timeout', async () => {
  const p = fakeApp("setInterval(() => {}, 1000);");
  const r = await runScript(SMOKE, ['--project', p.dir, '--port', String(await freePort()), '--timeout', '2', '--json', '--no-browser'], { cwd: p.dir });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).serve, 'timeout');
});

test('a page that answers with an error fails', async () => {
  const { code, result } = await check(fakeApp("http.createServer((q, r) => { r.writeHead(500); r.end('nope'); }).listen(port, '127.0.0.1', () => console.log('Compiled successfully.'));"), '--no-browser');
  assert.equal(code, 1);
  assert.equal(result.http, 500);
});

test('positive control: a module Vite cannot resolve on the first request fails, though the server was ready', async () => {
  // Angular 22 with ngx-markdown: the page came back, rendered nothing, and the reason was only in the server's log.
  const vite = `http.createServer((q, r) => { console.log('11:32:01 PM [vite] Pre-transform error: Failed to resolve import "marked-katex-extension" from "node_modules/.vite/deps/ngx-markdown.js". Does the file exist?'); r.writeHead(200, {'content-type':'text/html'}); r.end('<html><body><app-root></app-root></body></html>'); }).listen(port, '127.0.0.1', () => console.log('  Local:   http://127.0.0.1:' + port + '/'));`;
  const { code, result } = await check(fakeApp(vite), '--no-browser');
  assert.equal(code, 1);
  assert.equal(result.serve, 'ready');
  assert.match(result.serverErrors.join(), /Failed to resolve import "marked-katex-extension"/);
});

test('the dev server gets the port through PORT too, which Angular 22 prefers to --port', async () => {
  const angular22 = "const at = Number(process.env.PORT || port);\nhttp.createServer((q, r) => { r.writeHead(200, {'content-type':'text/html'}); r.end('<html><body><app-root>hi</app-root></body></html>'); }).listen(at, '127.0.0.1', () => console.log('  Local:   http://127.0.0.1:' + at + '/'));";
  const p = fakeApp(angular22);
  const r = await runScript(SMOKE, ['--project', p.dir, '--port', String(await freePort()), '--timeout', '20', '--json', '--no-browser'], { cwd: p.dir, env: { PORT: String(await freePort()) } });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(JSON.parse(r.stdout).http, 200);
});

test('a failed page with no error line shows the server\'s last lines instead', async () => {
  const { code, result } = await check(fakeApp("http.createServer((q, r) => { console.log('something the patterns do not know went wrong'); r.writeHead(500); r.end('nope'); }).listen(port, '127.0.0.1', () => console.log('Compiled successfully.'));"), '--no-browser');
  assert.equal(code, 1);
  assert.deepEqual(result.serverErrors, []);
  assert.match(result.serverLog.join('\n'), /something the patterns do not know went wrong/);
});

test('the text report shows the server\'s last lines when nothing matched, and where to look them up', async () => {
  const p = fakeApp("http.createServer((q, r) => { console.log('something the patterns do not know went wrong'); r.writeHead(500); r.end('nope'); }).listen(port, '127.0.0.1', () => console.log('Compiled successfully.'));");
  const r = await runScript(SMOKE, ['--project', p.dir, '--port', String(await freePort()), '--timeout', '20', '--no-browser'], { cwd: p.dir });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /server log: something the patterns do not know went wrong/);
  assert.match(r.stdout, /references\/troubleshooting\.md/);
});

test('positive control: Vite\'s Internal server error on a request fails the check', async () => {
  const vite = `http.createServer((q, r) => { console.log('[vite] Internal server error: Transform failed with 1 error'); r.writeHead(200, {'content-type':'text/html'}); r.end('<html><body><app-root>hi</app-root></body></html>'); }).listen(port, '127.0.0.1', () => console.log('  Local:   http://127.0.0.1:' + port + '/'));`;
  const { code, result } = await check(fakeApp(vite), '--no-browser');
  assert.equal(code, 1);
  assert.match(result.serverErrors.join(), /Internal server error: Transform failed/);
});

test('a project with no install says what to do', async () => {
  const p = project({ deps: { '@angular/core': '^21.0.0' } });
  made.push(p);
  const { code, result } = await check(p, '--no-browser');
  assert.equal(code, 1);
  assert.equal(result.serve, 'no-cli');
  assert.match(result.serverErrors.join(), /Install the project's dependencies/);
});

test('the server is stopped afterwards, so the port is free again', async () => {
  const p = fakeApp(server('<html><body><app-root>hello</app-root></body></html>'));
  const used = await freePort();
  const first = await runScript(SMOKE, ['--project', p.dir, '--port', String(used), '--timeout', '20', '--json', '--no-browser'], { cwd: p.dir });
  assert.equal(first.code, 0);
  await new Promise((r) => setTimeout(r, 500));
  const again = await runScript(SMOKE, ['--project', p.dir, '--port', String(used), '--timeout', '20', '--json', '--no-browser'], { cwd: p.dir });
  assert.equal(again.code, 0, again.stdout);
});

test('the text report leads with the verdict', async () => {
  const p = fakeApp(server('<html><body><app-root>hello</app-root></body></html>'));
  const r = await runScript(SMOKE, ['--project', p.dir, '--port', String(await freePort()), '--timeout', '20', '--no-browser'], { cwd: p.dir });
  assert.match(r.stdout, /^App check: PASS/);
});

test('in Chrome: an app that renders with no errors passes', { skip: !CHROME }, async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root><h1>hello</h1></app-root></body></html>')));
  assert.equal(result.browser, 'chrome');
  assert.equal(result.rendered, true);
  assert.deepEqual(result.consoleErrors, []);
  assert.equal(code, 0);
});

test('in Chrome, positive control: a thrown error fails even though the server is fine', { skip: !CHROME }, async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root><h1>hi</h1></app-root><script>throw new Error("NG0201: boom")</script></body></html>')));
  assert.equal(code, 1);
  assert.match(result.consoleErrors.join(), /boom/);
});

test('in Chrome, positive control: an empty root element fails, because the app never booted', { skip: !CHROME }, async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root></app-root></body></html>')));
  assert.equal(code, 1);
  assert.equal(result.rendered, false);
});

test('in Chrome: an Angular console.error fails', { skip: !CHROME }, async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root>hi</app-root><script>console.error("ERROR", "bad thing")</script></body></html>')));
  assert.equal(code, 1);
  assert.match(result.consoleErrors.join(), /ERROR/);
});

test('in Chrome, positive control: a plain console.error fails, which Chrome\'s own log could not tell apart', { skip: !CHROME }, async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root>hi</app-root><script>console.error("oops")</script></body></html>')));
  assert.equal(code, 1);
  assert.match(result.consoleErrors.join(), /oops/);
});

test('in Chrome: warnings and logs are not errors', { skip: !CHROME }, async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root>hi</app-root><script>console.warn("careful"); console.log("ERROR in a log line is still a log")</script></body></html>')));
  assert.deepEqual(result.consoleErrors, []);
  assert.equal(code, 0);
});

test('in Chrome, positive control: an error after the page has loaded still counts', { skip: !CHROME }, async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root>hi</app-root><script>setTimeout(() => console.error("late"), 800)</script></body></html>')));
  assert.equal(code, 1);
  assert.match(result.consoleErrors.join(), /late/);
});

test('in Chrome: an app that renders a moment after loading passes', { skip: !CHROME }, async () => {
  const { code, result } = await check(fakeApp(server('<html><body><app-root></app-root><script>setTimeout(() => { document.querySelector("app-root").innerHTML = "<h1>ready</h1>"; }, 1500)</script></body></html>')));
  assert.equal(result.rendered, true);
  assert.equal(code, 0);
});

test('in Chrome, positive control: a script that fails to load fails', { skip: !CHROME }, async () => {
  const missing = `http.createServer((q, r) => { if (q.url !== '/') { r.writeHead(404); return r.end(); } r.writeHead(200, {'content-type':'text/html'}); r.end(${JSON.stringify('<html><body><app-root>hi</app-root><script src="/main-missing.js"></script></body></html>')}); }).listen(port, '127.0.0.1', () => console.log('  Local:   http://127.0.0.1:' + port + '/'));`;
  const { code, result } = await check(fakeApp(missing));
  assert.equal(code, 1);
  assert.match(result.consoleErrors.join(), /404|main-missing|Failed to load/);
});
