// What the plan's test files share: the apps they plan, the packages and lockfiles those need, and the package
// managers' settings. Each file runs in a process of its own, and the after hook removes the apps that file made.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after } from 'node:test';
import { angular, pkg, plan, project, typescript } from './harness.mjs';

const made = [];
export const app = (opts) => { const p = project(opts); made.push(p); return p; };
after(() => made.forEach((p) => p.remove()));

export const base = { '@angular/core': '^20.0.0', '@angular/cli': '^20.0.0', typescript: '~5.8.0', rxjs: '~7.8.0' };
export const lockBase = { '@angular/core': '20.2.0', typescript: '5.8.3', rxjs: '7.8.2' };
export const world = (...extra) => [...angular(), typescript(), pkg('rxjs', { '7.8.2': {} }), ...extra];
export const libIn = (result, major, name) => result.plan.hops.find((h) => h.major === major)?.libs.find((l) => l.name === name);
export const quotePath = (value) => process.platform === 'win32' ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;

export const nebular = () => pkg('@nebular/theme', {
  '16.0.0': { peer: '^20.0.0', at: '2025-06-01', peers: { '@angular/cdk': '^20.0.0' } },
  '17.0.0': { peer: '^21.0.0', at: '2026-01-15', peers: { '@angular/cdk': '^21.0.0' } },
});

// The shape pnpm 12 writes, including the peer suffix on a resolved version.
export const pnpmImporter = (name, versions = {}) => {
  const v = { core: '20.2.0', cli: '20.2.0', lib: '20.1.0', ...versions };
  return `  ${name}:
    dependencies:
      '@angular/core':
        specifier: ^20.0.0
        version: ${v.core}(@angular/compiler@${v.core})(rxjs@7.8.2)
      rxjs:
        specifier: ~7.8.0
        version: 7.8.2
      ui-lib:
        specifier: ^20.0.0
        version: ${v.lib}(@angular/core@${v.core}(rxjs@7.8.2))
    devDependencies:
      '@angular/cli':
        specifier: ^20.0.0
        version: ${v.cli}
      typescript:
        specifier: ~5.8.0
        version: 5.8.3
`;
};
export const pnpmLock = (...importers) => `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\nimporters:\n\n${importers.join('\n')}\npackages:\n\n  '@angular/core@19.0.0':\n    resolution: {integrity: sha512-x}\n    version: 19.0.0\n`;

// A real upgrade stopped here: `Package "@nebular/eva-icons" has an incompatible peer dependency to "@nebular/theme"
// (requires "16.0.0", would install "17.0.0").`
export const nebularDeps = { ...base, '@nebular/theme': '16.0.0', '@nebular/eva-icons': '16.0.0', 'eva-icons': '1.1.3' };
export const nebularLock = { ...lockBase, '@nebular/theme': '16.0.0', '@nebular/eva-icons': '16.0.0', 'eva-icons': '1.1.3' };
export const nebularWith = (icons) => [
  pkg('@nebular/theme', { '16.0.0': { peer: '^20.0.0', at: '2025-07-01' }, '17.0.0': { peer: '^21.0.0', at: '2026-01-15' } }),
  pkg('@nebular/eva-icons', icons),
  pkg('eva-icons', { '1.1.3': {} }),
];
export const evaIcons = (version, theme) => ({ [version]: { peers: { '@nebular/theme': theme, 'eva-icons': '^1.1.3' } } });

export function nextWorld(nextVersion, ...extra) {
  const [core, compiler] = angular();
  const at = '2026-10-30T00:00:00.000Z';
  core.versions[nextVersion] = { name: '@angular/core', version: nextVersion, peerDependencies: { rxjs: '^6.5.3 || ^7.4.0' }, engines: { node: '>=18.0.0' } };
  compiler.versions[nextVersion] = { name: '@angular/compiler-cli', version: nextVersion, peerDependencies: { typescript: '>=5.9 <7' } };
  for (const doc of [core, compiler]) { doc.time[nextVersion] = at; doc['dist-tags'].next = nextVersion; }
  const cli = pkg('@angular/cli', { '20.0.0': {}, '21.0.0': {}, '22.0.0': {}, '22.2.0': {}, [nextVersion]: {} }, { next: nextVersion });
  return [core, compiler, cli, typescript(), pkg('rxjs', { '7.8.2': {} }), ...extra];
}

// An unpinned pnpm 12.16.1, with nothing set: it held a release back for a day, its default from pnpm 11, and printed
// undefined for minimum-release-age, which ng update reads as that day too.
export const pnpm12 = { '--version': '12.16.1' };
export const pnpm21 = (deps, { pin, files = {} } = {}) => app({ deps: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0', ...deps }, pin, files: { 'pnpm-lock.yaml': pnpmLock(pnpmImporter('.', { core: '21.2.0', cli: '21.2.0', lib: '21.0.0' })), ...files } });
export const yarn21 = ({ pin, files = {} } = {}) => app({ deps: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' }, pin, files: { 'yarn.lock': '', ...files } });
// An Angular 21 app on pnpm at apps/web, or another folder, below files of its own. Its own lockfile keeps the age files
// the only change.
export const webApp = (files = {}, at = 'apps/web') => {
  const p = app({ files: { [`${at}/package.json`]: JSON.stringify({ name: 'web', dependencies: { ...base, '@angular/core': '^21.0.0', '@angular/cli': '^21.0.0' } }), [`${at}/pnpm-lock.yaml`]: pnpmLock(pnpmImporter('.', { core: '21.2.0', cli: '21.2.0' })), ...files } });
  return { dir: join(p.dir, ...at.split('/')), root: p.dir };
};
// The release age the plan read, or why it couldn't.
export const ageOf = async (proj, options) => {
  const r = await plan(world(), proj, { to: 22, ...options });
  assert.ok(r.plan, r.stderr);
  return r.plan.releaseAge ?? r.plan.unchecked.find((u) => u.name === 'release age')?.reason ?? null;
};
// pnpm's global config.yaml through XDG_CONFIG_HOME, which pnpm 11 and 12 read in place of their own folder on any OS.
export const xdgWith = (text) => ({ XDG_CONFIG_HOME: app({ files: { 'pnpm/config.yaml': text } }).dir });

export const youngLib = () => pkg('ui-lib', { '21.0.0': { peer: '^21.0.0', at: '2025-12-01' }, '22.0.0': { peer: '^22.0.0', ago: 10 } });

export const npmApp = (rc) => app({ deps: { ...base, '@angular/core': '^21.0.0', 'ui-lib': '^21.0.0' }, lock: { ...lockBase, '@angular/core': '21.2.0', 'ui-lib': '21.0.0' }, files: { '.npmrc': rc } });
