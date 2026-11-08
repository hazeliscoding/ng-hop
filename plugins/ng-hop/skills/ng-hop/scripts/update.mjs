#!/usr/bin/env node
// pnpm and yarn execution transport. The plan selects versions; Angular still checks Git and peers and runs migrations.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const semver = createRequire(import.meta.url)('./vendor/semver.cjs');
const VALID_NAME = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;
const USAGE = 'Usage: update.mjs [--project <dir>] [--json] [--install-first <library> ...] @angular/core@<version> @angular/cli@<version> [library@version ...]\nRuns the planned pnpm or yarn hop or patch once. With catalog: entries in package.json, it moves the catalog around the update. With --install-first, it installs those libraries first, in the form package.json gives them, and then updates the rest. No force flags, retries, resets, commits or manager provisioning.';

// Node cannot exec a Windows .cmd file without a shell. Read only the standard shim's literal script path instead.
// pnpm runs a whole hop this way, and yarn only installs a library first.
function managerCommand(cwd, name) {
  const execpath = process.env.npm_execpath && resolve(cwd, process.env.npm_execpath);
  if (execpath && existsSync(execpath)) {
    if (new RegExp(String.raw`[\\/]${name}[^\\/]*\.[cm]?js$`, 'i').test(execpath)) return { file: process.execPath, prefix: [execpath] };
    // pnpm 12 ships a native binary, and `pnpm exec` names it here.
    if (new RegExp(String.raw`[\\/]${name}(?:-[a-z]+)?(?:\.exe)?$`, 'i').test(execpath)) return { file: execpath, prefix: [] };
  }
  const corepack = process.env.COREPACK_ROOT && join(process.env.COREPACK_ROOT, 'dist', `${name}.js`);
  if (corepack && existsSync(corepack)) return { file: process.execPath, prefix: [corepack] };
  const path = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const extensions = process.platform === 'win32' ? ['.exe', '.com', '.cmd', '.bat'] : [''];
  for (const dir of path.split(delimiter).filter(Boolean)) for (const extension of extensions) {
    const file = resolve(cwd, dir, name + extension);
    if (!existsSync(file)) continue;
    if (!/\.(?:cmd|bat)$/i.test(file)) return { file, prefix: [] };
    // Corepack's shim names the same script twice, once for each way it finds Node.
    const targets = new Set([...readFileSync(file, 'utf8').matchAll(new RegExp(String.raw`"%(?:dp0%|~dp0)[\\/]?([^"\r\n%]*${name}\.[cm]?js)"`, 'gi'))].map((m) => m[1]));
    if (targets.size === 1) {
      const target = resolve(dirname(file), [...targets][0].replace(/[\\/]/g, '/'));
      if (existsSync(target)) return { file: process.execPath, prefix: [target] };
    }
    throw new Error(`Cannot resolve this ${name} shim without a shell. Use the existing Corepack or Node-script installation; no fallback was run.`);
  }
  throw new Error(`Could not find ${name}. Run the printed command with the already installed project package manager.`);
}

// For yarn, npm runs the target CLI from its own cache, as pnpm's dlx does for pnpm. Asked to update, an older CLI
// installs a temporary newer one with the project's manager, and on yarn 4 that stopped with no error. npm comes with
// Node, and its own script is run directly, with no shell.
function npmCommand() {
  // Windows keeps npm beside node.exe, and Linux and macOS keep it in lib/ beside bin/.
  const nodeDir = dirname(process.execPath);
  const script = [process.env.npm_execpath, join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    .find((file) => file && /[\\/]npm-cli\.c?js$/i.test(file) && existsSync(file));
  if (script) return { file: process.execPath, prefix: [script] };
  // Outside Windows, npm on the path is a script that Node can start without a shell.
  if (process.platform !== 'win32') return { file: 'npm', prefix: [] };
  throw new Error('Could not find npm next to Node, which runs the target Angular CLI for a yarn project. No fallback was run.');
}

// ---- pnpm catalogs ----------------------------------------------------------------------------------------------
// Angular's CLI can't change a pnpm catalog: through 21 it skips a `catalog:` package and still exits 0 having moved
// nothing, and from 22 it stops with manual steps. So for the update, each catalog entry the app uses goes into
// package.json as a plain version, and afterwards the new versions go back into the catalog and package.json goes
// back to `catalog:`. Angular's own update still does the work, with its peer checks and migrations.

// One catalog line in block style, with its key and value quoted either way or not at all, and an optional comment.
const CATALOG_ENTRY = /^(\s+)(?:'([^']+)'|"([^"]+)"|([^\s'"#:][^\s:#]*))(\s*:\s*)(?:'([^']*)'|"([^"]*)"|([^\s'"#][^#]*?))(\s*(?:#.*)?)$/;
const unchanged = 'Nothing was changed.';

function findWorkspaceFile(dir) {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, 'pnpm-workspace.yaml'))) return join(at, 'pnpm-workspace.yaml');
    if (dirname(at) === at) return null;
  }
}

