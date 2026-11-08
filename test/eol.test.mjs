import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runScript } from './helpers/harness.mjs';

const EOL = fileURLToPath(new URL('../plugins/ng-hop/skills/ng-hop/scripts/eol.mjs', import.meta.url));
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// A repo that commits its files as given, whatever the machine's own git settings.
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ng-hop-eol-'));
  dirs.push(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString();
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(dir, name, '..'), { recursive: true }); writeFileSync(join(dir, name), text); }
  git('add', '-A');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'start');
  return { dir, git, write: (name, text) => writeFileSync(join(dir, name), text), read: (name) => readFileSync(join(dir, name), 'latin1') };
}

test('a CRLF file a migration rewrote with LF and no final newline gets both back, and only the real change is left', async () => {
  // readme-wizard commits CRLF, and Angular 22's update left package.json with LF and no final newline.
  const r = repo({ 'package.json': '{\r\n  "a": "1",\r\n  "b": "2"\r\n}\r\n' });
  r.write('package.json', '{\n  "a": "1",\n  "b": "3"\n}');
  const out = await runScript(EOL, [], { cwd: r.dir });
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /restored: package\.json/);
  assert.equal(r.read('package.json'), '{\r\n  "a": "1",\r\n  "b": "3"\r\n}\r\n');
  assert.match(r.git('diff', '--numstat'), /^1\t1\tpackage\.json$/m);
});

test('an LF file that came back with CRLF goes back to LF, from a project in a subfolder of the repo', async () => {
  const r = repo({ 'desktop/renderer/src/main.ts': 'one\ntwo\n', 'pnpm-lock.yaml': 'a: 1\n' });
  r.write('desktop/renderer/src/main.ts', 'one\r\ntwo\r\nthree\r\n');
  r.write('pnpm-lock.yaml', 'a: 2\r\n');
  const out = await runScript(EOL, ['--project', join(r.dir, 'desktop', 'renderer')], { cwd: r.dir });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(r.read('desktop/renderer/src/main.ts'), 'one\ntwo\nthree\n');
  assert.equal(r.read('pnpm-lock.yaml'), 'a: 2\n', 'a changed file above the project is the same commit, so it counts too');
});

test('new, binary and mixed files are left alone, and a file with no final newline keeps having none', async () => {
  const r = repo({ 'mixed.txt': 'a\r\nb\n', 'logo.bin': Buffer.from([1, 0, 13, 10]), 'no-end.ts': 'x\r\ny' });
  r.write('mixed.txt', 'a\nb\nc\n');
  r.write('logo.bin', Buffer.from([1, 0, 10]));
  r.write('no-end.ts', 'x\ny\nz\n');
  r.write('new.ts', 'n\r\n');
  const out = await runScript(EOL, [], { cwd: r.dir });
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /mixes line endings: mixed\.txt/);
  assert.equal(r.read('mixed.txt'), 'a\nb\nc\n');
  assert.deepEqual([...readFileSync(join(r.dir, 'logo.bin'))], [1, 0, 10]);
  assert.equal(r.read('no-end.ts'), 'x\r\ny\r\nz');
  assert.equal(r.read('new.ts'), 'n\r\n');
});

test('a tree with nothing to restore says so and changes nothing', async () => {
  const r = repo({ 'a.ts': 'a\r\n' });
  r.write('a.ts', 'b\r\n');
  const out = await runScript(EOL, [], { cwd: r.dir });
  assert.match(out.stdout, /Nothing to restore/);
  assert.equal(r.read('a.ts'), 'b\r\n');
});
