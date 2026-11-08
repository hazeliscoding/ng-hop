#!/usr/bin/env node
// Read-only upgrade plan: how far can this Angular app go today, and what is in the way?
// It reads package.json, the lockfile and npm, and never changes the project.
// Exit codes: 0 the target is reachable (or nothing to do), 2 blocked before the target, 1 could not plan.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const semver = createRequire(import.meta.url)('./vendor/semver.cjs');
const exec = promisify(execFile);

// Moved by `ng update @angular/core @angular/cli` through their package groups, so never planned one by one.
const FRAMEWORK = new Set([
  '@angular/animations', '@angular/build', '@angular/cli', '@angular/common', '@angular/compiler',
  '@angular/compiler-cli', '@angular/core', '@angular/elements', '@angular/forms', '@angular/language-service',
  '@angular/localize', '@angular/platform-browser', '@angular/platform-browser-dynamic', '@angular/platform-server',
  '@angular/pwa', '@angular/router', '@angular/service-worker', '@angular/ssr', '@angular/upgrade',
  '@ngtools/webpack', '@schematics/angular',
]);
const isFramework = (name) => FRAMEWORK.has(name) || name.startsWith('@angular-devkit/');

// These declare no Angular peer at all, but their major always follows Angular's.
const ALIGNED = /^(@angular-eslint\/|angular-eslint$)/;
// Peers shared by every Angular app. Other peers only matter when the project declares them.
const SHARED_ALWAYS = new Set(['typescript', 'rxjs']);
const LOOKS_ANGULAR = /(^|[-/@])(angular|ng|ngx|ng2)([-/]|$)/i;
const CONCURRENCY = 8;
// package.json is untrusted input: a name that isn't a real npm name goes nowhere near a URL or a command.
const VALID_NAME = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

const stableOnly = (versions) => versions.filter((v) => semver.valid(v) && !semver.prerelease(v));
const newestFirst = (versions) => [...versions].sort(semver.rcompare);
const day = (iso) => (iso || '').slice(0, 10) || null;
const quotePath = (value) => process.platform === 'win32' ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;

class PlanError extends Error {}

// --no-install because npm has an unrelated package named `ng`: plain `npx ng` would download and run it whenever the
// project's CLI isn't installed. pnpm exec and yarn only run what's installed already.
const runnerFor = (project) => ({ npm: 'npx --no-install', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx --no-install' }[project.packageManager] || 'npx --no-install');
// The runner keeps the target CLI in control. On pnpm, the app's old CLI would dirty the lockfile installing a temporary
// one, and on yarn 4 that install stopped with no error.
const updateScript = () => quotePath(fileURLToPath(new URL('./update.mjs', import.meta.url)));
const updateCommand = (project) => (project.packageManager === 'pnpm' ? `pnpm exec node ${updateScript()}`
  : project.packageManager === 'yarn' ? `node ${updateScript()}`
  : `${runnerFor(project)} ng update`);

// Runs npm with no shell. On Windows npm is a .cmd file, which Node only starts through a shell, and a shell would
// read `>=` in a version range as a redirect, so this calls npm's own script with Node instead.
function runNpm(args, options) {
  if (process.platform !== 'win32') return exec('npm', args, options);
  const script = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    .find((path) => path && /npm-cli\.c?js$/.test(path) && existsSync(path));
  if (!script) throw new PlanError('Could not find npm next to Node, and the plan needs it to read the registry settings.');
  return exec(process.execPath, [script, ...args], options);
}

// ---- Registry access ------------------------------------------------------------------------------------------

function registryClient(config, cwd) {
  const cache = new Map();
  const baseFor = (name) => {
    const scope = name.startsWith('@') ? name.split('/')[0] : null;
    const url = (scope && config[`${scope}:registry`]) || config.registry || 'https://registry.npmjs.org/';
    return url.endsWith('/') ? url : `${url}/`;
  };

  // npm holds any private-registry credentials, so an auth failure on the direct path falls back to it.
  async function viaNpm(name) {
    try {
      const { stdout } = await runNpm(['view', `${name}@>=0.0.0-0`, '--json'], { cwd, maxBuffer: 512 * 1024 * 1024 });
      const docs = [].concat(JSON.parse(stdout));
      const versions = Object.fromEntries(docs.map((d) => [d.version, d]));
      return { name, versions, time: docs[0]?.time || {}, 'dist-tags': docs[0]?.['dist-tags'] || {} };
    } catch (err) {
      const text = `${err.stdout || ''}${err.message || ''}`;
      if (/E404/.test(text)) return null;
      throw new PlanError(`Could not read ${name} from the registry through npm: ${text.split('\n')[0].slice(0, 200)}`);
    }
  }

  async function viaNpmRelease(name, version) {
    try {
      const { stdout } = await runNpm(['view', `${name}@${version}`, '--json'], { cwd, maxBuffer: 64 * 1024 * 1024 });
      const found = [].concat(stdout.trim() ? JSON.parse(stdout) : []);
      return found[found.length - 1] || null;
    } catch (err) {
      const text = `${err.stdout || ''}${err.message || ''}`;
      if (/E404/.test(text)) return null;
      throw new PlanError(`Could not read ${name}@${version} from the registry through npm: ${text.split('\n')[0].slice(0, 200)}`);
    }
  }

  async function fetchOnce(url, accept, onAuthFailure) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { accept } });
        if (res.status === 404) return null;
        if (res.status === 401 || res.status === 403) return onAuthFailure();
        if (res.ok) return await res.json();
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    throw new PlanError(`Could not reach ${url}: ${lastError?.cause?.code || lastError?.message}. A plan needs the registry, so none was made.`);
  }

  const cached = (key, load) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key);
  };
  const get = (name, full = false) => cached(`${name}|${full}`, () => fetchOnce(baseFor(name) + name.replace('/', '%2F'), full ? 'application/json' : 'application/vnd.npm.install-v1+json', () => viaNpm(name)));
  // One release's manifest, a few kilobytes, where a whole document can run to megabytes.
  const release = (name, version) => cached(`${name}@${version}`, () => fetchOnce(`${baseFor(name)}${name.replace('/', '%2F')}/${encodeURIComponent(version)}`, 'application/json', () => viaNpmRelease(name, version)));
  // A scope with a registry of its own, apart from the default one, is how a company publishes its packages. A mirror
  // set as the default registry for everything says nothing about who owns a package, so only a scope's own counts.
  const own = (name) => {
    const scope = name.startsWith('@') ? name.split('/')[0] : null;
    const base = (url) => (url.endsWith('/') ? url : `${url}/`);
    const url = scope && config[`${scope}:registry`];
    return url && base(url) !== base(config.registry || 'https://registry.npmjs.org/') ? base(url) : null;
  };

  return { get, release, own };
}

async function mapLimited(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// ---- Reading the project --------------------------------------------------------------------------------------

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (err) {
    throw new PlanError(`Could not read ${path}: ${err.message}`);
  }
}

// A pnpm workspace keeps one lockfile at its root, usually above the app.
function findPnpmRoot(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return dir;
  for (let d = dirname(dir); ; d = dirname(d)) {
    if (existsSync(join(d, 'pnpm-workspace.yaml')) && existsSync(join(d, 'pnpm-lock.yaml'))) return d;
    if (dirname(d) === d) return null;
  }
}

