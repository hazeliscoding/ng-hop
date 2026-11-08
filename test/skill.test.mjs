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

test('a question about a license change still leaves the major committed', () => {
  // An eval run stopped to ask with Angular 22 uncommitted. Every stop has to be safe, and a commit on a branch binds nobody.
  const trouble = readFileSync(join(SKILL_DIR, 'references', 'troubleshooting.md'), 'utf8');
  const section = trouble.slice(trouble.indexOf('Invalid PrimeUI License'), trouble.indexOf('A file named in `angular.json`'));
  assert.match(section, /Commit the major first/);
});

test('the skill says what to do when the plan warns about a license', () => {
  // Five of six eval runs moved an app onto a commercial license without a word, while every check passed.
  const rule = skill.split('\n').find((line) => line.includes('license changes on a major'));
  assert.ok(rule, 'the skill has to answer the note plan.mjs prints');
  assert.match(rule, /stop/);
  assert.match(rule, /ask/);
  assert.match(readFileSync(join(SKILL_DIR, 'scripts', 'plan.mjs'), 'utf8'), /its license changes/);
});

test('the skill stops to ask when no unit test can run, as the roadmap decided', () => {
  // On readme-wizard one spec that didn't compile kept Karma from running any of 20, and the report called it one failure.
  const rule = skill.split('\n').find((line) => line.includes('If no test can run at all'));
  assert.ok(rule, 'step 3 has to say what to do when no test can run');
  assert.match(rule, /like a failing build: say so and ask/);
  assert.match(rule, /Found 1 load error/);
});

test('the skill only aims at a prerelease when someone asks to try one', () => {
  const rule = skill.split('\n').find((line) => line.includes('`--next`'));
  assert.ok(rule, 'the skill has to say when to use --next');
  assert.match(rule, /only then/);
  assert.match(readFileSync(join(SKILL_DIR, 'scripts', 'plan.mjs'), 'utf8'), /--next/);
});

// The section of troubleshooting.md that holds this text, which is also the positive control that it's still there.
function troubleSection(text) {
  const trouble = readFileSync(join(SKILL_DIR, 'references', 'troubleshooting.md'), 'utf8');
  const at = trouble.indexOf(text);
  assert.ok(at >= 0, `troubleshooting.md has to keep ${text}`);
  const end = trouble.indexOf('\n## ', at);
  return trouble.slice(trouble.lastIndexOf('\n## ', at), end < 0 ? undefined : end);
}
const youngRelease = 'Package "@acme/ui-core" has an incompatible peer dependency to "@angular/common" (requires "^21.2.0", would install "22.2.5")';

