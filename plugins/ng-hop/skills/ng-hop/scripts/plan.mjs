#!/usr/bin/env node
// Read-only upgrade plan: how far can this Angular app go today, and what is in the way?
// It reads package.json, the lockfile and npm, and never changes the project.
// Exit codes: 0 the target is reachable (or nothing to do), 2 blocked before the target, 1 could not plan.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
// pnpm's runner keeps the selected CLI from redispatching to the app's old CLI and dirtying its lockfile.
const updateCommand = (project) => (project.packageManager === 'pnpm' ? `pnpm exec node ${quotePath(fileURLToPath(new URL('./update.mjs', import.meta.url)))}` : `${runnerFor(project)} ng update`);

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

  async function fetchOnce(name, full) {
    const url = baseFor(name) + name.replace('/', '%2F');
    const accept = full ? 'application/json' : 'application/vnd.npm.install-v1+json';
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { accept } });
        if (res.status === 404) return null;
        if (res.status === 401 || res.status === 403) return viaNpm(name);
        if (res.ok) return await res.json();
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    throw new PlanError(`Could not reach ${url}: ${lastError?.cause?.code || lastError?.message}. A plan needs the registry, so none was made.`);
  }

  const get = (name, full = false) => {
    const key = `${name}|${full}`;
    if (!cache.has(key)) cache.set(key, fetchOnce(name, full));
    return cache.get(key);
  };
  return { get };
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

  const installed = (name) => {
    const fromLock = lock?.packages?.[`node_modules/${name}`]?.version || lock?.dependencies?.[name]?.version || pnpmLock[name];
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
  return { dir, pkg, deps, packageManager, installed, nx: existsSync(join(dir, 'nx.json')) };
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

function eligibleReleases(doc, floor) {
  const latest = doc['dist-tags']?.latest;
  return newestFirst(stableOnly(Object.keys(doc.versions))).filter((v) => {
    if (doc.versions[v].deprecated) return false;
    if (latest && semver.valid(latest) && !semver.prerelease(latest) && semver.gt(v, latest)) return false;
    return !floor || semver.gte(v, floor);
  });
}

function hasAngularPeersForHop(doc, floor, majorRange) {
  const line = eligibleReleases(doc, floor).filter((v) => semver.satisfies(v, majorRange));
  // The preferred current release may have dropped the peers an older release had.
  // Inspect that candidate, not an older peer-bearing release in the same line.
  // With no eligible target line, retain the existing explicit-peer/history check.
  return (line.length ? [line[0]] : Object.keys(doc.versions)).some((v) => angularPeers(doc.versions[v]).length > 0);
}

function chooseRelease(doc, floor, major, frameworkVersion, angularReleased) {
  const verdictOf = (v) => judge(doc.versions[v], doc.time?.[v], major, frameworkVersion, angularReleased);
  // An installed release that already names this major stays put: the upgrade changes nothing it doesn't have to.
  if (floor && doc.versions[floor] && !doc.versions[floor].deprecated && verdictOf(floor) === 'declared') {
    return { version: floor, support: 'declared' };
  }
  const candidates = eligibleReleases(doc, floor);
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

function minimalBump(doc, ranges, floor) {
  const latest = doc['dist-tags']?.latest;
  const pool = stableOnly(Object.keys(doc.versions)).filter((v) => {
    if (doc.versions[v].deprecated) return false;
    if (latest && semver.valid(latest) && !semver.prerelease(latest) && semver.gt(v, latest)) return false;
    return ranges.every((r) => semver.satisfies(v, r, { includePrerelease: true }));
  }).sort(semver.compare);
  const usable = floor ? pool.filter((v) => semver.gte(v, floor)) : pool;
  if (usable.length === 0) return null;
  // The lowest minor that works, at its newest patch: the smallest move that gets its fixes.
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
    const pick = doc ? minimalBump(doc, ranges, have) : null;
    if (!pick) { conflicts.push({ name: peer, have, wants }); continue; }
    changes.push({ name: peer, from: have, to: pick, neededBy: [...new Set(wants.map((w) => w.by))] });
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

// Read from the tarball in memory, so nothing in it reaches the disk or runs.
async function readLicenseFile(manifest) {
  const named = /^see license in\s+(.+)$/i.exec(licenseField(manifest))?.[1].replace(/^\.\//, '').toLowerCase();
  const res = await fetch(manifest.dist.tarball);
  if (!res.ok) return null;
  const tar = gunzipSync(Buffer.from(await res.arrayBuffer()), { maxOutputLength: MAX_UNPACKED });
  let fallback = null;
  for (let at = 0; at + 512 <= tar.length;) {
    const size = parseInt(tar.toString('latin1', at + 124, at + 136), 8) || 0;
    const file = tar.toString('latin1', at, at + 100).split('\0')[0].replace(/^[^/]+\//, '').toLowerCase();
    if (file === named) return tar.toString('utf8', at + 512, at + 512 + size);
    if (/^licen[cs]e(\.\w+)?$/.test(file)) fallback = tar.toString('utf8', at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return fallback;
}

// npm doesn't warn about this, and the build, tests and page all still pass. PrimeNG went from MIT to a commercial
// license with "SEE LICENSE IN LICENSE.md" as its field on both sides, so that form needs the files themselves.
async function licenseChange(doc, { name, from, to }) {
  const [before, after] = [doc?.versions?.[from], doc?.versions?.[to]];
  if (!before || !after) return { name, unread: true };
  const fields = [before, after].map(licenseField);
  const comparable = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (comparable(fields[0]) !== comparable(fields[1])) return { name, from, to, before: plainLine(fields[0]) || 'none', after: plainLine(fields[1]) || 'none' };
  if (!/^see license/i.test(fields[1])) return null;
  const files = await Promise.all([before, after].map((manifest) => readLicenseFile(manifest).catch(() => null)));
  if (!files[0] || !files[1]) return { name, unread: true };
  // Letters only, so a new copyright year isn't a new license.
  const words = (text) => text.toLowerCase().replace(/[^a-z]/g, '');
  return words(files[0]) === words(files[1]) ? null : { name, from, to, before: licenseTitle(files[0]), after: licenseTitle(files[1]) };
}

// ---- The plan ---------------------------------------------------------------------------------------------------

async function buildPlan({ projectDir, to }) {
  const project = readProject(projectDir);
  const { stdout: configText } = await runNpm(['config', 'list', '--json'], { cwd: projectDir })
    .catch((err) => { throw new PlanError(`Could not run npm to read the registry settings: ${err.message.split('\n')[0]}`); });
  const registry = registryClient(JSON.parse(configText), projectDir);

  // Through Angular 21's CLI, `ng update` prints "Package x was not found on the registry. Skipping." for these and
  // still exits 0. Angular 22's stops with an error instead.
  const catalogued = Object.keys(project.deps).filter((n) => String(project.deps[n]).startsWith('catalog:') && (isFramework(n) || n === 'typescript'));
  if (catalogued.length) {
    throw new PlanError(`${catalogued.join(', ')} come from a pnpm catalog, which \`ng update\` can't change. Through Angular 21's CLI it skips them and still exits 0, so the libraries would move while Angular stays behind with no migrations run. Either give these packages plain versions in package.json, commit that, and plan again, or update the catalog by hand, run pnpm install, then run ng update <package> --migrate-only --from <old version> for each package. Catalogs are shared across a workspace, so that choice belongs to whoever owns it.`);
  }

  const currentCore = project.installed('@angular/core');
  if (!currentCore) throw new PlanError(`Could not work out the installed @angular/core version from "${project.deps['@angular/core']}".`);
  const currentMajor = semver.major(currentCore.version);

  const [coreDoc, compilerDoc] = await Promise.all([registry.get('@angular/core', true), registry.get('@angular/compiler-cli', true)]);
  if (!coreDoc || !compilerDoc) throw new PlanError('The registry has no @angular/core or @angular/compiler-cli.');
  const latestAngular = coreDoc['dist-tags'].latest;
  const latestMajor = semver.major(latestAngular);
  const target = to ?? latestMajor;
  if (target > latestMajor) throw new PlanError(`Angular ${target} isn't released yet. The latest stable version is ${latestAngular}.`);
  if (target < currentMajor) throw new PlanError(`The project is on Angular ${currentMajor}, already past ${target}. This skill only moves forward.`);

  const plan = {
    project: {
      dir: projectDir, packageManager: project.packageManager, node: process.version.replace(/^v/, ''),
      angular: currentCore.version, angularSource: currentCore.source, nx: project.nx,
    },
    latestAngular, target, reachable: currentMajor, status: 'ok', hops: [], blockers: [], unchecked: [], notes: [], licenseChanges: [],
  };
  if (project.nx) plan.notes.push('This is an Nx workspace. Nx has its own `nx migrate` flow, which this plan does not model, so use that for the framework packages.');

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
    const frameworkVersion = semver.maxSatisfying(stableOnly(Object.keys(coreDoc.versions)), majorRange);
    if (!frameworkVersion) throw new PlanError(`The registry has no stable @angular/core ${major}.`);
    const angularReleased = coreDoc.time?.[`${major}.0.0`] || coreDoc.time?.[semver.minSatisfying(stableOnly(Object.keys(coreDoc.versions)), majorRange)];
    const coreManifest = coreDoc.versions[frameworkVersion];
    const compilerVersion = semver.maxSatisfying(stableOnly(Object.keys(compilerDoc.versions)), majorRange);
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
      const choice = chooseRelease(doc, floor, major, frameworkVersion, angularReleased);
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
    }

    const moved = libs.filter((l) => l.from !== l.to);
    // npm and pnpm install a required peer on their own, so nothing else says the app gained one.
    for (const lib of moved) {
      const [before, after] = [docs.get(lib.name)?.versions?.[lib.from], docs.get(lib.name)?.versions?.[lib.to]];
      const added = Object.keys(after?.peerDependencies || {}).filter((peer) => !after.peerDependenciesMeta?.[peer]?.optional && !before?.peerDependencies?.[peer] && !project.deps[peer]);
      const valid = added.filter((peer) => VALID_NAME.test(peer));
      if (lib.from && valid.length) lib.newPeers = valid;
      if (lib.from && valid.length < added.length) plan.unchecked.push({ name: lib.name, reason: `${lib.to} names a peer that isn't a valid npm package name, so it isn't listed` });
    }
    const command = [`${updateCommand(project)} @angular/core@${major} @angular/cli@${major}`, ...moved.map((l) => `${l.name}@${l.to}`)].join(' ');
    const hop = { major, angular: frameworkVersion, node, libs, shared: changes, command };

    if (blockers.length) {
      plan.blockers.push(...blockers);
      if (blockedAt === null) blockedAt = major;
      for (const blocker of blockers) if (coupled.has(blocker.name) && blocker.kind === 'no-release') current[blocker.name] = current[blocker.name] || null;
    }
    if (blockedAt === null) {
      plan.hops.push(hop);
      plan.reachable = major;
      // shortcut: only the libraries the plan moves, which already have full registry documents. Shared packages such as
      // TypeScript would need a very large download each. Check those too if a shared package ever changes its license.
      const compared = await mapLimited(moved.filter((lib) => lib.from), (lib) => licenseChange(docs.get(lib.name), lib));
      for (const change of compared.filter(Boolean)) {
        if (change.unread) { plan.unchecked.push({ name: change.name, reason: 'its license is in a file the plan could not read, so a change of license can\'t be ruled out' }); continue; }
        plan.licenseChanges.push({ major, ...change });
        plan.notes.push(`Angular ${major} moves ${change.name} from ${change.from} to ${change.to}, and its license changes: "${change.before}" to "${change.after}". Nothing fails when this happens, so nothing else will tell the person. Read both, and ask before going to Angular ${major}.`);
      }
    }
  }

  if (blockedAt !== null) plan.status = 'blocked';
  else if (target === currentMajor) {
    plan.status = 'already-there';
    // Already on the major, but patch releases within it are still an upgrade someone asking for "latest" wants.
    const behind = [];
    for (const name of ['@angular/core', '@angular/cli']) {
      const have = project.installed(name)?.version;
      const doc = have ? await registry.get(name) : null;
      const newest = doc ? semver.maxSatisfying(eligibleReleases(doc, have), `>=${currentMajor}.0.0 <${currentMajor + 1}.0.0`) : null;
      if (newest && semver.gt(newest, have)) behind.push({ name, from: have, to: newest });
    }
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

function render(plan) {
  const lines = [];
  const p = plan.project;
  lines.push(`Angular ${p.angular} (from ${p.angularSource}), ${p.packageManager}, Node ${p.node}. Latest Angular: ${plan.latestAngular}.`);
  if (plan.status === 'already-there') {
    lines.push(`Already on Angular ${plan.target}. ${plan.patches ? 'Only patch releases are available.' : 'Nothing to upgrade.'}`);
    if (plan.patches) {
      for (const b of plan.patches.packages) lines.push(`  ${b.name}: ${b.from} -> ${b.to}`);
      lines.push(`  Run: ${plan.patches.command}`);
    }
  }
  else if (plan.status === 'ok') lines.push(`Result: Angular ${plan.target} is reachable.`);
  else lines.push(plan.reachable === semver.major(p.angular)
    ? `Result: BLOCKED. Angular ${plan.blockedAt} isn't possible today, so this project stays on ${plan.reachable} until a blocker below is resolved.`
    : `Result: BLOCKED at Angular ${plan.blockedAt}. Angular ${plan.reachable} is the highest version everything supports today.`);
  for (const note of plan.notes) lines.push(`Note: ${note}`);
  for (const hop of plan.hops) {
    lines.push('', `Angular ${hop.major} (${hop.angular})`);
    lines.push(`  Node: ${hop.node.status}${hop.node.range ? ` (needs ${hop.node.range})` : ''}`);
    for (const lib of hop.libs) {
      const move = lib.from === lib.to ? `${lib.to}, no change` : `${lib.from ?? 'not installed'} -> ${lib.to}`;
      lines.push(`  ${lib.name}: ${move}; ${SUPPORT[lib.support]}${lib.peer ? ` (${lib.peer})` : ''}${lib.migrations ? '; ships migrations' : ''}${lib.newPeers ? `; newly needs ${lib.newPeers.slice(0, 8).join(', ')}${lib.newPeers.length > 8 ? ` and ${lib.newPeers.length - 8} more` : ''}, not in package.json` : ''}${lib.from === lib.to && lib.newer ? `; ${lib.newer} is newer, with an open-ended range too, if the app needs it` : ''}${lib.deprecated ? `; DEPRECATED on npm: "${String(lib.deprecated).slice(0, 120)}"` : ''}`);
    }
    for (const s of hop.shared) lines.push(`  ${s.name}: ${s.from ?? 'not installed'} -> ${s.to}; needed by ${s.neededBy.join(', ')}`);
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
  return lines.map((line) => line.replace(/[\x00-\x1f\x7f]+/g, ' ')).join('\n');
}

// ---- Entry point ----------------------------------------------------------------------------------------------------

const USAGE = `Usage: plan.mjs [--project <dir>] [--to <major>] [--json]

Works out how far an Angular app can upgrade today, and what is in the way. Changes nothing.
  --project  the project folder (default: the current folder)
  --to       the Angular major to aim for (default: the latest stable)
  --json     print the plan as JSON
Exit codes: 0 the target is reachable or there is nothing to do, 2 blocked before the target, 1 no plan could be made.`;

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: { project: { type: 'string' }, to: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' } } }));
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
  const plan = await buildPlan({ projectDir, to });
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
