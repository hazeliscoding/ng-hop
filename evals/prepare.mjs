#!/usr/bin/env node
// Builds each fixture app once into the workspace, then proves it before any eval relies on it: it must build, and
// its tests must do what the fixture says they do. A fixture that's broken at the start would make every result a lie.
// Usage: node evals/prepare.mjs [fixture ...]
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FIXTURES } from './fixtures.mjs';
import { developerEnv, TEMPLATES, testCommand } from './common.mjs';

const run = (cmd, cwd, opts = {}) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8', timeout: 600000, env: developerEnv({ NG_CLI_ANALYTICS: 'false' }), ...opts });

function moveAngularToCatalog(dir) {
  const path = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const catalog = [];
  for (const block of [pkg.dependencies, pkg.devDependencies]) {
    for (const name of Object.keys(block || {})) {
      if (!name.startsWith('@angular/')) continue;
      catalog.push(`  '${name}': '${block[name]}'`);
      block[name] = 'catalog:';
    }
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  appendFileSync(join(dir, 'pnpm-workspace.yaml'), `catalog:\n${catalog.join('\n')}\n`);
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FIXTURES);
mkdirSync(TEMPLATES, { recursive: true });

for (const name of names) {
  const fixture = FIXTURES[name];
  if (!fixture) throw new Error(`No fixture named ${name}`);
  const dir = join(TEMPLATES, name);
  if (existsSync(join(dir, '.ng-hop-ok'))) { console.log(`${name}: already prepared`); continue; }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  try {
    const manager = fixture.packageManager || 'npm';
    const pnpm = manager === 'pnpm';
    run(`npx -y @angular/cli@${fixture.angular} new fixture-app --directory=. --defaults --skip-git --skip-install --ssr=false --style=css --routing=true${manager === 'npm' ? '' : ` --package-manager=${manager}`}`, dir);
    for (const [path, content] of Object.entries(fixture.files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    if (fixture.styles || fixture.scripts || fixture.noBudgets) {
      const ng = JSON.parse(readFileSync(join(dir, 'angular.json'), 'utf8'));
      const build = Object.values(ng.projects)[0].architect.build;
      const options = build.options;
      if (fixture.styles) options.styles = [...fixture.styles, ...(options.styles || [])];
      if (fixture.scripts) options.scripts = fixture.scripts;
      if (fixture.noBudgets) build.configurations.production.budgets = [];
      writeFileSync(join(dir, 'angular.json'), `${JSON.stringify(ng, null, 2)}\n`);
    }
    if (pnpm) {
      // Scripts off is the only way to install an undecided project without pnpm writing its placeholder file.
      const flags = fixture.undecidedScripts ? ' --ignore-scripts' : '';
      run(`pnpm install${flags}`, dir);
      if (fixture.install.length) run(`pnpm add --save-exact${flags} ${fixture.install.join(' ')}`, dir);
      if (fixture.catalog) {
        moveAngularToCatalog(dir);
        run('pnpm install', dir);
      }
    } else if (manager === 'yarn') {
      // yarn 2 and newer default to Plug'n'Play, which Angular apps turn off in practice.
      writeFileSync(join(dir, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
      appendFileSync(join(dir, '.gitignore'), '\n.yarn/\n');
      run('yarn install', dir);
      if (fixture.install.length) run(`yarn add --exact ${fixture.install.join(' ')}`, dir);
    } else if (manager === 'bun') {
      run('bun install', dir);
      if (fixture.install.length) run(`bun add --exact ${fixture.install.join(' ')}`, dir);
    } else {
      run('npm install --no-audit --no-fund', dir);
      if (fixture.install.length) run(`npm install --no-audit --no-fund --save-exact ${fixture.install.join(' ')}`, dir);
    }
    run('npx ng build', dir);
    let testsPass = true;
    try { run(testCommand(dir), dir); } catch { testsPass = false; }
    if (testsPass === Boolean(fixture.expectBaselineTestFailure)) {
      throw new Error(`tests ${testsPass ? 'passed' : 'failed'}, which is not what this fixture promises`);
    }
    run('git init -q -b main && git add -A && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -q -m "chore: start of the fixture app"', dir);
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '.ng-hop-ok\n');
    writeFileSync(join(dir, '.ng-hop-ok'), new Date().toISOString());
    const core = JSON.parse(readFileSync(join(dir, 'node_modules/@angular/core/package.json'), 'utf8')).version;
    console.log(`${name}: ok on Angular ${core}, tests ${testsPass ? 'pass' : 'fail as intended'}, ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    console.log(`${name}: FAILED: ${String(err.stderr || err.stdout || err.message).split('\n').filter((l) => /error|ERR!|failed|Cannot|TS\d+/i.test(l)).slice(0, 14).join(' | ').slice(0, 1400) || err.message.slice(0, 400)}`);
    process.exitCode = 1;
  }
}