// Block style only, which is how pnpm writes catalogs. Anything else is refused, never guessed at.
function readCatalogs(text) {
  const entries = [];
  let section = null, catalog = null, top = null;
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    if (!/^\s/.test(line)) {
      const head = /^(catalogs?)\s*:\s*(.*)$/.exec(line);
      section = head ? head[1] : null;
      if (head && head[2] && !head[2].startsWith('#')) throw new Error(`pnpm-workspace.yaml writes its ${head[1]} on one line, which this updater doesn't edit. ${unchanged}`);
      catalog = section === 'catalog' ? 'default' : null;
      top = null;
      return;
    }
    if (!section) return;
    const depth = line.length - line.trimStart().length;
    top ??= depth;
    if (section === 'catalogs' && depth === top) {
      const name = /^\s+(?:'([^']+)'|"([^"]+)"|([^\s'"#:]+))\s*:\s*(#.*)?$/.exec(line);
      if (!name) throw new Error(`pnpm-workspace.yaml has a catalog this updater can't read safely, on line ${index + 1}. ${unchanged}`);
      catalog = name[1] ?? name[2] ?? name[3];
      return;
    }
    const match = CATALOG_ENTRY.exec(line);
    if (!match || !catalog) throw new Error(`pnpm-workspace.yaml has a catalog line this updater can't read safely, line ${index + 1}. ${unchanged}`);
    entries.push({ catalog, name: match[2] ?? match[3] ?? match[4], spec: match[6] ?? match[7] ?? match[8], index, match, cr: raw.endsWith('\r') });
  });
  return entries;
}

// The same line with a new value, in the same quotes, keeping its comment.
function withSpec({ match, cr }, spec) {
  const key = match[2] !== undefined ? `'${match[2]}'` : match[3] !== undefined ? `"${match[3]}"` : match[4];
  const quote = match[6] !== undefined ? "'" : match[7] !== undefined ? '"' : '';
  return `${match[1]}${key}${match[5]}${quote}${spec}${quote}${match[9]}${cr ? '\r' : ''}`;
}

const asJson = (value, original) => {
  const indent = /^\{\r?\n([ \t]+)/.exec(original)?.[1] || '  ';
  const text = JSON.stringify(value, null, indent);
  return `${original.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text}${/\r?\n$/.test(original) ? (original.endsWith('\r\n') ? '\r\n' : '\n') : ''}`;
};

function inlineCatalog(cwd) {
  const pkgPath = join(cwd, 'package.json');
  const original = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(original);
  const deps = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, ref] of Object.entries(pkg[section] || {})) if (typeof ref === 'string' && ref.startsWith('catalog:')) deps.push({ section, name, ref, catalog: ref.slice('catalog:'.length) || 'default' });
  }
  if (!deps.length) return null;
  const file = findWorkspaceFile(cwd);
  if (!file) throw new Error(`package.json uses catalog: entries, but there's no pnpm-workspace.yaml above it. ${unchanged}`);
  const text = readFileSync(file, 'utf8');
  const entries = readCatalogs(text);
  for (const dep of deps) {
    dep.entry = entries.find((e) => e.catalog === dep.catalog && e.name === dep.name);
    if (!dep.entry) throw new Error(`${dep.name} comes from the ${dep.catalog} catalog, which has no entry for it. ${unchanged}`);
  }
  for (const dep of deps) pkg[dep.section][dep.name] = dep.entry.spec;
  writeFileSync(pkgPath, asJson(pkg, original));
  return { pkgPath, original, file, text, deps };
}