// One app's resolved versions from pnpm-lock.yaml. It's a fixed text shape, and YAML isn't worth a dependency. A shape
// it doesn't recognise (older lockfiles) gives nothing, and the plan falls back to node_modules.
function readPnpmLock(root, dir) {
  const importer = relative(root, dir).replace(/\\/g, '/') || '.';
  const unquote = (text) => text.replace(/^['"]|['"]$/g, '');
  const versions = {};
  let inImporters = false;
  let inApp = false;
  let name = null;
  for (const line of readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(line)) { inImporters = line === 'importers:'; inApp = false; continue; }
    if (!inImporters) continue;
    const key = /^ {2}(\S.*?):( \{\})?$/.exec(line);
    if (key) { inApp = unquote(key[1]) === importer; continue; }
    if (!inApp) continue;
    const dep = /^ {6}(\S.*?):$/.exec(line);
    if (dep) { name = unquote(dep[1]); continue; }
    const version = /^ {8}version: (\S+)/.exec(line);
    // The suffix records peers, as in 20.3.35(rxjs@7.8.2).
    if (version && name) versions[name] = unquote(version[1]).split('(')[0];
  }
  return versions;
}

// Other projects in the workspace whose entries for these packages say `catalog:`, from the lockfile's importers.
function catalogUsers(root, dir, names) {
  const own = relative(root, dir).replace(/\\/g, '/') || '.';
  const unquote = (text) => text.replace(/^['"]|['"]$/g, '');
  const users = new Set();
  let inImporters = false, importer = null, name = null;
  for (const line of readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(line)) { inImporters = line === 'importers:'; continue; }
    if (!inImporters) continue;
    const key = /^ {2}(\S.*?):( \{\})?$/.exec(line);
    if (key) { importer = unquote(key[1]); continue; }
    const dep = /^ {6}(\S.*?):$/.exec(line);
    if (dep) { name = unquote(dep[1]); continue; }
    if (importer !== own && names.includes(name) && /^ {8}specifier: ['"]?catalog:/.test(line)) users.add(importer);
  }
  return [...users].sort();
}

// yarn.lock lists each version under the ranges that resolve to it, in yarn 1's format or yarn 2's, where a range
// reads "npm:^20.0.0". When a package is in the tree at more than one version, the app's own range picks the right one.
function readYarnLock(dir, deps) {
  const found = {};
  let entry = null;
  for (const line of readFileSync(join(dir, 'yarn.lock'), 'utf8').split(/\r?\n/)) {
    if (/^[^\s#].*:$/.test(line) && !line.startsWith('__metadata')) {
      entry = { version: null };
      for (const descriptor of line.slice(0, -1).split(/,\s*/).map((d) => d.replace(/^"|"$/g, ''))) {
        const at = descriptor.indexOf('@', 1);
        if (at > 0) (found[descriptor.slice(0, at)] ||= []).push({ range: descriptor.slice(at + 1).replace(/^npm:/, ''), entry });
      }
      continue;
    }
    const version = /^ {2}version:? "?([^"\s]+)"?$/.exec(line);
    if (entry && version) entry.version = version[1];
  }
  const versions = {};
  for (const [name, list] of Object.entries(found)) {
    const own = list.find((item) => item.range === deps[name]);
    const all = new Set(list.map((item) => item.entry.version));
    const version = own ? own.entry.version : all.size === 1 ? [...all][0] : null;
    if (version) versions[name] = version;
  }
  return versions;
}

// bun.lock is JSON with trailing commas. A top-level key is the hoisted copy, which is the app's own; a nested one,
// such as "some-lib/@angular/core", belongs to another package.
function readBunLock(dir) {
  try {
    const packages = JSON.parse(readFileSync(join(dir, 'bun.lock'), 'utf8').replace(/,(\s*[}\]])/g, '$1')).packages || {};
    return Object.fromEntries(Object.entries(packages)
      .filter(([key, value]) => VALID_NAME.test(key) && Array.isArray(value) && typeof value[0] === 'string')
      .map(([key, value]) => [key, value[0].slice(value[0].lastIndexOf('@') + 1)]));
  } catch {
    return {};
  }
}

// Where the repo pins the Node its team runs: version files, package.json, a dev container or Dockerfile, CI workflows.
// The upgrade passes on this machine and then fails on theirs, so each is checked against every major's Node range.
// In the enterprise run, an agent searched JSON and YAML for pins and missed the dev container's Dockerfile.
function nodePins(dir) {
  let root = dir;
  while (!existsSync(join(root, '.git')) && dirname(root) !== root) root = dirname(root);
  if (!existsSync(join(root, '.git'))) root = dir;
  const pins = [];
  const read = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
  const add = (path, value, kind = 'version') => pins.push({ file: relative(dir, path).replace(/\\/g, '/'), value: String(value).trim(), kind });
  const bases = [...new Set([dir, root])];
  for (const base of bases) {
    for (const name of ['.nvmrc', '.node-version']) { const text = read(join(base, name)); if (text?.trim()) add(join(base, name), text.trim().split('\n')[0]); }
    const tools = /^nodejs\s+(\S+)/m.exec(read(join(base, '.tool-versions')) || '');
    if (tools) add(join(base, '.tool-versions'), tools[1]);
    for (const docker of ['.devcontainer/Dockerfile', 'Dockerfile']) {
      for (const [, image] of (read(join(base, docker)) || '').matchAll(/^\s*FROM\s+(?:--\S+\s+)*(\S+)/gim)) add(join(base, docker), image, 'image');
    }
    // devcontainer.json allows comments, and a commented-out image is no pin and mustn't hide the one in use.
    const devcontainer = (read(join(base, '.devcontainer', 'devcontainer.json')) || '').replace(/^[ \t]*\/\/.*$/gm, '');
    const image = /"image"\s*:\s*"([^"]+)"/.exec(devcontainer)?.[1];
    if (image) add(join(base, '.devcontainer', 'devcontainer.json'), image, 'image');
    const feature = /features\/node:\d+"\s*:\s*\{[^}]*"version"\s*:\s*"([^"]+)"/.exec(devcontainer)?.[1];
    if (feature) add(join(base, '.devcontainer', 'devcontainer.json'), feature);
  }
  try {
    const pkg = JSON.parse(read(join(dir, 'package.json')) || '{}');
    if (pkg.engines?.node) add(join(dir, 'package.json'), pkg.engines.node, 'engines');
    if (pkg.volta?.node) add(join(dir, 'package.json'), pkg.volta.node);
  } catch { /* readProject reports a broken package.json */ }
  const workflows = join(root, '.github', 'workflows');
  for (const name of existsSync(workflows) ? readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f)) : []) {
    for (const [, value] of (read(join(workflows, name)) || '').replace(/^[ \t]*#.*$/gm, '').matchAll(/node-version:\s*([^#\n]+)/g)) {
      for (const v of value.replace(/[[\]'"]/g, '').split(',')) if (/^\s*v?\d/.test(v)) add(join(workflows, name), v);
    }
  }
  return pins;
}

// Whether a pin keeps the team on a Node the range accepts. A bare major such as "22" floats to its newest release, so
// it fits when any release of that major does; a fixed version has to be in the range itself.
function pinFits(pin, range) {
  try {
    // ">=24" allows Node 24.0, which Angular 22 refuses, so the lowest Node an engines range allows has to be accepted.
    if (pin.kind === 'engines') { const min = semver.validRange(pin.value) && semver.minVersion(pin.value); return !min || semver.satisfies(min, range); }
    // A dev container image's tag can start with the image's own version, as typescript-node:5.2-24-bookworm does, so
    // the Node in it is the two-digit major after that, and a tag that is only the image's version (5-trixie) says none.
    // shortcut: an image's own version freezes the Node inside it, so only its major is known from the tag; read the
    // image's NODE_VERSION if a frozen pin below the range's floor ever matters.
    const version = pin.kind === 'image' ? /(?:^|[/:])(?:node:|(?:typescript|javascript)-node:(?:\d+(?:\.\d+){0,2}-)?(?=[1-9]\d))(\d+(?:\.\d+){0,2})(?:[-@]|$)/.exec(pin.value)?.[1] : /^v?(\d+(?:\.\d+){0,2})(?:\.x)?$/.exec(pin.value)?.[1];
    if (!version) return true;
    const parts = version.split('.');
    const asRange = parts.length === 3 ? version : `${version}.x`;
    return semver.intersects(asRange, range);
  } catch {
    return true; // a number semver can't hold, past 2^53, says nothing about the team's Node
  }
}

// The files angular.json loads straight from node_modules, by package: the scripts and styles of every target and
// configuration. A library's new major can stop shipping one, as marked 16 did with marked.min.js, and until now only
// the build said so.
function angularAssets(dir) {
  let config;
  try { config = JSON.parse(readFileSync(join(dir, 'angular.json'), 'utf8')); } catch { return new Map(); }
  const found = new Map();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (!['scripts', 'styles'].includes(key) || !Array.isArray(child)) { visit(child); continue; }
      for (const entry of child) {
        const input = String((typeof entry === 'string' ? entry : entry?.input) || '').replace(/\\/g, '/');
        const [, name, path] = /^(?:\.\/)?node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(input) || [];
        if (name && VALID_NAME.test(name)) found.set(name, new Set([...(found.get(name) || []), path]));
      }
    }
  };
  visit(config?.projects);
  return found;
}

function readProject(dir) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) throw new PlanError(`No package.json in ${dir}. Run this from the Angular project's root.`);
  const pkg = readJson(pkgPath);
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  if (!deps['@angular/core']) {
    throw new PlanError(`${dir} has no @angular/core dependency, so it isn't an Angular project${pkg.workspaces ? ' root (it declares workspaces: run this in the app that depends on Angular)' : ''}.`);
  }
  const lockPath = join(dir, 'package-lock.json');
  const lock = existsSync(lockPath) ? readJson(lockPath) : null;
  const pnpmRoot = lock ? null : findPnpmRoot(dir);
  const pnpmLock = pnpmRoot ? readPnpmLock(pnpmRoot, dir) : {};
  const packageManager = lock ? 'npm'
    : pnpmRoot ? 'pnpm'
    : existsSync(join(dir, 'yarn.lock')) ? 'yarn'
    : existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock')) ? 'bun'
    : (pkg.packageManager || 'npm').split('@')[0];

  const otherLock = packageManager === 'yarn' && existsSync(join(dir, 'yarn.lock')) ? readYarnLock(dir, deps)
    : packageManager === 'bun' && existsSync(join(dir, 'bun.lock')) ? readBunLock(dir)
    : {};

  const installed = (name) => {
    const fromLock = lock?.packages?.[`node_modules/${name}`]?.version || lock?.dependencies?.[name]?.version || pnpmLock[name] || otherLock[name];
    if (fromLock && semver.valid(fromLock)) return { version: fromLock, source: 'lockfile' };
    const modPath = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(modPath)) {
      try { const v = JSON.parse(readFileSync(modPath, 'utf8')).version; if (semver.valid(v)) return { version: v, source: 'node_modules' }; } catch { /* a broken install falls through to the declared range */ }
    }
    const spec = deps[name];
    if (spec && semver.validRange(spec)) {
      const min = semver.minVersion(spec);
      if (min) return { version: min.version, source: 'package.json range' };
    }
    return null;
  };
  return { dir, pkg, deps, packageManager, installed, pnpmRoot, nx: existsSync(join(dir, 'nx.json')) };
}