test('a release too young for ng update is blamed on its own filter, with a check that works', () => {
  // pnpm 12.16.1 let a release ten minutes old in when asked by name, and wrote the exemption itself. Angular CLI 22.1's
  // resolver is what skipped it, and `pnpm config get minimumReleaseAge` printed undefined for the one-day default.
  const section = troubleSection(youngRelease);
  assert.doesNotMatch(section, /won't resolve a version younger/);
  assert.match(section, /prints `undefined`/);
  assert.match(section, /npm view <package> time/);
});

test('a release too young for ng update is covered on yarn 4.15 and newer too', () => {
  // yarn 4.10.1 added npmMinimalAgeGate at 0, and 4.15.0 made it a day by default. 4.18.1 printed 1440 for it and
  // refused a release itself until .yarnrc.yml preapproved it.
  const section = troubleSection(youngRelease);
  assert.match(section, /npmPreapprovedPackages/);
  assert.match(section, /YN0016/);
  const pointer = readFileSync(join(SKILL_DIR, 'references', 'troubleshooting.md'), 'utf8').split('\n').find((line) => line.includes("still quotes the old release's peers"));
  assert.ok(pointer, 'the peer-error section has to point here');
  assert.match(pointer, /yarn 4\.15 or newer/);
  assert.match(readFileSync(join(SKILL_DIR, 'references', 'libraries.md'), 'utf8'), /pnpm 11 or newer, or yarn 4\.15 or newer/);
});

test('a release too young for ng update goes in first through update.mjs, never with --allow-dirty by hand', () => {
  // update.mjs rejects --allow-dirty and refuses a dirty tree, so the old step couldn't run, and installing a library
  // first skips its migrations.
  const section = troubleSection(youngRelease);
  assert.match(section, /--install-first/);
  assert.match(section, /ships migrations/);
  assert.doesNotMatch(section, /with `--allow-dirty`/);
  assert.match(readFileSync(join(SKILL_DIR, 'scripts', 'update.mjs'), 'utf8'), /'install-first'/);
});

test('a release-age exemption waits for the person, like an override', () => {
  // It turns off a guard against a compromised release, and pnpm writes one without asking.
  const rule = skill.split('\n').find((line) => line.includes('npmPreapprovedPackages') && line.includes("without the person's approval"));
  assert.ok(rule, 'the scope list has to name release-age exemptions');
  assert.match(rule, /minimumReleaseAgeExclude/);
});

test('putting the tree back reaches a pnpm workspace root above the app', () => {
  // pnpm writes an app's lockfile and exemptions at the workspace root, and git 2.55's `git restore .` run in the app's
  // folder left them changed, so the next update.mjs refused a tree that wasn't clean.
  const docs = [skill, ...readdirSync(join(SKILL_DIR, 'references')).map((f) => readFileSync(join(SKILL_DIR, 'references', f), 'utf8'))];
  assert.ok(docs.some((d) => d.includes('`git restore :/`')), 'positive control: the docs still say how to put the tree back');
  for (const doc of docs) assert.doesNotMatch(doc, /git restore \.(?:[\s`]|$)/m);
});

// One lettered step of the upgrade loop in SKILL.md, from its bold label to the next one.
function step(letter) {
  const start = skill.indexOf(`**${letter}. `);
  assert.ok(start >= 0, `SKILL.md has a step ${letter}`);
  const next = skill.indexOf(`**${String.fromCharCode(letter.charCodeAt(0) + 1)}. `, start);
  return skill.slice(start, next < 0 ? undefined : next);
}

test('installing what ng update left behind watches for an exemption pnpm writes on its own', () => {
  // pnpm 12.16.1's `pnpm add` of a release under a day old wrote one into pnpm-workspace.yaml without asking, and
  // taking out only that entry left the release in the lockfile.
  assert.match(step('e'), /Install anything the plan/, 'positive control: this is the step that installs');
  assert.match(step('e'), /minimumReleaseAgeExclude/);
});

test('the skill raises the Node pins the plan names when the app is already on the target', () => {
  // On Angular 22 with a dev container still on node:22.12.0, the plan named the pin under "Nothing to upgrade", and the
  // skill's already-there path ended with "That's the whole job".
  const label = skill.split('\n').find((line) => line.includes('Node pins below what Angular'));
  assert.ok(label, 'the skill has to answer the line plan.mjs prints');
  assert.match(readFileSync(join(SKILL_DIR, 'scripts', 'plan.mjs'), 'utf8'), /Node pins below what Angular/);
  const already = skill.split('\n').find((line) => line.includes("If it's already on the target major"));
  assert.ok(already, 'positive control: step 2 has an already-there path');
  assert.match(already, /Node pins/);
});

test('the skill looks for Node pins past the files the plan reads', () => {
  // The plan reads a fixed set of files, and passes over a version it can't read, such as lts/iron in .nvmrc. An agent
  // that took its list as complete would repeat the enterprise run's missed dev container.
  assert.match(step('e'), /Raise each Node pin the plan lists/, 'positive control: this is the step that raises pins');
  assert.match(step('e'), /search the repo for other pins/);
  assert.match(step('e'), /where you looked/);
});

test('a Node pin outside the app\'s folder is raised only when it builds, tests or runs this app', () => {
  // The plan also reads the repo root's package.json, Dockerfile and workflows, which in a monorepo can belong to another
  // service, and this app's checks can't catch what raising its Node does there.
  assert.match(step('e'), /Raise each Node pin the plan lists/, 'positive control: this is the step that raises pins');
  assert.match(step('e'), /starts with `\.\.\/`/);
  assert.match(step('e'), /builds, tests or runs this app/);
});

const libraries = () => readFileSync(join(SKILL_DIR, 'references', 'libraries.md'), 'utf8');

test('a workspace of several libraries builds with its own scripts, not plain ng build', () => {
  // Angular CLI 22.2.6's ng build at the root of acme-ui stopped with this, and step 3 says to stop when the build fails.
  assert.match(libraries(), /Cannot determine project for command/);
});

test('the publish question says the code is unpushed, and where a dry run says it would go', () => {
  // A dry run of pnpm 12.16.1 sent a library to its publishConfig registry over the workspace's .npmrc, npm 11.19.0 the
  // other way round, and run from inside dist both named the public registry.
  const publish = libraries().slice(libraries().indexOf('## Publishing waits for the person'));
  assert.match(publish, /stop before it/, 'positive control: this is the publish step');
  assert.match(publish, /--dry-run/);
  assert.match(publish, /pushed/);
});

test('a blocker whose scope has a registry of its own is confirmed as the team\'s before upgrading it first', () => {
  // Infragistics and Font Awesome Pro have customers give their scope a registry of its own, which the plan flags the
  // same way, and for a vendor's maintained library waiting is the usual advice.
  const blocked = readFileSync(join(SKILL_DIR, 'references', 'blocked.md'), 'utf8');
  const own = blocked.split('\n').find((line) => line.startsWith("- **Whether it's the person's own.**"));
  assert.ok(own, 'positive control: blocked.md asks whether a blocker is theirs');
  assert.match(own, /vendor/);
  assert.match(own, /npm view <package> repository\.url author/);
  assert.doesNotMatch(skill, /when the plan says it comes from their own registry/);
});

test('the team\'s libraries go only to the major the app needs next, since the app moves one major at a time', () => {
  // On the fake registry, an app on Angular 20 whose library had a release for 22 and none for 21 was still blocked at 21.
  assert.match(libraries(), /--to <major>/);
  assert.match(readFileSync(join(SKILL_DIR, 'references', 'blocked.md'), 'utf8'), /to the Angular major the plan names/);
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