// After the update, the catalog gets whatever versions it wrote, and package.json goes back to `catalog:` either way.
function restoreCatalog(inlined, succeeded) {
  const pkg = JSON.parse(readFileSync(inlined.pkgPath, 'utf8'));
  const moved = [];
  if (succeeded) {
    const lines = inlined.text.split('\n');
    for (const dep of inlined.deps) {
      const now = pkg[dep.section]?.[dep.name];
      if (!now || now === dep.entry.spec) continue;
      lines[dep.entry.index] = withSpec(dep.entry, now);
      moved.push({ name: dep.name, catalog: dep.catalog, from: dep.entry.spec, to: now });
    }
    if (moved.length) writeFileSync(inlined.file, lines.join('\n'));
  }
  for (const dep of inlined.deps) (pkg[dep.section] ||= {})[dep.name] = dep.ref;
  writeFileSync(inlined.pkgPath, asJson(pkg, inlined.original));
  return moved;
}

function redact(text) {
  let value = String(text ?? '');
  for (const [key, secret] of Object.entries(process.env)) if (/token|secret|password|api.?key/i.test(key) && secret?.length >= 8) {
    for (const variant of [secret, encodeURIComponent(secret)]) value = value.split(variant).join('[redacted]');
  }
  return value.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@').replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{8,}|\bnpm_[A-Za-z0-9]{8,}/g, '[redacted]');
}