// ---- Judging one release against one Angular major ------------------------------------------------------------

function angularPeers(manifest) {
  const peers = manifest?.peerDependencies || {};
  const meta = manifest?.peerDependenciesMeta || {};
  return Object.entries(peers).filter(([name, range]) => name.startsWith('@angular/') && !meta[name]?.optional && semver.validRange(range));
}

// `declared`: the range names this major. `open`: it accepts this major only because it has no upper limit,
// from a release made after the major shipped. `stale`: the same, from a release older than the major, so
// nobody can have tested it. `reject`: it doesn't accept the major. `none`: it declares nothing about Angular.
function judge(manifest, published, major, frameworkVersion, angularReleased) {
  const peers = angularPeers(manifest);
  if (peers.length === 0) return 'none';
  let verdict = 'declared';
  for (const [name, range] of peers) {
    const accepts = isFramework(name) ? semver.satisfies(frameworkVersion, range, { includePrerelease: true }) : semver.intersects(range, `^${major}.0.0`);
    if (!accepts) return 'reject';
    if (semver.satisfies('999.0.0', range, { includePrerelease: true })) {
      const floor = semver.minVersion(range)?.major ?? 0;
      if (floor >= major) continue;
      const fresh = !published || !angularReleased || published >= angularReleased;
      if (!fresh) return 'stale';
      verdict = 'open';
    }
  }
  return verdict;
}

// prerelease: only for a --next hop, where a library's own prerelease may be all that supports the new major.
// Stable releases still come first.
function eligibleReleases(doc, floor, prerelease = false) {
  const latest = doc['dist-tags']?.latest;
  const eligible = (versions) => newestFirst(versions).filter((v) => {
    if (doc.versions[v].deprecated) return false;
    if (latest && semver.valid(latest) && !semver.prerelease(latest) && semver.gt(v, latest) && !semver.prerelease(v)) return false;
    return !floor || semver.gte(v, floor);
  });
  const stable = eligible(stableOnly(Object.keys(doc.versions)));
  return prerelease ? [...stable, ...eligible(Object.keys(doc.versions).filter((v) => semver.valid(v) && semver.prerelease(v)))] : stable;
}

function hasAngularPeersForHop(doc, floor, majorRange) {
  const line = eligibleReleases(doc, floor).filter((v) => semver.satisfies(v, majorRange));
  // The preferred current release may have dropped the peers an older release had.
  // Inspect that candidate, not an older peer-bearing release in the same line.
  // With no eligible target line, retain the existing explicit-peer/history check.
  return (line.length ? [line[0]] : Object.keys(doc.versions)).some((v) => angularPeers(doc.versions[v]).length > 0);
}

function chooseRelease(doc, floor, major, frameworkVersion, angularReleased, prerelease = false) {
  const verdictOf = (v) => judge(doc.versions[v], doc.time?.[v], major, frameworkVersion, angularReleased);
  // An installed release that already names this major stays put: the upgrade changes nothing it doesn't have to.
  if (floor && doc.versions[floor] && !doc.versions[floor].deprecated && verdictOf(floor) === 'declared') {
    return { version: floor, support: 'declared' };
  }
  const candidates = eligibleReleases(doc, floor, prerelease);
  const declared = candidates.find((v) => verdictOf(v) === 'declared');
  if (declared) return { version: declared, support: 'declared' };
  const open = candidates.find((v) => verdictOf(v) === 'open');
  // Nothing names this major, so a move would only swap one open-ended promise for another, and bring the library's own
  // breaking changes along. AG Grid 34 to 36 was that: its own table says 28 and up work on Angular 22.
  const installed = floor && doc.versions[floor] && !doc.versions[floor].deprecated ? verdictOf(floor) : null;
  if (installed === 'open' || installed === 'stale') return { version: floor, support: installed, newer: open && open !== floor ? open : null };
  if (open) return { version: open, support: 'open' };
  // Already installed and accepted by a range older than this major: moving it isn't possible, and npm won't
  // object, so the upgrade can proceed, but only the running app can say whether it works.
  if (floor && doc.versions[floor] && verdictOf(floor) === 'stale') return { version: floor, support: 'stale' };
  return null;
}

function describeBlocker(doc, name, floor, major, frameworkVersion, angularReleased) {
  const latest = doc['dist-tags']?.latest;
  const manifest = doc.versions[latest];
  const peers = angularPeers(manifest).map(([, r]) => r);
  const all = newestFirst(Object.keys(doc.versions).filter((v) => semver.valid(v)));
  const verdictOf = (v) => judge(doc.versions[v], doc.time?.[v], major, frameworkVersion, angularReleased);
  const accepts = (v) => ['declared', 'open', 'stale'].includes(verdictOf(v));
  const prerelease = all.find((v) => semver.prerelease(v) && accepts(v)) || null;
  const below = stableOnly(all).filter((v) => floor && semver.lt(v, floor));
  const older = below.find(accepts) || null;
  const nextMajor = major + 1;
  const later = stableOnly(all).find((v) => {
    const range = angularPeers(doc.versions[v]);
    return range.length > 0 && range.every(([, r]) => semver.intersects(r, `^${nextMajor}.0.0`) && !semver.intersects(r, `^${major}.0.0`));
  }) || null;
  const blocker = {
    name, major, kind: 'no-release', installed: floor || null, latest, latestPeer: peers[0] || null,
    lastPublished: day(doc.time?.[latest]), deprecated: manifest?.deprecated || null,
    prerelease, olderAccepts: older, laterSupport: later,
  };
  const parts = [`no stable release at or above ${floor || 'the installed version'} supports Angular ${major}; the latest, ${latest}${day(doc.time?.[latest]) ? ` (${day(doc.time?.[latest])})` : ''}, requires ${peers[0] || 'no Angular version'}`];
  if (blocker.deprecated) parts.push(`it is deprecated on npm: "${String(blocker.deprecated).slice(0, 120)}"`);
  if (older) parts.push(`older ${older} accepts Angular ${major}, but only through an open-ended range, and taking it would be a downgrade, so the plan rejects it`);
  if (prerelease) parts.push(`prerelease ${prerelease} accepts it`);
  blocker.reason = parts.join('; ');
  return blocker;
}

