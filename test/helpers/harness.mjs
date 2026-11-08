// Runs plan.mjs as a real process against a fake npm registry, so tests cover what users run, offline.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'ng-hop', 'skills', 'ng-hop', 'scripts');
export const PLAN = join(SCRIPTS, 'plan.mjs');
export const GUIDE = join(SCRIPTS, 'guide.mjs');
export const SMOKE = join(SCRIPTS, 'smoke.mjs');
export const UPDATE = join(SCRIPTS, 'update.mjs');

// releases: { '21.0.0': { peer: '^21.0.0', at: '2026-01-01', deprecated, peers: {...}, migrations: true, license, files: { 'LICENSE.md': 'text' } } }
export function pkg(name, releases, tags = {}) {
  const versions = {};
  const time = {};
  for (const [version, r] of Object.entries(releases)) {
    const peerDependencies = { ...(r.peers || {}) };
    if (r.peer) peerDependencies['@angular/core'] = r.peer;
    versions[version] = { name, version, peerDependencies };
    if (r.deprecated) versions[version].deprecated = r.deprecated;
    if (r.migrations) versions[version]['ng-update'] = { migrations: './migrations.json' };
    if (r.engines) versions[version].engines = r.engines;
    if (r.license) versions[version].license = r.license;
    if (r.deps) versions[version].dependencies = r.deps;
    if (r.files) versions[version].files = r.files;
    if (r.at) time[version] = `${r.at}T00:00:00.000Z`;
  }
  const stable = Object.keys(releases).filter((v) => !v.includes('-'));
  return { name, versions, time, 'dist-tags': { latest: tags.latest || stable[stable.length - 1], ...tags } };
}

// Angular itself: one entry per major, with the release date and supported TypeScript and Node.
export function angular(majors = { 20: '2025-05-28', 21: '2025-11-19', 22: '2026-05-27' }) {
  const core = {};
  const compiler = {};
  for (const [major, at] of Object.entries(majors)) {
    const node = { engines: { node: '>=18.0.0' } };
    core[`${major}.0.0`] = { at, ...node, peers: { rxjs: '^6.5.3 || ^7.4.0' } };
    core[`${major}.2.0`] = { at: `${at.slice(0, 8)}28`, ...node, peers: { rxjs: '^6.5.3 || ^7.4.0' } };
    compiler[`${major}.0.0`] = { at, peers: { typescript: `>=5.${Number(major) - 12} <7` } };
    compiler[`${major}.2.0`] = { at, peers: { typescript: `>=5.${Number(major) - 12} <7` } };
  }
  return [pkg('@angular/core', core), pkg('@angular/compiler-cli', compiler)];
}

export function typescript() {
  return pkg('typescript', { '5.8.3': {}, '5.9.3': {}, '6.0.3': {} });
}

// A real .tgz, because a parser tested only against its own idea of the format proves nothing.
function tarball(files) {
  const blocks = [];
  for (const [path, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(`package/${path}`, 0, 'latin1');
    header.write('0000644\0', 100, 'latin1');
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
    header.write('        ', 148, 'latin1');
    header.write('0', 156, 'latin1');
    header.write('ustar\u000000', 257, 'latin1');
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

export async function startRegistry(packages, { requireAuth = false, failWith = null, hits = null } = {}) {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.slice(1).split('?')[0]);
    if (hits) hits.push(name);
    const download = /^-\/tarball\/(.+)\/([^/]+)$/.exec(name);
    if (download) {
      const files = byName.get(download[1])?.versions[download[2]]?.files;
      if (files === 'corrupt') { res.writeHead(200); return res.end('this is not a gzip file'); }
      if (!files) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(tarball(files));
    }
    if (failWith) { res.writeHead(failWith); return res.end('{}'); }
    if (requireAuth && !req.headers.authorization) { res.writeHead(401); return res.end('{"error":"auth required"}'); }
    const doc = byName.get(name);
    // One release's manifest, as /<name>/<version or tag>, which is how the registry serves it without the whole document.
    const slash = name.lastIndexOf('/');
    const parent = !doc && slash > 0 ? byName.get(name.slice(0, slash)) : null;
    if (parent) {
      const wanted = name.slice(slash + 1);
      const release = parent.versions[parent['dist-tags']?.[wanted] || wanted];
      if (!release) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); }
      const { files, ...manifest } = release;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...manifest, dist: { tarball: `http://127.0.0.1:${server.address().port}/-/tarball/${parent.name}/${release.version}` } }));
    }
    if (!doc) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); }
    // The abbreviated form really does drop these, so the plan is tested against the same gaps.
    const abbreviated = /install-v1/.test(req.headers.accept || '');
    let body = doc;
    if (abbreviated) {
      body = { name: doc.name, 'dist-tags': doc['dist-tags'], versions: {} };
      for (const [v, m] of Object.entries(doc.versions)) {
        body.versions[v] = { name: m.name, version: m.version, peerDependencies: m.peerDependencies, ...(m.dependencies ? { dependencies: m.dependencies } : {}), ...(m.deprecated ? { deprecated: m.deprecated } : {}), ...(m.engines ? { engines: m.engines } : {}) };
      }
    }
    if (body === doc) {
      const versions = Object.fromEntries(Object.entries(doc.versions).map(([v, { files, ...m }]) => [v, { ...m, dist: { tarball: `http://127.0.0.1:${server.address().port}/-/tarball/${doc.name}/${v}` } }]));
      body = { ...doc, versions };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

export function project({ deps = {}, devDeps = {}, lock = null, files = {}, nx = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ng-hop-test-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: deps, devDependencies: devDeps }));
  if (lock) {
    const packages = Object.fromEntries(Object.entries(lock).map(([n, version]) => [`node_modules/${n}`, { version }]));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  }
  if (nx) writeFileSync(join(dir, 'nx.json'), '{}');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export function runScript(script, args, { cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

export async function plan(packages, proj, { to, next = false, text = false, registryOptions } = {}) {
  const registry = await startRegistry(packages, registryOptions);
  try {
    const args = ['--project', proj.dir];
    if (to !== undefined) args.push('--to', String(to));
    if (next) args.push('--next');
    if (!text) args.push('--json');
    const out = await runScript(PLAN, args, { cwd: proj.dir, env: { npm_config_registry: registry.url } });
    return { ...out, plan: !text && out.stdout ? JSON.parse(out.stdout) : null };
  } finally {
    await registry.close();
  }
}