function main() {
  const { values, positionals } = parseArgs({ options: { project: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' }, 'install-first': { type: 'string', multiple: true } }, allowPositionals: true });
  if (values.help) { console.log(USAGE); return 0; }
  const requested = new Map();
  for (const spec of positionals) {
    const at = spec.lastIndexOf('@'), name = spec.slice(0, at), version = spec.slice(at + 1);
    if (at < 1 || !VALID_NAME.test(name) || !semver.validRange(version) || requested.has(name)) throw new Error('Invalid or duplicate package specifier. Use the exact packages from the plan.');
    requested.set(name, version);
  }
  // A hop names majors for both. A patch names exact versions, and may only move the CLI.
  const cli = /^@angular\/cli@(\d+)(?:\.\d+\.\d+)?$/.exec(positionals.find(spec => spec.startsWith('@angular/cli@')) || '');
  const core = positionals.find(spec => spec.startsWith('@angular/core@'));
  const major = Number(cli?.[1]);
  if (!Number.isSafeInteger(major) || major < 2 || (core && semver.coerce(core.slice('@angular/core@'.length))?.major !== major)) throw new Error('The framework requests must name the same target major for @angular/core and @angular/cli.');
  const cwd = resolve(values.project || '.');
  const yarn = existsSync(join(cwd, 'yarn.lock'));
  // From Angular CLI 22.1, ng update skips a release younger than the package manager's minimum release age and reads
  // no exemption list, while an installed release is read from node_modules. So a library the person agreed to take
  // that young is installed first, in the form package.json gives it now (^, ~ or exact, as ng update writes it), and
  // ng update moves the rest. Never Angular itself, whose migrations only ng update runs.
  const firstNames = [...new Set(values['install-first'] || [])];
  const manifest = firstNames.length ? JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) : {};
  const first = firstNames.map((name) => {
    const version = semver.valid(requested.get(name) ?? ''), now = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
    if (!version || name === '@angular/core' || name === '@angular/cli' || typeof now !== 'string' || !semver.validRange(now)) throw new Error(`--install-first takes a library the command names at an exact version, which package.json lists with a version range, and never Angular itself. ${name} isn't one. ${unchanged}`);
    return `${name}@${/^[\^~]/.exec(now)?.[0] ?? ''}${version}`;
  });
  const runner = yarn ? npmCommand() : managerCommand(cwd, 'pnpm');
  const installer = first.length ? (yarn ? managerCommand(cwd, 'yarn') : runner) : null;
  const status = (...paths) => spawnSync('git', ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', ...(paths.length ? ['--', ...paths] : [])], { cwd, encoding: 'utf8', windowsHide: true });
  const clean = status();
  if (clean.status !== 0) throw new Error('Could not verify the Git working tree. No update was run.');
  if (clean.stdout.trim()) throw new Error('Repository is not clean. Preserve and inspect the changes before another update.');
  const env = { ...process.env };
  const controls = { NG_DISABLE_VERSION_CHECK: 'true', NG_CLI_ANALYTICS: 'false', COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', COREPACK_ENV_FILE: '0', npm_config_manage_package_manager_versions: 'false', npm_config_pm_on_fail: 'error' };
  for (const key of Object.keys(env)) if (Object.keys(controls).some(owned => owned.toLowerCase() === key.toLowerCase())) delete env[key];
  Object.assign(env, controls);
  const options = { cwd, env, encoding: 'utf8', windowsHide: true, stdio: values.json ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 };
  if (first.length) {
    // pnpm keeps the lockfile beside pnpm-workspace.yaml, which can be above the app.
    const workspace = yarn ? null : findWorkspaceFile(cwd);
    const lockfile = yarn ? 'yarn.lock' : relative(cwd, join(dirname(workspace ?? join(cwd, 'package.json')), 'pnpm-lock.yaml')).replace(/\\/g, '/');
    // pnpm refuses an add in a workspace root that lists two or more package patterns, unless -w says the root is
    // meant, as it is here. Below the root, -w would add to the root instead of the app.
    const root = workspace === join(cwd, 'pnpm-workspace.yaml') && /^packages\s*:/m.test(readFileSync(workspace, 'utf8'));
    const add = spawnSync(installer.file, [...installer.prefix, 'add', ...(root ? ['-w'] : []), ...first], options);
    if (add.status !== 0) throw new Error(`Installing ${first.join(' ')} first failed, so no update was run.`);
    // The tree was clean a moment ago, so every change since is the install's. Anything past package.json and the
    // lockfile, such as a release-age exemption pnpm wrote itself, is the person's to approve, not this hop's to carry.
    const after = status(), allowed = status('package.json', lockfile);
    const extra = after.stdout.split('\n').filter((line) => line.trim() && !allowed.stdout.split('\n').includes(line)).map((line) => line.slice(3));
    if (after.status !== 0 || allowed.status !== 0 || extra.length) throw new Error(`Installing first also changed ${extra.join(', ') || 'what Git could not report'}, so no update was run. Put the tree back and reinstall before another update.`);
  }
  const inlined = yarn ? null : inlineCatalog(cwd);
  // Angular's own temporary runner uses this same child-only dispatch control. It does not bypass Git or peers.
  // With a catalog or a library installed first, the tree was clean a moment ago and the only changes since are this
  // script's own, checked above.
  const update = positionals.filter((spec) => !firstNames.includes(spec.slice(0, spec.lastIndexOf('@'))));
  const dirty = inlined || first.length ? ['--allow-dirty'] : [];
  const args = yarn ? ['exec', '--yes', `--package=${cli[0]}`, '--', 'ng', 'update', ...update, ...dirty] : ['dlx', cli[0], 'update', ...update, ...dirty];
  const run = (argv) => spawnSync(runner.file, [...runner.prefix, ...argv], options);
  const result = run(args);
  let exitCode = result.status ?? 1;
  let catalog = null, install = null;
  if (inlined) {
    catalog = restoreCatalog(inlined, exitCode === 0);
    if (exitCode === 0) {
      install = run(['install', '--no-frozen-lockfile']);
      exitCode = install.status ?? 1;
    }
    if (!values.json) for (const c of catalog) console.log(`Catalog: ${c.name} ${c.from} -> ${c.to}${c.catalog === 'default' ? '' : ` (${c.catalog})`}`);
    if (!values.json && result.status !== 0) console.error('The update failed. package.json is back on its catalog: entries, and pnpm-workspace.yaml is as it was.');
  }
  if (values.json) {
    console.log(JSON.stringify({
      exitCode, targetMajor: major, command: [yarn ? 'npm' : 'pnpm', ...args], stdout: redact(result.stdout), stderr: redact(result.stderr),
      ...(first.length ? { installedFirst: first } : {}),
      ...(inlined ? { catalog, install: install && { exitCode: install.status, stdout: redact(install.stdout), stderr: redact(install.stderr) } } : {}),
      error: result.error ? 'The update process did not finish. Inspect its outcome before another attempt.' : null,
    }, null, 2));
  } else if (result.status === null) console.error('The update process did not finish. Inspect its outcome before another attempt.');
  return exitCode;
}

try { process.exitCode = main(); }
catch (error) {
  const message = redact(error.message);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ exitCode: 1, error: message }));
  else console.error(message);
  process.exitCode = 1;
}