// ---- Peers shared across the hop: TypeScript, RxJS, and packages a library needs alongside it ----------------

// Stable releases that aren't deprecated or past `latest`, inside every range and from `floor` up, oldest first.
function usableReleases(doc, ranges, floor) {
  const latest = doc['dist-tags']?.latest;
  return stableOnly(Object.keys(doc.versions)).filter((v) => {
    if (doc.versions[v].deprecated) return false;
    if (latest && semver.valid(latest) && !semver.prerelease(latest) && semver.gt(v, latest)) return false;
    if (floor && semver.lt(v, floor)) return false;
    return ranges.every((r) => semver.satisfies(v, r, { includePrerelease: true }));
  }).sort(semver.compare);
}

// The lowest minor that works, at its newest patch: the smallest move that gets its fixes.
function minimalBump(usable) {
  if (usable.length === 0) return null;
  const lowest = usable[0];
  const sameMinor = usable.filter((v) => semver.major(v) === semver.major(lowest) && semver.minor(v) === semver.minor(lowest));
  return sameMinor[sameMinor.length - 1];
}

async function resolveShared({ project, registry, requirements, current, coupled }) {
  const changes = [];
  const conflicts = [];
  for (const [peer, wants] of Object.entries(requirements)) {
    if (isFramework(peer)) continue;
    const ranges = wants.map((w) => w.range);
    const have = current[peer] || project.installed(peer)?.version || null;
    if (coupled.has(peer)) {
      if (have && !ranges.every((r) => semver.satisfies(have, r, { includePrerelease: true }))) {
        conflicts.push({ name: peer, have, wants });
      }
      continue;
    }
    const declared = Boolean(project.deps[peer]);
    if (!declared && !SHARED_ALWAYS.has(peer)) continue;
    if (!declared && peer === 'rxjs') continue;
    if (have && ranges.every((r) => semver.satisfies(have, r, { includePrerelease: true }))) continue;
    const doc = await registry.get(peer);
    const usable = doc ? usableReleases(doc, ranges, have) : [];
    const pick = minimalBump(usable);
    if (!pick) { conflicts.push({ name: peer, have, wants }); continue; }
    // ng update takes the newest release in these ranges, so `to` is the smallest move, `newest` what ng update may
    // install instead, and anything in the ranges fits. A shared package can cross a major, so it names its repository.
    const newest = usable[usable.length - 1];
    const repository = repositoryUrl(await registry.release(peer, pick).catch(() => null));
    changes.push({ name: peer, from: have, to: pick, ...(newest !== pick ? { newest } : {}), ranges: [...new Set(ranges)], ...(repository ? { repository } : {}), neededBy: [...new Set(wants.map((w) => w.by))] });
    current[peer] = pick;
  }
  return { changes, conflicts };
}

// ---- Licenses -------------------------------------------------------------------------------------------------

