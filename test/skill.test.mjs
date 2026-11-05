// Structural rules from AGENTS.md, as tests, because a rule that only lives in a document erodes.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = join(ROOT, 'plugins', 'ng-hop', 'skills', 'ng-hop');
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)[1];
const description = /description:\s*>-\r?\n([\s\S]*)/.exec(frontmatter)[1].replace(/\s+/g, ' ').trim();

test('the skill name matches its folder and the plugin', () => {
  assert.match(frontmatter, /^name: ng-hop$/m);
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'plugins', 'ng-hop', '.claude-plugin', 'plugin.json'), 'utf8')).name, 'ng-hop');
});

test('the description fits the limit and says when to use and not use it', () => {
  assert.ok(description.length <= 1024, `${description.length} characters`);
  assert.match(description, /Use this whenever/);
  assert.match(description, /Not for AngularJS/);
});

test('SKILL.md stays under 500 lines', () => {
  assert.ok(skill.split('\n').length < 500);
});

test('every file the skill names exists', () => {
  for (const [, path] of skill.matchAll(/`(references\/[\w.-]+)`/g)) assert.ok(existsSync(join(SKILL_DIR, path)), path);
  for (const [, script] of skill.matchAll(/\$SCRIPTS\/([\w.-]+)/g)) assert.ok(existsSync(join(SKILL_DIR, 'scripts', script)), script);
});

test('every reference and script is reachable from the skill, so nothing ships unused', () => {
  for (const file of readdirSync(join(SKILL_DIR, 'references'))) assert.ok(skill.includes(file) || readFileSync(join(SKILL_DIR, 'references', 'troubleshooting.md'), 'utf8').includes(file), file);
  for (const file of readdirSync(join(SKILL_DIR, 'scripts')).filter((f) => f.endsWith('.mjs'))) assert.ok(skill.includes(file), file);
});

test('the scripts import nothing but Node and the vendored parser', () => {
  for (const file of readdirSync(join(SKILL_DIR, 'scripts')).filter((f) => f.endsWith('.mjs'))) {
    const source = readFileSync(join(SKILL_DIR, 'scripts', file), 'utf8');
    for (const [, spec] of source.matchAll(/from '([^']+)'/g)) assert.match(spec, /^node:/, `${file} imports ${spec}`);
    for (const [, spec] of source.matchAll(/require\)?\(import\.meta\.url\)\('([^']+)'\)/g)) assert.equal(spec, './vendor/semver.cjs');
  }
});

test('the scripts run npm with no shell, because package.json is untrusted', () => {
  const plan = readFileSync(join(SKILL_DIR, 'scripts', 'plan.mjs'), 'utf8');
  assert.doesNotMatch(plan, /shell:\s*true/);
  assert.doesNotMatch(plan, /shell:\s*process/);
  assert.doesNotMatch(plan, /\bexecSync\b/);
});

test('the skill only ever mentions forcing as something the person must approve', () => {
  const lines = skill.split('\n').filter((l) => /--force|--legacy-peer-deps/.test(l));
  assert.ok(lines.length > 0, 'positive control: the rule itself must mention them');
  for (const line of lines) assert.match(line, /unnecessary|without the person's approval|Don't try/, line);
});

test('nothing tells an agent to run plain npx ng, which can download an unrelated package', () => {
  const docs = [skill, ...readdirSync(join(SKILL_DIR, 'references')).map((f) => readFileSync(join(SKILL_DIR, 'references', f), 'utf8'))];
  assert.ok(docs.some((d) => /npx --no-install ng /.test(d)), 'positive control: the safe form is in use');
  for (const doc of docs) assert.doesNotMatch(doc, /npx ng\b/);
  assert.doesNotMatch(readFileSync(join(SKILL_DIR, 'scripts', 'plan.mjs'), 'utf8'), /['"`]npx['"`]\s*[,}]/);
});

test('the force recipe puts a pnpm override where pnpm 11 and newer read it', () => {
  // pnpm says so itself: The "pnpm" field in package.json is no longer read by pnpm.
  const blocked = readFileSync(join(SKILL_DIR, 'references', 'blocked.md'), 'utf8');
  assert.match(blocked, /`peerDependencyRules\.allowedVersions` in `pnpm-workspace\.yaml`/);
});

test('undecided pnpm install scripts are declined, and approving one is left to the person', () => {
  // Approving runs third-party code on every install. Declining is pnpm's own default and is easy to reverse.
  const trouble = readFileSync(join(SKILL_DIR, 'references', 'troubleshooting.md'), 'utf8');
  assert.match(trouble, /ERR_PNPM_IGNORED_BUILDS/);
  assert.match(trouble, /Unable to install packages/);
  assert.match(trouble, /Don't approve/);
  assert.doesNotMatch(`${skill}\n${trouble}`, /run `pnpm approve-builds/i);
});

test('the marketplace points at the plugin', () => {
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.ok(existsSync(join(ROOT, market.plugins[0].source, '.claude-plugin', 'plugin.json')));
});

test('the agent files are committed, because the global gitignore hides them', () => {
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^!AGENTS\.md$/m);
  assert.match(ignore, /^!CLAUDE\.md$/m);
  assert.match(ignore, /^!\.claude-plugin\/$/m, 'without this the plugin cannot be installed from GitHub');
});

test('the vendored parser works and names its version', () => {
  const header = readFileSync(join(SKILL_DIR, 'scripts', 'vendor', 'semver.cjs'), 'utf8').split('\n')[0];
  const version = /semver (\d+\.\d+\.\d+)/.exec(header)[1];
  assert.match(readFileSync(join(SKILL_DIR, 'scripts', 'vendor', 'VENDORED.md'), 'utf8'), new RegExp(version.replace(/\./g, '\\.')));
});
