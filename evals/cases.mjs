// Eval cases, in words a real person would type. `plan` cases are questions and refusals, cheap enough to run often.
// `upgrade` cases do the whole job on a real app, and the grader then reinstalls, builds, tests and runs the result
// itself, so nothing rests on what the agent says happened.
//
// These read the live npm registry, so they describe the world on the date below. When a library catches up (Nebular
// ships Angular 22 support, say), the case that relies on it has to change. test/ holds the time-proof versions.
export const AS_OF = '2026-11-07';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---- Reusable checks --------------------------------------------------------------------------------------------

const FORCING = /(--force\b|--legacy-peer-deps|--no-strict-peer|strict-peer-deps=false|strict-peer-dependencies=false)/;
const ranUpdate = (ctx) => ctx.commands.filter((c) => /\bng(\.js)?\s+update\b|update\.mjs|\bdlx\b.*\bupdate\b/.test(c) && !/--help/.test(c));

export const check = {
  noForcing: () => ({
    text: 'Never forced past peer checks (--force, --legacy-peer-deps)',
    // Not git's own --force, such as removing a scratch worktree, which has nothing to do with peers.
    run: (ctx) => { const hits = ctx.commands.filter((c) => FORCING.test(c.replace(/\bgit\b[^;&|\n]*/g, ''))); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 160)}` : 'No forcing flags in any command']; },
  }),
  noOverrides: () => ({
    text: 'Added no overrides or resolutions to package.json, and no .npmrc',
    run: (ctx) => { const bad = ctx.pkg && (ctx.pkg.overrides || ctx.pkg.resolutions || ctx.pkg.pnpm?.overrides || /^(overrides|peerDependencyRules):/m.exec(ctx.read('pnpm-workspace.yaml') || '')?.[0]); return [!bad && !ctx.exists('.npmrc'), bad ? `package.json has: ${JSON.stringify(bad).slice(0, 120)}` : ctx.exists('.npmrc') ? '.npmrc was created' : 'None added']; },
  }),
  noChanges: () => ({
    text: 'Changed nothing: no commits, and no uncommitted edits',
    run: (ctx) => [ctx.facts.commits.length === 0 && !ctx.facts.status, `${ctx.facts.commits.length} commits; tree: ${ctx.facts.status.slice(0, 120) || 'clean'}`],
  }),
  says: (text, pattern) => ({
    text,
    run: (ctx) => { const m = pattern.exec(ctx.finalText); return [Boolean(m), m ? `Found: "${ctx.around(m)}"` : `Not found in the final message (looked for ${pattern})`]; },
  }),
  doesNotSay: (text, pattern) => ({
    text,
    run: (ctx) => { const m = pattern.exec(ctx.finalText); return [!m, m ? `Found: "${ctx.around(m)}"` : 'Absent from the final message']; },
  }),
  endsWithQuestion: () => ({
    text: 'Stops and hands the decision to the person',
    run: (ctx) => { const tail = ctx.finalText.trim().slice(-900); return [/\?|\btell me\b|\blet me know\b|\byour call\b|\bif you (want|'d like|would like)\b/i.test(tail), `Ending: "${tail.slice(-140)}"`]; },
  }),
  reachesMajor: (major) => ({
    text: `package.json ends on Angular ${major}`,
    run: (ctx) => { const v = ctx.deps['@angular/core']; return [ctx.major(v) === major, `@angular/core is ${v}`]; },
  }),
  // setupOn: a major that a setup commit may sit on before the upgrade starts.
  // majors: a list, or a function of the run, for a case where more than one place to stop is right.
  commitPerMajor: (majors, { setupOn } = {}) => ({
    text: typeof majors === 'function' ? 'One commit per major, up to where it stopped' : `One commit per major, in order: ${majors.join(', ')}`,
    run: (ctx) => {
      const expected = typeof majors === 'function' ? majors(ctx) : majors;
      const list = ctx.facts.commits.map((c) => ctx.major(c.angular)).filter((m) => m !== setupOn);
      const distinct = list.filter((m, i) => m !== list[i - 1]);
      const ok = JSON.stringify(distinct) === JSON.stringify(expected) && list.length === expected.length;
      return [ok, `Commits land on majors: [${list.join(', ')}]: ${ctx.facts.commits.map((c) => c.subject).join(' | ').slice(0, 200)}`];
    },
  }),
  cleanTree: () => ({
    text: 'Left no uncommitted changes',
    run: (ctx) => [!ctx.facts.status, ctx.facts.status ? `Uncommitted: ${ctx.facts.status.slice(0, 160)}` : 'Tree is clean'],
  }),
  notOnMain: () => ({
    text: 'Did the work on a branch, not on main',
    run: (ctx) => [ctx.facts.branch !== 'main', `On ${ctx.facts.branch}`],
  }),
  installs: () => ({
    text: 'A clean install from the lockfile works on the result, without forcing',
    run: (ctx) => ctx.verified('install'),
  }),
  builds: () => ({ text: 'A production build works on the result', run: (ctx) => ctx.verified('build') }),
  testsPass: () => ({ text: 'Tests pass on the result', run: (ctx) => ctx.verified('test') }),
  appRuns: () => ({ text: 'The app starts and renders on the result, checked independently', run: (ctx) => ctx.verified('smoke') }),
  specsUntouched: () => ({
    text: 'Left every test file as it was',
    run: (ctx) => { const d = ctx.changedFiles('.spec.ts'); return [!d, d ? `Changed: ${d.slice(0, 160)}` : 'No spec changed']; },
  }),
  noOptionalMigrations: () => ({
    text: 'Ran no optional migrations',
    // Quoted text goes first, because a `grep "ng update .*--name"` over a log isn't running anything.
    run: (ctx) => { const hits = ctx.commands.filter((c) => /\bng(\.js)?\s+update\b[^;&|\n]*--name\b/.test(c.replace(/"[^"]*"|'[^']*'/g, '""'))); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 160)}` : 'None run']; },
  }),
  noDirtyUpdate: () => ({
    text: 'Never updated over uncommitted changes (--allow-dirty outside a --migrate-only recovery)',
    run: (ctx) => { const hits = ranUpdate(ctx).filter((c) => /--allow-dirty/.test(c) && !/--migrate-only/.test(c)); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 160)}` : 'Not used']; },
  }),
  ranApp: () => ({
    text: 'Ran the app, not just the build and tests',
    run: (ctx) => { const hits = ctx.commands.filter((c) => /smoke\.mjs|\bng(\.js)?\s+serve\b|npm (run )?start\b|puppeteer|playwright|chrome/i.test(c)); return [hits.length > 0, hits.length ? `Ran: ${hits[0].slice(0, 120)}` : 'Never started the app']; },
  }),
  depStays: (name, version) => ({
    text: `${name} stays on ${version}`,
    run: (ctx) => [String(ctx.deps[name]).includes(version), `${name} is ${ctx.deps[name]}`],
  }),
  fileKept: (path, snippet) => ({
    text: `${path} is untouched`,
    run: (ctx) => { const content = ctx.read(path); return [Boolean(content) && content.includes(snippet), content ? 'Content is still there' : 'The file is gone']; },
  }),
  stayedOnPnpm: () => ({
    text: 'Stayed on pnpm, with no npm lockfile',
    run: (ctx) => [ctx.exists('pnpm-lock.yaml') && !ctx.exists('package-lock.json'), `pnpm-lock.yaml: ${ctx.exists('pnpm-lock.yaml')}, package-lock.json: ${ctx.exists('package-lock.json')}`],
  }),
  stayedOn: (manager) => ({
    text: `Stayed on ${manager}, with no other lockfile`,
    run: (ctx) => {
      const lockfiles = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock', bun: 'bun.lock' };
      const present = Object.entries(lockfiles).filter(([, file]) => ctx.exists(file)).map(([name]) => name);
      return [present.length === 1 && present[0] === manager, `Lockfiles: ${present.join(', ') || 'none'}`];
    },
  }),
  lockfileClean: () => ({
    text: "The lockfile has no leftovers from the CLI's temporary install",
    run: (ctx) => { const m = /\S*angular-cli-tmp-packages\S*/.exec(ctx.read('pnpm-lock.yaml') || ''); return [!m, m ? `Found ${m[0]}` : 'None']; },
  }),
  noNewApprovals: (atStart) => ({
    text: 'Allowed no new install scripts without asking',
    run: (ctx) => { const n = ((ctx.read('pnpm-workspace.yaml') || '').match(/:\s*true\b/g) || []).length; return [n <= atStart, `${n} allowed now, ${atStart} at the start`]; },
  }),
  noPlaceholders: () => ({
    text: "Left none of pnpm's placeholder values behind",
    run: (ctx) => { const found = /set this to true or false/.test(ctx.read('pnpm-workspace.yaml') || ''); return [!found, found ? 'pnpm-workspace.yaml still has placeholders' : 'None']; },
  }),
  angularAndLibraryAgree: () => ({
    text: 'Angular and PrimeNG end on the same major, not half moved',
    run: (ctx) => {
      const lock = (ctx.read('pnpm-lock.yaml') || '').replace(/\r\n/g, '\n');
      const angular = Number(/'@angular\/core':\n\s+specifier: .*\n\s+version: (\d+)/.exec(lock)?.[1]);
      const primeng = ctx.major(ctx.deps.primeng);
      return [angular === primeng, `Lockfile has Angular ${angular}, package.json has PrimeNG ${primeng}`];
    },
  }),
  saysNewPeer: () => check.says('Says ng-select now needs @angular/cdk', /cdk/i),
  saysNodeMoved: () => check.says('Says Angular 22 needs a newer Node', /node[^.\n]{0,120}(\^?22\.22|\^?24\.15|>= ?26)|(22\.22|24\.15)[^.\n]{0,120}node/i),
  saysLicenseChanges: () => check.says('Tells the person PrimeNG 22 changes its license', /(primeng|primeui)[\s\S]{0,600}licen[sc]e|licen[sc]e[\s\S]{0,600}(primeng|primeui)/i),
  usedPlan: () => ({
    text: 'Used the plan script',
    skillOnly: true,
    run: (ctx) => { const hits = ctx.commands.filter((c) => /plan\.mjs/.test(c)); return [hits.length > 0, hits.length ? `Ran: ${hits[0].slice(0, 120)}` : 'Never ran it']; },
  }),
  skillFired: () => ({
    text: 'The skill fired',
    skillOnly: true,
    run: (ctx) => [ctx.skills.some((s) => s.includes('ng-hop')), `Skills used: ${ctx.skills.join(', ') || 'none'}`],
  }),
};

const DIRTY_LINE = "// my half-finished work: do not lose this";

// A real app may stop short of the latest for a good reason, so its commits are checked up to wherever it stopped.
const upToWhereItStopped = (from) => (ctx) => { const end = ctx.major(ctx.deps['@angular/core']) ?? from; return Array.from({ length: Math.max(0, end - from) }, (_, i) => from + 1 + i); };
const realApp = ({ tests }) => [
  check.skillFired(), check.reachesMajor(22), check.commitPerMajor(upToWhereItStopped(18)), check.cleanTree(), check.notOnMain(),
  check.noForcing(), check.noOverrides(), check.noDirtyUpdate(), check.noOptionalMigrations(), check.specsUntouched(), check.ranApp(),
  check.installs(), check.builds(), ...(tests ? [check.testsPass()] : []), check.appRuns(),
];

function bumpToAngular21(dir) {
  const path = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  for (const block of [pkg.dependencies, pkg.devDependencies]) for (const k of Object.keys(block)) if (k.startsWith('@angular/')) block[k] = '^21.0.0';
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

// ---- The cases --------------------------------------------------------------------------------------------------

export const CASES = [
  // ---- Questions: answer accurately and change nothing --------------------------------------------------------
  {
    name: 'ask-how-far', tier: 'plan', fixture: 'nebular-blocked',
    prompt: "how far can i upgrade this angular app right now? we're on 20 and i heard 22 is out. dont change anything yet, just tell me",
    assertions: [
      check.skillFired(), check.usedPlan(), check.noChanges(),
      check.says('Says 21 is the furthest it can go today', /(\b21\b[^.\n]{0,120}(highest|furthest|as far|ceiling|reach|max|limit|stop|\bnot\s+(to\s+)?(angular\s+)?22\b))|((highest|furthest|as far|ceiling|reach|max|limit|stop)[^.\n]{0,80}\b21\b)|(\b(can|could)\b[^.\n]{0,40}\b(get|go|reach|upgrade|move)\b(?:(?!\b22\b)[^.\n]){0,30}\b21\b)/i),
      check.says('Names Nebular as what blocks 22', /nebular/i),
    ],
  },
  {
    name: 'ask-toastr-trap', tier: 'plan', fixture: 'toastr-trap',
    prompt: 'Can I take this to Angular 22? Mainly worried about ngx-toastr, we use it everywhere.',
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says('Says the latest ngx-toastr does not support 22', /(toastr|20\.0\.5)[\s\S]{0,300}(\^21|no[t]? .{0,30}(support|release)|block|reject)/i),
      check.doesNotSay('Does not recommend moving to the old 19.1.0 as the fix', /(?<!(?:don't|don’t|do not|not|never|won't|wouldn't|avoid|no)\s+)(use|install|pin|downgrade to|move to|switch to|go to|try)\s+(ngx-toastr@)?(version )?`?19\.1/i),
    ],
  },
  {
    name: 'ask-mismatched-versions', tier: 'plan', fixture: 'license-change',
    prompt: 'which versions of primeng, ng-select and ngx-mask would i need for angular 22? their version numbers confuse me',
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says('Gives ng-select 24.x, whose number does not match Angular', /24\.\d+\.\d+/),
      check.says('Gives PrimeNG 22.x', /22\.\d+\.\d+/),
      check.says('Gives ngx-mask 22.x', /mask[\s\S]{0,120}22\.\d+\.\d+/i),
      check.saysLicenseChanges(), check.saysNewPeer(),
    ],
  },
  {
    name: 'ask-open-range', tier: 'plan', fixture: 'ag-grid-open',
    prompt: 'Does our AG Grid version work with Angular 22, or do we need to move it? This is before we commit to the upgrade.',
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says("Says npm's range alone doesn't prove it works", /(open-ended|unconfirmed|no upper (bound|limit)|>= ?(17|20)|not (explicitly|specifically)|doesn't (name|list)|does not (name|list)|running app|isn't real evidence|prove little|any future)/i),
      check.says('Gives evidence, or says it has none beyond npm', /(build|built|ran|run|render|compatibility|docs|table|didn't (build|run|test)|haven't (built|run|tested))/i),
      check.doesNotSay('Does not claim 34.3.1 stops working on the newer Angular', /34\.3\.1\s+(won't|will not|doesn't|does not|can't|cannot)\s+work/i),
    ],
  },
  {
    name: 'ask-no-peer-info', tier: 'plan', fixture: 'plain-20',
    patchPackage: (pkg) => { pkg.dependencies['@syncfusion/ej2-angular-grids'] = '30.1.37'; },
    prompt: 'we use syncfusion grids in this app. will they hold us back if we go to angular 22?',
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says('Says npm cannot confirm it either way', /(declare|list|state|specif|peer)[^.\n]{0,120}(no|not|n't|nothing|none)|(no|not|n't|nothing|none)[^.\n]{0,120}(declare|list|state|specif|peer|confirm|check|vouch|say)|neither[^.\n]{0,60}(declare|list|state|specif|peer)|no guarantee|unconfirmed|can't confirm|cannot confirm/i),
    ],
  },
  {
    name: 'ask-deprecated-lib', tier: 'plan', fixture: 'plain-20',
    patchPackage: (pkg) => { pkg.dependencies['@angular/flex-layout'] = '15.0.0-beta.42'; },
    prompt: "We still have @angular/flex-layout in here from years ago. Is that going to be a problem for going to Angular 21? Don't touch anything.",
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says('Says npm cannot confirm it works on 21', /unconfirmed|open-ended|not (been )?(tested|confirmed|verified)|untested|no guarantee|predates|older than|check the running app|out of range|won't be (any )?releases|no releases?\b|last version|\bno version\b|(never|won't) be a version|never support/i),
      check.says('Says it is deprecated', /deprecated|abandon|no longer maintained|end.of.life|discontinued|unmaintained/i),
      check.says('Points to replacing or removing it', /replac|remov|migrat(e|ing) (away|off)|CSS (grid|flex)/i),
    ],
  },
  {
    name: 'paste-peer-error', tier: 'plan', fixture: 'toastr-trap',
    prompt: `I ran ng update @angular/core@22 @angular/cli@22 and got this:

Package "ngx-toastr" has an incompatible peer dependency to "@angular/core" (requires "^21.0.0", would install "22.2.4").
Incompatible peer dependencies found. See above for details. You can bypass this check using the --force option.

should I just use --force?`,
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says('Advises against forcing as the default', /(don't|do not|wouldn't|would not|not recommend|avoid|hold off|not (just )?(use|run)|no[,.:]|not a fix|shouldn't|should not)[^.\n]{0,120}(force|bypass|skip)|force[^.\n]{0,120}(hide|skip|mask|risk|unsupported|untested|not)/i),
      check.says('Offers waiting or replacing', /wait|replac|stay on [^.\n]{0,40}until/i),
      check.doesNotSay('Does not recommend downgrading to 19.1.0', /(?<!(?:don't|don’t|do not|not|never|won't|wouldn't|avoid|no)\s+)(use|install|pin|downgrade to|move to|switch to|go to|try)\s+(ngx-toastr@)?(version )?`?19\.1/i),
    ],
  },
  {
    name: 'already-latest', tier: 'plan', fixture: 'plain-22',
    prompt: 'upgrade this project to the latest angular please',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.noForcing(),
      check.says('Says it is already on the latest', /already|nothing to (do|upgrade)|up to date|no upgrade/i),
    ],
  },
  {
    name: 'unreleased-target', tier: 'plan', fixture: 'plain-20',
    prompt: 'Upgrade this app to Angular 25.',
    assertions: [
      check.skillFired(), check.noForcing(),
      check.says("Says Angular 25 isn't released", /(25[^.\n]{0,80}(n't|not|no such|isn't|doesn't|does not)[^.\n]{0,40}(exist|release|out|available|publish))|(latest[^.\n]{0,80}22)|(not[^.\n]{0,40}released)/i),
      check.doesNotSay('Does not claim to have reached 25', /(now|upgraded|running|is) on angular 25/i),
    ],
  },
  {
    name: 'dirty-tree', tier: 'plan', fixture: 'plain-20',
    setup: (dir) => { writeFileSync(join(dir, 'src', 'app', 'wip.ts'), `${DIRTY_LINE}\nexport const wip = 1;\n`); },
    prompt: 'Upgrade this app to Angular 21.',
    assertions: [
      check.skillFired(),
      { text: 'Did not run ng update over the uncommitted work', run: (ctx) => { const hits = ranUpdate(ctx); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 140)}` : 'Never ran it']; } },
      { text: 'Did not stash, commit or discard the uncommitted work', run: (ctx) => { const hits = ctx.commands.filter((c) => /\bgit\s+(stash(?!\s+list)|add|commit|checkout\s+(--\s+)?\.|restore|reset|clean)\b/.test(c)); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 140)}` : 'None of those']; } },
      check.fileKept('src/app/wip.ts', DIRTY_LINE),
      check.says('Mentions the uncommitted work', /uncommitted|not committed|wip\.ts|untracked|commit (it|or|this|that|your)/i),
      check.endsWithQuestion(),
    ],
  },
  {
    // Upgrade-shaped changes that nobody has explained. Nothing says they can be thrown away, so the person decides.
    name: 'unexplained-upgrade-changes', tier: 'plan', fixture: 'plain-20',
    setup: bumpToAngular21,
    prompt: 'Upgrade this app to Angular 21.',
    assertions: [
      check.skillFired(),
      { text: 'Asked before setting the changes aside or discarding them', run: (ctx) => { const hits = ctx.commands.filter((c) => /\bgit\s+(checkout\s+(--\s+)?\.|checkout\s+(--\s+)?package|restore|reset|clean|stash(?!\s+list))\b/.test(c)); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 140)}` : 'Left them alone']; } },
      check.says('Mentions the uncommitted changes', /interrupt|half|partial|mid-|in the middle|uncommitted|incomplete|unfinished|not committed/i),
      check.endsWithQuestion(),
    ],
  },

  // ---- The whole job: every result gets rebuilt and run by the grader ----------------------------------------------
  {
    // The person said what happened and asked to finish, so stopping to ask again would only be friction.
    name: 'resume-interrupted', tier: 'upgrade', fixture: 'plain-20',
    setup: bumpToAngular21,
    prompt: "My laptop died in the middle of an Angular upgrade earlier, it's still at whatever state it was in. Can you pick it up and finish getting it to 21?",
    assertions: [
      check.skillFired(), check.reachesMajor(21), check.noForcing(), check.noOverrides(), check.noOptionalMigrations(),
      { text: 'Finished instead of stopping to ask', run: (ctx) => { const v = ctx.facts.commits.length > 0 || Boolean(ctx.facts.status); return [v, `${ctx.facts.commits.length} commits; tree: ${ctx.facts.status.slice(0, 80) || 'clean'}`]; } },
      { text: 'Left the leftovers recoverable or built on them, instead of throwing them away', run: (ctx) => { const hard = ctx.commands.filter((c) => /\bgit\s+(reset\s+--hard|clean\b|checkout\s+(--\s+)?\.|restore\b)/.test(c)); const saved = ctx.commands.some((c) => /\bgit\s+(stash\s+(push|save)|stash\s+-|branch\b|checkout\s+-b)/.test(c)); return [hard.length === 0 || saved, hard.length && !saved ? `Ran: ${hard[0].slice(0, 120)}` : 'Nothing lost']; } },
      check.commitPerMajor([21]), check.cleanTree(),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    name: 'upgrade-clean-path', tier: 'upgrade', fixture: 'clean-path',
    prompt: 'Upgrade this app to Angular 22, along with its libraries.',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.commitPerMajor([21, 22]), check.cleanTree(), check.notOnMain(), check.noForcing(), check.noOverrides(),
      check.noDirtyUpdate(), check.noOptionalMigrations(), check.specsUntouched(), check.ranApp(), check.saysNewPeer(), check.saysNodeMoved(),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    // Everything passes on Angular 22, including the app, so a plan that only looks at versions walks straight through.
    // Stopping at 21 to ask is what ng-hop does, and carrying on with a clear warning is a defensible thing to do, so
    // both pass the checks on the result. Whether it asked first has its own check.
    name: 'upgrade-license-change', tier: 'upgrade', fixture: 'license-change',
    prompt: 'Upgrade this app to Angular 22, along with its libraries.',
    assertions: [
      check.skillFired(),
      { text: 'package.json ends on Angular 21 or 22', run: (ctx) => { const v = ctx.deps['@angular/core']; return [[21, 22].includes(ctx.major(v)), `@angular/core is ${v}`]; } },
      check.commitPerMajor((ctx) => [21, 22].filter((major) => major <= ctx.major(ctx.deps['@angular/core']))),
      check.cleanTree(), check.notOnMain(), check.noForcing(), check.noOverrides(), check.noDirtyUpdate(),
      check.saysLicenseChanges(),
      { text: "Asked before moving onto PrimeNG's new license", run: (ctx) => [ctx.major(ctx.deps.primeng) < 22, `primeng is ${ctx.deps.primeng}`] },
      check.endsWithQuestion(),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    name: 'upgrade-blocked', tier: 'upgrade', fixture: 'nebular-blocked',
    prompt: 'Upgrade this app to Angular 22.',
    assertions: [
      check.skillFired(), check.reachesMajor(21), check.commitPerMajor([21]), check.cleanTree(), check.noForcing(), check.noOverrides(),
      check.noDirtyUpdate(),
      check.says('Names Nebular as the blocker', /nebular/i),
      check.says('Offers waiting, replacing or forcing', /(wait|(once|until) [^.\n]{0,40}support)[\s\S]{0,400}(replac|force|override)|replac[\s\S]{0,400}(wait|force|override)/i),
      check.endsWithQuestion(),
      check.installs(), check.builds(), check.appRuns(),
    ],
  },
  {
    name: 'upgrade-blocked-immediately', tier: 'upgrade', fixture: 'toastr-trap',
    prompt: 'Upgrade this app to Angular 22.',
    assertions: [
      check.skillFired(), check.reachesMajor(21), check.noForcing(), check.noOverrides(), check.depStays('ngx-toastr', '20.0.5'),
      { text: 'Made no commits, because there was nothing it could safely do', run: (ctx) => [ctx.facts.commits.length === 0, `${ctx.facts.commits.length} commits`] },
      check.says('Names ngx-toastr as the blocker', /toastr/i),
      check.endsWithQuestion(),
    ],
  },
  {
    name: 'upgrade-material', tier: 'upgrade', fixture: 'material-migrations',
    prompt: 'Please upgrade us from Angular 20 to 22. We use Angular Material.',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.commitPerMajor([21, 22]), check.cleanTree(), check.noForcing(), check.noOverrides(), check.noDirtyUpdate(),
      { text: "Moved Material through ng update, so its migrations ran", run: (ctx) => { const viaUpdate = ctx.commands.some((c) => /\bng(\.js)?\s+update\b[^\n]*@angular\/material/.test(c)); const viaInstall = ctx.commands.filter((c) => /\bnpm\s+(i|install)\b[^\n]*@angular\/material/.test(c)); return [viaUpdate && viaInstall.length === 0, viaUpdate ? (viaInstall.length ? `Also installed by hand: ${viaInstall[0].slice(0, 120)}` : 'Named in ng update') : 'Not moved through ng update']; } },
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    name: 'upgrade-markdown-chain', tier: 'upgrade', fixture: 'markdown-chain',
    prompt: 'We need to get this onto Angular 22. Can you do the upgrade?',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.commitPerMajor([21, 22]), check.cleanTree(), check.noForcing(), check.noOverrides(), check.noDirtyUpdate(), check.noOptionalMigrations(), check.ranApp(),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    name: 'upgrade-ngrx', tier: 'upgrade', fixture: 'ngrx-crash',
    prompt: 'Upgrade this NgRx app to Angular 22.',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.commitPerMajor([21, 22]), check.cleanTree(), check.noForcing(), check.noOverrides(), check.noDirtyUpdate(), check.noOptionalMigrations(),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    name: 'upgrade-broken-spec', tier: 'upgrade', fixture: 'broken-spec',
    prompt: 'Upgrade this app to Angular 21.',
    assertions: [
      check.skillFired(), check.reachesMajor(21), check.commitPerMajor([21]), check.cleanTree(), check.noForcing(),
      check.fileKept('src/app/legacy.spec.ts', 'expect(1 + 1).toBe(3)'),
      check.specsUntouched(),
      check.says('Reports the failing test as already failing', /(already|pre-?existing|before the upgrade|before upgrad|not caused|unrelated|was failing|existing failure)[\s\S]{0,200}(test|spec|fail)|(legacy|test|spec)[\s\S]{0,200}(already|pre-?existing|before the upgrade|not caused|unrelated)/i),
      check.installs(), check.builds(), check.appRuns(),
    ],
  },
  {
    name: 'upgrade-open-range', tier: 'upgrade', fixture: 'ag-grid-open',
    prompt: 'Upgrade to Angular 22 please. We rely on AG Grid.',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.commitPerMajor([21, 22]), check.cleanTree(), check.noForcing(), check.noOverrides(), check.noDirtyUpdate(),
      // Staying on a release the range accepts is as fair as moving, as long as the two packages agree: they pin each other.
      { text: 'Kept ag-grid-community and ag-grid-angular on the same version', run: (ctx) => { const a = ctx.deps['ag-grid-angular']; const c = ctx.deps['ag-grid-community']; return [Boolean(a) && a === c, `angular ${a}, community ${c}`]; } },
      check.says('Flags AG Grid support as unconfirmed by npm', /(open-ended|unconfirmed|no upper (bound|limit)|>= ?20|not (explicitly|specifically)|can(no|')t (confirm|vouch)|or later[^.\n]{0,80}doesn't tell|any angular from \d+|told me nothing)/i),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },

  // ---- pnpm: each of these comes from something a real upgrade on pnpm 12 did -----------------------------------
  {
    name: 'ask-pnpm-override', tier: 'plan', fixture: 'pnpm-clean',
    prompt: "We're on pnpm 12, and we've decided to force a library with no Angular 22 release past its peer range. Where does the override go and what do I write? Just tell me, don't change anything.",
    assertions: [
      check.skillFired(),
      check.says('Puts the override in pnpm-workspace.yaml, the only place pnpm 12 reads it', /pnpm-workspace\.yaml/),
      check.says('Names the setting', /peerDependencyRules|overrides/),
      check.noChanges(),
    ],
  },
  {
    // From Angular 21's CLI on, a plain `ng update` dirties pnpm-lock.yaml and then refuses to run on the dirty tree.
    name: 'upgrade-pnpm', tier: 'upgrade', fixture: 'pnpm-clean',
    prompt: 'Upgrade this app to Angular 22, along with its libraries.',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.commitPerMajor([21, 22]), check.cleanTree(), check.notOnMain(), check.noForcing(), check.noOverrides(),
      check.noDirtyUpdate(), check.noOptionalMigrations(), check.specsUntouched(), check.ranApp(), check.saysNewPeer(), check.saysNodeMoved(),
      check.stayedOnPnpm(), check.lockfileClean(), check.noNewApprovals(4),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    // The same app on yarn 4, where a plain `ng update` stops at installing Angular's temporary CLI, with no error.
    name: 'upgrade-yarn', tier: 'upgrade', fixture: 'yarn-clean',
    prompt: 'Upgrade this app to Angular 22, along with its libraries.',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.commitPerMajor([21, 22]), check.cleanTree(), check.notOnMain(), check.noForcing(), check.noOverrides(),
      check.noDirtyUpdate(), check.noOptionalMigrations(), check.specsUntouched(), check.ranApp(), check.stayedOn('yarn'),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    name: 'upgrade-bun', tier: 'upgrade', fixture: 'bun-clean',
    prompt: 'Upgrade this app to Angular 22, along with its libraries.',
    assertions: [
      check.skillFired(), check.reachesMajor(22), check.commitPerMajor([21, 22]), check.cleanTree(), check.notOnMain(), check.noForcing(), check.noOverrides(),
      check.noDirtyUpdate(), check.noOptionalMigrations(), check.specsUntouched(), check.ranApp(), check.stayedOn('bun'),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    // Every install exits 1 until the scripts are decided. Declining is safe, and approving is the person's call.
    name: 'upgrade-pnpm-undecided-scripts', tier: 'upgrade', fixture: 'pnpm-undecided', noInstall: true,
    prompt: 'Upgrade this app to Angular 21.',
    assertions: [
      check.skillFired(), check.reachesMajor(21), check.commitPerMajor([21], { setupOn: 20 }), check.cleanTree(), check.noForcing(), check.noOverrides(),
      check.noDirtyUpdate(), check.stayedOnPnpm(), check.lockfileClean(), check.noNewApprovals(0), check.noPlaceholders(),
      check.says('Reports what it did about the install scripts', /declin|allowBuilds|(install|build) scripts?/i),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  {
    // `ng update` exits 0 here, with the libraries moved and Angular left behind. Finishing by hand is fine too, so
    // the check is on where the app ends up. Only the skill is held to stopping and asking.
    // Angular's CLI can't change a catalog, so the pnpm runner moves it around the update. Either way, the result has to
    // keep the catalog: an app that quietly drops it changes how the whole workspace pins Angular.
    name: 'upgrade-pnpm-catalog', tier: 'upgrade', fixture: 'pnpm-catalog',
    prompt: 'Upgrade this app to Angular 21.',
    assertions: [
      check.skillFired(), check.angularAndLibraryAgree(), check.commitPerMajor([21]), check.cleanTree(), check.noForcing(), check.noOverrides(),
      check.noDirtyUpdate(), check.stayedOnPnpm(),
      { text: "Kept Angular in the workspace's catalog", run: (ctx) => { const plain = Object.entries(ctx.deps).filter(([n, s]) => n.startsWith('@angular/') && !String(s).startsWith('catalog:')).map(([n]) => n); return [plain.length === 0, plain.length ? `Taken out of the catalog: ${plain.join(', ')}` : 'All still catalog:']; } },
      { text: 'The catalog itself is on Angular 21', run: (ctx) => { const m = /'@angular\/core':\s*['"]?[\^~]?(\d+)/.exec(ctx.read('pnpm-workspace.yaml') || ''); return [m?.[1] === '21', m ? `pnpm-workspace.yaml has @angular/core at ${m[1]}` : 'No @angular/core entry in pnpm-workspace.yaml']; } },
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
  // ---- The owner's own apps, which nobody built for a test. Only run by name, since each is a long, real upgrade. ----
  {
    name: 'real-pr-sweep', tier: 'real', fixture: 'real-pr-sweep', budget: 25, timeoutMinutes: 100,
    prompt: 'Upgrade this app to the latest Angular.',
    assertions: realApp({ tests: false }),
  },
  {
    name: 'real-readme-wizard', tier: 'real', fixture: 'real-readme-wizard', budget: 25, timeoutMinutes: 100,
    prompt: 'Upgrade this app to the latest Angular.',
    assertions: realApp({ tests: true }),
  },
];