const MAX_UNPACKED = 256 * 1024 * 1024;
const licenseField = (manifest) => String(manifest?.license?.type ?? manifest?.license ?? '').trim();
// What a package wrote goes to an agent as a plan line, so it stays one short line of plain text.
const plainLine = (text) => text.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const licenseTitle = (text) => text.split(/\r?\n/).map((line) => plainLine(line.replace(/^[#=*\s-]+/, ''))).find(Boolean);

// A release's files, read from its tarball in memory, so nothing in it reaches the disk or runs. A path too long for
// the name field continues in the ustar prefix field.
async function tarball(manifest) {
  const res = await fetch(manifest.dist.tarball);
  if (!res.ok) return null;
  const tar = gunzipSync(Buffer.from(await res.arrayBuffer()), { maxOutputLength: MAX_UNPACKED });
  const files = [];
  for (let at = 0; at + 512 <= tar.length;) {
    const size = parseInt(tar.toString('latin1', at + 124, at + 136), 8) || 0;
    const field = (start, length) => tar.toString('latin1', at + start, at + start + length).split('\0')[0];
    const prefix = field(257, 5) === 'ustar' ? field(345, 155) : '';
    const name = `${prefix ? `${prefix}/` : ''}${field(0, 100)}`.replace(/^[^/]+\//, '');
    const start = at + 512;
    if (name) files.push({ name, text: () => tar.toString('utf8', start, start + size) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function readLicenseFile(manifest) {
  const named = /^see license in\s+(.+)$/i.exec(licenseField(manifest))?.[1].replace(/^\.\//, '').toLowerCase();
  const files = await tarball(manifest);
  if (!files) return null;
  const file = files.find((f) => f.name.toLowerCase() === named) || files.findLast((f) => /^licen[cs]e(\.\w+)?$/i.test(f.name));
  return file ? file.text() : null;
}

// npm doesn't warn about this, and the build, tests and page all still pass. PrimeNG went from MIT to a commercial
// license with "SEE LICENSE IN LICENSE.md" as its field on both sides, so that form needs the files themselves.
async function licenseChange({ name, from, to }, before, after) {
  if (!before || !after) return { name, unread: true };
  const fields = [before, after].map(licenseField);
  const comparable = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (comparable(fields[0]) !== comparable(fields[1])) {
    // A field that only points at a file says nothing on its own, so the file's title stands in for it.
    const shown = async (manifest, field) => (/^see license/i.test(field) && licenseTitle((await readLicenseFile(manifest).catch(() => null)) || '')) || plainLine(field) || 'none';
    return { name, from, to, before: await shown(before, fields[0]), after: await shown(after, fields[1]) };
  }
  if (!/^see license/i.test(fields[1])) return null;
  const files = await Promise.all([before, after].map((manifest) => readLicenseFile(manifest).catch(() => null)));
  if (!files[0] || !files[1]) return { name, unread: true };
  // Letters only, so a new copyright year isn't a new license.
  const words = (text) => text.toLowerCase().replace(/[^a-z]/g, '');
  return words(files[0]) === words(files[1]) ? null : { name, from, to, before: licenseTitle(files[0]), after: licenseTitle(files[1]) };
}

// SPDX ids for permissive licenses. A new dependency under anything else gets named, copyleft included, because that
// comes with obligations of its own.
const PERMISSIVE = new Set(['mit', 'mit-0', 'isc', 'apache-2.0', 'bsd-2-clause', 'bsd-3-clause', '0bsd', 'unlicense', 'cc0-1.0', 'blueoak-1.0.0', 'zlib', 'python-2.0', 'cc-by-3.0', 'cc-by-4.0']);
const permissive = (field) => {
  const ids = field.split(/\s+(?:or|and|with)\s+|[()\s]+/i).filter(Boolean).map((id) => id.toLowerCase());
  return ids.length > 0 && (/\band\b/i.test(field) ? ids.every((id) => PERMISSIVE.has(id)) : ids.some((id) => PERMISSIVE.has(id)));
};

// A moved library can bring packages under licenses of their own: PrimeNG 22 newly depends on a commercial license
// manager. Only new dependencies and ones whose range changed get looked up, and there are usually none.
async function broughtLicenses(registry, lib, before, after) {
  const was = before?.dependencies || {};
  const now = after?.dependencies || {};
  const changed = Object.keys(now).filter((dep) => VALID_NAME.test(dep) && was[dep] !== now[dep] && semver.validRange(now[dep]));
  return mapLimited(changed, async (dep) => {
    try {
      const doc = await registry.get(dep);
      const stable = doc ? stableOnly(Object.keys(doc.versions)) : [];
      const to = semver.maxSatisfying(stable, now[dep]);
      const from = was[dep] && semver.validRange(was[dep]) ? semver.maxSatisfying(stable, was[dep]) : null;
      if (!to) return { name: dep, via: lib.name, unread: true };
      if (from === to) return null;
      const [old, next] = await Promise.all([from ? registry.release(dep, from) : null, registry.release(dep, to)]);
      if (from) { const change = await licenseChange({ name: dep, from, to }, old, next); return change && { ...change, via: lib.name }; }
      const field = licenseField(next);
      if (permissive(field)) return null;
      const file = /^see license/i.test(field) ? await readLicenseFile(next).catch(() => null) : null;
      return { name: dep, via: lib.name, from: null, to, before: null, after: (file && licenseTitle(file)) || plainLine(field) || 'none' };
    } catch {
      return { name: dep, via: lib.name, unread: true };
    }
  });
}

// ---- The plan ---------------------------------------------------------------------------------------------------

async function buildPlan({ projectDir, to, next = false }) {
  const project = readProject(projectDir);
  const assets = angularAssets(projectDir);
  const pins = nodePins(projectDir);
  const { stdout: configText } = await runNpm(['config', 'list', '--json'], { cwd: projectDir })
    .catch((err) => { throw new PlanError(`Could not run npm to read the registry settings: ${err.message.split('\n')[0]}`); });
  const registry = registryClient(JSON.parse(configText), projectDir);

  // Through Angular 21's CLI, `ng update` prints "Package x was not found on the registry. Skipping." for these and
  // still exits 0, and Angular 22's stops with an error, so the pnpm runner moves the catalog itself.
  const catalogued = Object.keys(project.deps).filter((n) => String(project.deps[n]).startsWith('catalog:') && (isFramework(n) || n === 'typescript'));

  const currentCore = project.installed('@angular/core');
  if (!currentCore) throw new PlanError(`Could not work out the installed @angular/core version from "${project.deps['@angular/core']}".`);
  const currentMajor = semver.major(currentCore.version);

  const [coreDoc, compilerDoc] = await Promise.all([registry.get('@angular/core', true), registry.get('@angular/compiler-cli', true)]);
  if (!coreDoc || !compilerDoc) throw new PlanError('The registry has no @angular/core or @angular/compiler-cli.');
  const latestAngular = coreDoc['dist-tags'].latest;
  const latestMajor = semver.major(latestAngular);
  // Angular's `next` tag is either a minor of the current major or the next major, depending on the month.
  const nextTag = coreDoc['dist-tags'].next;
  const prerelease = semver.valid(nextTag) && semver.prerelease(nextTag) && semver.gt(nextTag, latestAngular) ? nextTag : null;
  const nextMajor = prerelease ? semver.major(prerelease) : null;
  if (next && !prerelease) throw new PlanError(`Angular has no prerelease newer than ${latestAngular} right now, so --next has nothing to try.`);
  if (next && to !== undefined && to !== nextMajor) throw new PlanError(`--next aims at Angular's next prerelease, ${prerelease}, so leave out --to or make it ${nextMajor}.`);
  const target = to ?? (next ? nextMajor : latestMajor);
  if (!next && target > latestMajor) {
    throw new PlanError(`Angular ${target} isn't released yet. The latest stable version is ${latestAngular}.${nextMajor === target ? ` A prerelease, ${prerelease}, is out: plan with --next to try it.` : ''}`);
  }
  if (target < currentMajor) throw new PlanError(`The project is on Angular ${currentMajor}, already past ${target}. This skill only moves forward.`);

  const plan = {
    project: {
      dir: projectDir, packageManager: project.packageManager, node: process.version.replace(/^v/, ''),
      angular: currentCore.version, angularSource: currentCore.source, nx: project.nx,
    },
    latestAngular, target, next: next ? prerelease : null, reachable: currentMajor, status: 'ok', hops: [], blockers: [], unchecked: [], notes: [], licenseChanges: [], deprecations: [],
  };
  if (project.nx) plan.notes.push('This is an Nx workspace. Nx has its own `nx migrate` flow, which this plan does not model, so use that for the framework packages.');
  if (catalogued.length) {
    const sharedWith = project.pnpmRoot ? catalogUsers(project.pnpmRoot, projectDir, catalogued) : [];
    plan.catalog = { packages: catalogued, sharedWith };
    plan.notes.push(`${catalogued.join(', ')} come from a pnpm catalog, which Angular's CLI can't change. The pnpm runner in each command moves the catalog's entries itself and puts package.json back on them.`);
    if (sharedWith.length) plan.notes.push(`The catalog is also used by ${sharedWith.join(', ')}, so moving it moves them too, without their migrations. Ask before going ahead.`);
  }
  if (next) plan.notes.push(`${prerelease} is a prerelease. Libraries may not support it yet, and it isn't meant for production.`);
  const cliDoc = next ? await registry.get('@angular/cli') : null;
  const cliNext = semver.valid(cliDoc?.['dist-tags']?.next) && semver.major(cliDoc['dist-tags'].next) === nextMajor ? cliDoc['dist-tags'].next : 'next';

  // Which dependencies are tied to Angular? Read every one, because the name alone can't say.
  const names = Object.keys(project.deps).filter((n) => !isFramework(n));
  const invalid = names.filter((n) => !VALID_NAME.test(n));
  for (const name of invalid) plan.unchecked.push({ name: JSON.stringify(name), reason: 'that is not a valid npm package name, so it was not looked up' });
  const nonRegistry = names.filter((n) => VALID_NAME.test(n) && !semver.validRange(project.deps[n]) && !/^(latest|next)$/.test(project.deps[n]));
  for (const name of nonRegistry) plan.unchecked.push({ name, reason: `declared as "${project.deps[name]}", so it isn't on the registry to check` });
  const lookups = names.filter((n) => VALID_NAME.test(n) && !nonRegistry.includes(n));
  const screened = await mapLimited(lookups, async (name) => {
    const doc = await registry.get(name);
    if (!doc) {
      if (LOOKS_ANGULAR.test(name)) plan.unchecked.push({ name, reason: 'not found on the registry' });
      return null;
    }
    const manifests = Object.values(doc.versions);
    const hasPeer = manifests.some((m) => angularPeers(m).length > 0);
    if (hasPeer || ALIGNED.test(name)) return name;
    if (LOOKS_ANGULAR.test(name)) plan.unchecked.push({ name, reason: 'its releases declare no Angular version, so npm cannot say whether it supports one' });
    return null;
  });
  const coupledNames = screened.filter(Boolean).sort();
  const coupled = new Set(coupledNames);

  // A library with no Angular peer can still be tied to one that moves. @nebular/eva-icons 16 peers on @nebular/theme
  // at exactly 16.0.0, and `ng update` refuses the hop unless both are in the command.
  const peersOnCoupled = (manifest) => Object.entries(manifest?.peerDependencies || {}).filter(([peer, range]) => coupled.has(peer) && !manifest.peerDependenciesMeta?.[peer]?.optional && semver.validRange(range));
  const followerNames = [];
  for (let found = true; found;) {
    found = false;
    for (const name of lookups) {
      if (coupled.has(name)) continue;
      const doc = await registry.get(name);
      if (!doc || !Object.values(doc.versions).some((m) => peersOnCoupled(m).length > 0)) continue;
      coupled.add(name);
      followerNames.push(name);
      found = true;
    }
  }

  const docs = new Map(await mapLimited([...coupledNames, ...followerNames], async (name) => [name, await registry.get(name, true)]));

  const current = {};
  for (const name of [...coupledNames, ...followerNames]) current[name] = project.installed(name)?.version || null;

  let blockedAt = null;
  for (let major = currentMajor + 1; major <= target; major++) {
    const majorRange = `>=${major}.0.0 <${major + 1}.0.0`;
    const toPrerelease = Boolean(next) && major === nextMajor;
    const frameworkVersion = toPrerelease ? prerelease : semver.maxSatisfying(stableOnly(Object.keys(coreDoc.versions)), majorRange);
    if (!frameworkVersion) throw new PlanError(`The registry has no stable @angular/core ${major}.`);
    const angularReleased = coreDoc.time?.[`${major}.0.0`] || coreDoc.time?.[semver.minSatisfying(stableOnly(Object.keys(coreDoc.versions)), majorRange)] || coreDoc.time?.[frameworkVersion];
    const coreManifest = coreDoc.versions[frameworkVersion];
    const compilerVersion = toPrerelease && compilerDoc.versions[prerelease] ? prerelease : semver.maxSatisfying(stableOnly(Object.keys(compilerDoc.versions)), majorRange);
    const compilerManifest = compilerDoc.versions[compilerVersion];

    const libs = [];
    const blockers = [];
    const requirements = {};
    const addPeers = (owner, manifest) => {
      const meta = manifest?.peerDependenciesMeta || {};
      for (const [peer, range] of Object.entries(manifest?.peerDependencies || {})) {
        if (peer.startsWith('@angular/') && !coupled.has(peer)) continue;
        if (meta[peer]?.optional && !project.deps[peer]) continue;
        if (!semver.validRange(range)) continue;
        (requirements[peer] ||= []).push({ by: owner, range });
      }
    };
    addPeers('@angular/core', coreManifest);
    addPeers('@angular/compiler-cli', compilerManifest);

    for (const name of coupledNames) {
      const doc = docs.get(name);
      const floor = current[name];
      if (ALIGNED.test(name) && !hasAngularPeersForHop(doc, floor, majorRange)) {
        const version = semver.maxSatisfying(eligibleReleases(doc, floor), majorRange);
        if (version) {
          libs.push({ name, from: floor, to: version, support: 'aligned', peer: `major ${major}`, migrations: Boolean(doc.versions[version]['ng-update']?.migrations) });
          current[name] = version;
          addPeers(name, doc.versions[version]);
        } else {
          plan.unchecked.push({ name, reason: `no ${major}.x release yet, and it follows Angular's major` });
        }
        continue;
      }
      const choice = chooseRelease(doc, floor, major, frameworkVersion, angularReleased, toPrerelease);
      if (!choice) { blockers.push(describeBlocker(doc, name, floor, major, frameworkVersion, angularReleased)); continue; }
      const manifest = doc.versions[choice.version];
      libs.push({
        name, from: floor, to: choice.version, support: choice.support, ...(choice.newer ? { newer: choice.newer } : {}),
        peer: angularPeers(manifest).map(([, r]) => r)[0] || null,
        migrations: Boolean(manifest['ng-update']?.migrations),
        deprecated: manifest.deprecated || doc.versions[doc['dist-tags']?.latest]?.deprecated || null,
        lastPublished: day(doc.time?.[doc['dist-tags']?.latest]),
      });
      current[name] = choice.version;
      addPeers(name, manifest);
    }

    // A library that could have stayed put may have to move anyway, because a sibling needs it newer:
    // @angular/cdk 20 accepts Angular 21, but Nebular 17 on Angular 21 needs cdk ^21. Moving one can require moving
    // another, so this repeats until nothing changes. The pass limit stops a cycle of releases chasing each other.
    for (let pass = 0; pass < coupledNames.length + 1; pass++) {
      let changed = false;
      for (const lib of libs) {
        const wants = requirements[lib.name];
        if (!wants || wants.every((w) => semver.satisfies(lib.to, w.range, { includePrerelease: true }))) continue;
        const doc = docs.get(lib.name);
        const better = eligibleReleases(doc, lib.to).find((v) => {
          if (!wants.every((w) => semver.satisfies(v, w.range, { includePrerelease: true }))) return false;
          return ['declared', 'open'].includes(judge(doc.versions[v], doc.time?.[v], major, frameworkVersion, angularReleased));
        });
        if (!better) continue;
        const manifest = doc.versions[better];
        lib.to = better;
        lib.support = judge(manifest, doc.time?.[better], major, frameworkVersion, angularReleased);
        lib.peer = angularPeers(manifest).map(([, r]) => r)[0] || null;
        lib.migrations = Boolean(manifest['ng-update']?.migrations);
        lib.deprecated = manifest.deprecated || null;
        current[lib.name] = better;
        // The old release's own needs no longer count.
        for (const peer of Object.keys(requirements)) requirements[peer] = requirements[peer].filter((w) => w.by !== lib.name);
        addPeers(lib.name, manifest);
        changed = true;
      }
      if (!changed) break;
    }

    // A follower only moves when the release in place stops accepting what its peers just moved to.
    for (let pass = 0; pass < followerNames.length + 1; pass++) {
      let changed = false;
      for (const name of followerNames) {
        const doc = docs.get(name);
        const have = current[name];
        if (!have || !doc?.versions[have]) continue;
        const rejected = (v) => peersOnCoupled(doc.versions[v]).filter(([peer, range]) => current[peer] && !semver.satisfies(current[peer], range, { includePrerelease: true }));
        if (rejected(have).length === 0) continue;
        const to = eligibleReleases(doc, have).find((v) => rejected(v).length === 0);
        if (!to) {
          if (blockers.some((b) => b.name === name)) continue;
          const wants = rejected(have).map(([peer, range]) => ({ by: name, peer, range }));
          blockers.push({
            name, major, kind: 'peer-conflict', installed: have, wants,
            reason: `no stable release at or above ${have} accepts ${wants.map((w) => `${w.peer} ${current[w.peer]}`).join(', ')}, which Angular ${major} needs, and ${have} requires ${wants.map((w) => w.range).join(', ')}`,
          });
          continue;
        }
        const manifest = doc.versions[to];
        libs.push({
          name, from: have, to, support: 'follows',
          peer: peersOnCoupled(manifest).map(([peer]) => `${peer} ${current[peer]}`).join(', '),
          migrations: Boolean(manifest['ng-update']?.migrations),
          deprecated: null,
          lastPublished: day(doc.time?.[doc['dist-tags']?.latest]),
        });
        current[name] = to;
        addPeers(name, manifest);
        changed = true;
      }
      if (!changed) break;
    }

    const { changes, conflicts } = await resolveShared({ project, registry, requirements, current, coupled });
    for (const c of conflicts) {
      blockers.push({
        name: c.name, major, kind: 'peer-conflict', installed: c.have, wants: c.wants,
        reason: `its version can't satisfy everything that needs it at Angular ${major}: ${c.wants.map((w) => `${w.by} wants ${w.range}`).join(', ')}${c.have ? `, and ${c.have} is installed` : ''}`,
      });
    }

    const nodeRange = coreManifest.engines?.node || null;
    let node = { range: nodeRange, status: 'unknown' };
    if (nodeRange && semver.validRange(nodeRange)) {
      const version = process.version.replace(/^v/, '');
      node.status = semver.satisfies(version, nodeRange) ? 'ok' : semver.ltr(version, nodeRange) ? 'too-old' : 'unsupported';
      const below = pins.filter((p) => !pinFits(p, nodeRange)).map(({ file, value }) => ({ file, value }));
      if (below.length) node.pins = below;
    }

    const moved = libs.filter((l) => l.from !== l.to);
    // npm, pnpm and bun install a required peer on their own, so nothing else says the app gained one, and yarn doesn't,
    // so the build can't resolve it. Each new peer is named, and listed to install with a version that fits every library
    // that needs it, picked once they're all known, so the order the libraries come in can't change the pick.
    const newPeers = new Map();
    for (const lib of moved) {
      const [before, after] = [docs.get(lib.name)?.versions?.[lib.from], docs.get(lib.name)?.versions?.[lib.to]];
      const repository = repositoryUrl(after);
      if (repository) lib.repository = repository;
      const added = Object.keys(after?.peerDependencies || {}).filter((peer) => !after.peerDependenciesMeta?.[peer]?.optional && !before?.peerDependencies?.[peer] && !project.deps[peer]);
      const valid = added.filter((peer) => VALID_NAME.test(peer));
      if (lib.from && valid.length) lib.newPeers = valid;
      if (lib.from && valid.length < added.length) plan.unchecked.push({ name: lib.name, reason: `${lib.to} names a peer that isn't a valid npm package name, so it isn't listed` });
      for (const peer of lib.from ? valid : []) {
        const entry = newPeers.get(peer) || { ranges: [], neededBy: [] };
        if (!entry.ranges.includes(after.peerDependencies[peer])) entry.ranges.push(after.peerDependencies[peer]);
        entry.neededBy.push(lib.name);
        newPeers.set(peer, entry);
      }
    }
    for (const [peer, { ranges, neededBy }] of newPeers) {
      const fitsAll = (v) => ranges.every((r) => semver.validRange(r) && semver.satisfies(v, r, { includePrerelease: true }));
      const needs = `${neededBy.join(' and ')} newly need${neededBy.length > 1 ? '' : 's'} ${ranges.join(' and ')}`;
      const listed = changes.find((s) => s.name === peer);
      if (listed) {
        // Already moving as a shared package, so its pick has to suit these libraries too.
        listed.neededBy.push(...neededBy.filter((name) => !listed.neededBy.includes(name)));
        listed.ranges.push(...ranges.filter((r) => !listed.ranges.includes(r)));
        if (!fitsAll(listed.to)) plan.unchecked.push({ name: peer, reason: `${needs}, which ${listed.to} doesn't meet` });
        continue;
      }
      const doc = await registry.get(peer).catch(() => null);
      // A framework package keeps in step with core, as ng update keeps the rest of them.
      const fits = isFramework(peer) && fitsAll(frameworkVersion) ? frameworkVersion
        : doc ? eligibleReleases(doc, null).filter(fitsAll).sort(semver.rcompare)[0] : null;
      if (fits) changes.push({ name: peer, from: null, to: fits, ranges, neededBy });
      else plan.unchecked.push({ name: peer, reason: `${needs}, and the registry has no release that fits` });
    }
    // `@angular/core@23` would resolve to a stable 23, so a prerelease is named exactly.
    const framework = toPrerelease ? `@angular/core@${frameworkVersion} @angular/cli@${cliNext}` : `@angular/core@${major} @angular/cli@${major}`;
    const command = [`${updateCommand(project)} ${framework}`, ...moved.map((l) => `${l.name}@${l.to}`)].join(' ');
    const hop = { major, angular: frameworkVersion, node, libs, shared: changes, dropped: [], command };

    if (blockers.length) {
      plan.blockers.push(...blockers);
      if (blockedAt === null) blockedAt = major;
      for (const blocker of blockers) if (coupled.has(blocker.name) && blocker.kind === 'no-release') current[blocker.name] = current[blocker.name] || null;
    }
    if (blockedAt === null) {
      plan.hops.push(hop);
      plan.reachable = major;
      const releases = async (name, from, to) => Promise.all([registry.release(name, from), registry.release(name, to)]).catch(() => [null, null]);
      const compared = await Promise.all([
        ...moved.filter((lib) => lib.from).map(async (lib) => {
          const [before, after] = [docs.get(lib.name)?.versions?.[lib.from], docs.get(lib.name)?.versions?.[lib.to]];
          return [await licenseChange(lib, before, after), ...await broughtLicenses(registry, lib, before, after)];
        }),
        ...changes.filter((s) => s.from).map(async (s) => {
          const change = await licenseChange(s, ...await releases(s.name, s.from, s.to));
          // ng update may install the newest release that fits instead of the plan's pick, so that one is compared too.
          return [change ?? (s.newest ? await licenseChange({ ...s, to: s.newest }, ...await releases(s.name, s.from, s.newest)) : null)];
        }),
      ]);
      const brought = new Map();
      for (const change of compared.flat().filter(Boolean)) {
        if (change.unread) {
          plan.unchecked.push({ name: change.name, reason: change.via ? `${change.via} brings it, and its license could not be read` : 'its license is in a file the plan could not read, so a change of license can\'t be ruled out' });
          continue;
        }
        plan.licenseChanges.push({ major, ...change });
        if (change.via) brought.set(change.via, [...(brought.get(change.via) || []), change]);
        else plan.notes.push(`Angular ${major} moves ${change.name} from ${change.from} to ${change.to}, and its license changes: "${change.before}" to "${change.after}". Nothing fails when this happens, so nothing else will tell the person. Read both, and ask before going to Angular ${major}.`);
      }
      // One line per library, however many packages it brings, so the plan stays readable.
      for (const [via, list] of brought) {
        const each = list.map((c) => `${c.name} ${c.to} under "${c.after}"${c.before ? ` (${c.from} was "${c.before}")` : ''}`).join(', ');
        plan.notes.push(`Angular ${major} moves ${via}, which brings packages whose license changed or isn't a common open-source one: ${each}. Read those too, and ask before going to Angular ${major}.`);
      }

      for (const { name, to } of [...moved, ...changes].filter((m) => assets.has(m.name) && m.to)) {
        const files = await registry.release(name, to).then((manifest) => manifest && tarball(manifest)).catch(() => null);
        if (!files) { plan.unchecked.push({ name, reason: `angular.json loads files from it, and ${to} could not be read to check they're still there` }); continue; }
        const shipped = new Set(files.map((f) => f.name));
        for (const path of assets.get(name)) if (!shipped.has(path)) hop.dropped.push({ file: `node_modules/${name}/${path}`, name, version: to });
      }

      // ng update moves every framework package along with core, so a deprecation shows nowhere unless the plan says so.
      const framework = Object.keys(project.deps).filter((name) => isFramework(name) && VALID_NAME.test(name) && !plan.deprecations.some((d) => d.name === name));
      const manifests = await mapLimited(framework, (name) => registry.release(name, frameworkVersion).catch(() => null));
      framework.forEach((name, i) => {
        const message = manifests[i]?.deprecated;
        if (!message) return;
        plan.deprecations.push({ major, name, version: frameworkVersion, message: String(message).slice(0, 300) });
        plan.notes.push(`Angular ${major} still installs ${name}, which npm marks deprecated: "${String(message).slice(0, 200)}" ng update moves it anyway, so nothing breaks now, but it's worth planning to move off it.`);
      });
    }
  }

  // A blocker from the person's own registry is likely their team's library, so it can be upgraded first rather than
  // waited for. When several are, one can need another, and the one it needs has to be published first.
  const own = plan.blockers.filter((b) => b.major === blockedAt && registry.own(b.name));
  if (own.length) {
    for (const b of own) { b.ownRegistry = registry.own(b.name); b.reason += `; it comes from your own registry, ${b.ownRegistry}`; }
    const names = new Set(own.map((b) => b.name));
    const needs = new Map(own.map((b) => {
      const manifest = docs.get(b.name)?.versions?.[b.installed || b.latest] || {};
      return [b.name, Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter((n) => names.has(n) && n !== b.name)];
    }));
    const order = [];
    while (order.length < names.size) {
      const ready = [...names].filter((n) => !order.includes(n) && needs.get(n).every((d) => order.includes(d))).sort();
      // Libraries that need each other can't be ordered, so they keep the plan's order.
      order.push(...(ready.length ? ready : [...names].filter((n) => !order.includes(n))));
    }
    plan.ownBlockers = order;
    const each = order.map((n, i) => (i && needs.get(n).length ? `${n}, which needs ${needs.get(n).join(' and ')}` : n));
    plan.notes.push(`${order.length > 1 ? `${order.slice(0, -1).join(', ')} and ${order.at(-1)} come` : `${order[0]} comes`} from your own registry. If ${order.length > 1 ? 'they are' : 'it is'} your team's, ${order.length > 1 ? 'each' : 'it'} can be upgraded first, with a release that accepts Angular ${blockedAt}, in this order: ${each.join(', then ')}.`);
  }
  if (blockedAt !== null) plan.status = 'blocked';
  else if (target === currentMajor) {
    plan.status = 'already-there';
    // Already on the major, but patch releases within it are still an upgrade someone asking for "latest" wants.
    const behind = [];
    for (const name of ['@angular/core', '@angular/cli']) {
      const have = project.installed(name)?.version;
      const doc = have ? await registry.get(name) : null;
      const tagged = doc?.['dist-tags']?.next;
      const newest = !doc ? null
        : next ? (semver.valid(tagged) && semver.major(tagged) === currentMajor ? tagged : null)
        : semver.maxSatisfying(eligibleReleases(doc, have), `>=${currentMajor}.0.0 <${currentMajor + 1}.0.0`);
      if (newest && semver.gt(newest, have)) behind.push({ name, from: have, to: newest });
    }
    // A pin the last upgrade left behind still fails the team, so it's named here too, against this major's range.
    const installed = project.installed('@angular/core')?.version;
    const range = installed && (await registry.release('@angular/core', installed).catch(() => null))?.engines?.node;
    const below = range && semver.validRange(range) ? pins.filter((p) => !pinFits(p, range)).map(({ file, value }) => ({ file, value })) : [];
    if (below.length) plan.nodePins = { range, pins: below };
    if (behind.length) {
      // Only a CLI that has to move bootstraps a temporary copy of itself.
      const update = behind.some((b) => b.name === '@angular/cli') ? updateCommand(project) : `${runnerFor(project)} ng update`;
      plan.patches = { packages: behind, command: `${update} ${behind.map((b) => `${b.name}@${b.to}`).join(' ')}` };
    }
  }
  plan.blockedAt = blockedAt;
  return plan;
}

// ---- Output -------------------------------------------------------------------------------------------------------

const SUPPORT = {
  declared: 'supports it',
  aligned: 'follows Angular\'s major',
  follows: 'moves with its peer',
  open: 'UNCONFIRMED: open-ended range, check the running app',
  stale: 'UNCONFIRMED: this release is older than the Angular major and only accepts it through an open-ended range, check the running app',
};

// Where a library's changelog or release notes are, since many packages don't ship them. Only a short https address
// made of URL-safe characters is kept, because the package's author writes it and an agent may paste it into a shell.
function repositoryUrl(manifest) {
  const raw = typeof manifest?.repository === 'string' ? manifest.repository : manifest?.repository?.url;
  const url = String(raw || '').replace(/^git\+/, '').replace(/^(git|ssh):\/\/(git@)?/, 'https://').replace(/\.git$/, '');
  return url.length <= 200 && /^https:\/\/[\w.-]+(\/[\w.~-]+)+\/?$/.test(url) ? url : null;
}

function render(plan) {
  const lines = [];
  const p = plan.project;
  lines.push(`Angular ${p.angular} (from ${p.angularSource}), ${p.packageManager}, Node ${p.node}. Latest Angular: ${plan.latestAngular}.`);
  if (plan.status === 'already-there') {
    lines.push(`Already on Angular ${plan.target}. ${plan.patches ? (plan.next ? `${plan.next} is a prerelease of it.` : 'Only patch releases are available.') : 'Nothing to upgrade.'}`);
    if (plan.patches) {
      for (const b of plan.patches.packages) lines.push(`  ${b.name}: ${b.from} -> ${b.to}`);
      lines.push(`  Run: ${plan.patches.command}`);
    }
    if (plan.nodePins) lines.push(`  Node pins below what Angular ${plan.target} needs (${plan.nodePins.range}), in the repo: ${plan.nodePins.pins.map((p) => `${p.file} (${p.value})`).join(', ')}`);
  }
  else if (plan.status === 'ok') lines.push(`Result: Angular ${plan.next && semver.major(plan.next) === plan.target ? `${plan.next}, a prerelease,` : plan.target} is reachable.`);
  else lines.push(plan.reachable === semver.major(p.angular)
    ? `Result: BLOCKED. Angular ${plan.blockedAt} isn't possible today, so this project stays on ${plan.reachable} until a blocker below is resolved.`
    : `Result: BLOCKED at Angular ${plan.blockedAt}. Angular ${plan.reachable} is the highest version everything supports today.`);
  for (const note of plan.notes) lines.push(`Note: ${note}`);
  for (const hop of plan.hops) {
    lines.push('', `Angular ${hop.major} (${hop.angular})`);
    lines.push(`  Node: ${hop.node.status}${hop.node.range ? ` (needs ${hop.node.range})` : ''}`);
    if (hop.node.pins) lines.push(`  Node pins below that, in the repo: ${hop.node.pins.map((p) => `${p.file} (${p.value})`).join(', ')}`);
    for (const lib of hop.libs) {
      const move = lib.from === lib.to ? `${lib.to}, no change` : `${lib.from ?? 'not installed'} -> ${lib.to}`;
      lines.push(`  ${lib.name}: ${move}; ${SUPPORT[lib.support]}${lib.peer ? ` (${lib.peer})` : ''}${lib.migrations ? '; ships migrations' : ''}${lib.newPeers ? `; newly needs ${lib.newPeers.slice(0, 8).join(', ')}${lib.newPeers.length > 8 ? ` and ${lib.newPeers.length - 8} more` : ''}, not in package.json` : ''}${lib.from === lib.to && lib.newer ? `; ${lib.newer} is newer, with an open-ended range too, if the app needs it` : ''}${lib.deprecated ? `; DEPRECATED on npm: "${String(lib.deprecated).slice(0, 120)}"` : ''}${lib.repository ? `; repository: ${lib.repository}` : ''}`);
    }
    for (const s of hop.shared) lines.push(`  ${s.name}: ${s.from ?? 'not installed'} -> ${s.to}${s.ranges?.length ? `, fits ${s.ranges.join(' and ')}` : ''}; needed by ${s.neededBy.join(', ')}${s.repository ? `; repository: ${s.repository}` : ''}`);
    for (const d of hop.dropped) lines.push(`  angular.json: loads ${d.file}, which ${d.name} ${d.version} no longer ships. Search the code for what used it, then remove or replace the entry`);
    lines.push(`  Run: ${hop.command}`);
  }
  if (plan.blockers.length) {
    lines.push('', 'Blockers');
    for (const b of plan.blockers) lines.push(`  Angular ${b.major}: ${b.name}: ${b.reason}.`);
  }
  if (plan.unchecked.length) {
    lines.push('', 'Could not check (these do not block the plan; check them in the running app)');
    const seen = new Set();
    for (const u of plan.unchecked) { const key = `${u.name}|${u.reason}`; if (!seen.has(key)) { seen.add(key); lines.push(`  ${u.name}: ${u.reason}.`); } }
  }
  // An agent acts on this text, and much of it comes from the registry, so nothing in it gets to start a line of its own.
  // Controls (C0 and C1), line and paragraph separators, and invisible format characters such as bidi overrides.
  return lines.map((line) => line.replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Cf}]+/gu, ' ')).join('\n');
}

// ---- Entry point ----------------------------------------------------------------------------------------------------

const USAGE = `Usage: plan.mjs [--project <dir>] [--to <major>] [--next] [--json]

Works out how far an Angular app can upgrade today, and what is in the way. Changes nothing.
  --project  the project folder (default: the current folder)
  --to       the Angular major to aim for (default: the latest stable)
  --next     aim for Angular's next prerelease instead, only when someone asks to try one
  --json     print the plan as JSON
Exit codes: 0 the target is reachable or there is nothing to do, 2 blocked before the target, 1 no plan could be made.`;

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: { project: { type: 'string' }, to: { type: 'string' }, next: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean' } } }));
  } catch (err) {
    throw new PlanError(`${err.message.split('.')[0]}.\n${USAGE}`);
  }
  if (values.help) { console.log(USAGE); return; }
  const projectDir = resolve(values.project || '.');
  let to;
  if (values.to !== undefined) {
    to = Number(values.to);
    if (!Number.isInteger(to) || to < 2) throw new PlanError(`--to takes an Angular major version such as 22, not "${values.to}".`);
  }
  const plan = await buildPlan({ projectDir, to, next: Boolean(values.next) });
  process.stdout.write(`${values.json ? JSON.stringify(plan, null, 2) : render(plan)}\n`);
  process.exitCode = plan.status === 'blocked' ? 2 : 0;
}

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('plan.mjs needs Node 18 or newer to read the registry.');
  process.exitCode = 1;
} else {
  main().catch((err) => {
    console.error(err instanceof PlanError ? err.message : err.stack);
    process.exitCode = 1;
  });
}
