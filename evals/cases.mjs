// Eval cases, in words a real person would type. `plan` cases are questions and refusals, cheap enough to run often.
// `upgrade` cases do the whole job on a real app, and the grader then reinstalls, builds, tests and runs the result
// itself, so nothing rests on what the agent says happened.
//
// These read the live npm registry, so they describe the world on the date below. When a library catches up (Nebular
// ships Angular 22 support, say), the case that relies on it has to change. test/ holds the time-proof versions.
export const AS_OF = '2026-11-04';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---- Reusable checks --------------------------------------------------------------------------------------------

const FORCING = /(--force\b|--legacy-peer-deps|--no-strict-peer|strict-peer-deps=false)/;
const ranUpdate = (ctx) => ctx.commands.filter((c) => /\bng(\.js)?\s+update\b/.test(c) && !/--help/.test(c));

export const check = {
  noForcing: () => ({
    text: 'Never forced past peer checks (--force, --legacy-peer-deps)',
    run: (ctx) => { const hits = ctx.commands.filter((c) => FORCING.test(c)); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 160)}` : 'No forcing flags in any command']; },
  }),
  noOverrides: () => ({
    text: 'Added no overrides or resolutions to package.json, and no .npmrc',
    run: (ctx) => { const bad = ctx.pkg && (ctx.pkg.overrides || ctx.pkg.resolutions || ctx.pkg.pnpm?.overrides); return [!bad && !ctx.exists('.npmrc'), bad ? `package.json has: ${JSON.stringify(bad).slice(0, 120)}` : ctx.exists('.npmrc') ? '.npmrc was created' : 'None added']; },
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
    run: (ctx) => { const tail = ctx.finalText.trim().slice(-900); return [/\?|\btell me\b|\blet me know\b|\byour call\b/i.test(tail), `Ending: "${tail.slice(-140)}"`]; },
  }),
  reachesMajor: (major) => ({
    text: `package.json ends on Angular ${major}`,
    run: (ctx) => { const v = ctx.deps['@angular/core']; return [ctx.major(v) === major, `@angular/core is ${v}`]; },
  }),
  commitPerMajor: (majors) => ({
    text: `One commit per major, in order: ${majors.join(', ')}`,
    run: (ctx) => {
      const list = ctx.facts.commits.map((c) => ctx.major(c.angular));
      const distinct = list.filter((m, i) => m !== list[i - 1]);
      const ok = JSON.stringify(distinct) === JSON.stringify(majors) && list.length === majors.length;
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
    text: 'A clean npm ci works on the result, without forcing',
    run: (ctx) => ctx.verified('install'),
  }),
  builds: () => ({ text: 'A production build works on the result', run: (ctx) => ctx.verified('build') }),
  testsPass: () => ({ text: 'Tests pass on the result', run: (ctx) => ctx.verified('test') }),
  appRuns: () => ({ text: 'The app starts and renders on the result, checked independently', run: (ctx) => ctx.verified('smoke') }),
  specsUntouched: () => ({
    text: 'Left every test file as it was',
    run: (ctx) => { const d = ctx.gitDiffNames('*.spec.ts'); return [!d, d ? `Changed: ${d.slice(0, 160)}` : 'No spec changed']; },
  }),
  noOptionalMigrations: () => ({
    text: 'Ran no optional migrations',
    run: (ctx) => { const hits = ctx.commands.filter((c) => /\bng(\.js)?\s+update\b.*--name\b/.test(c)); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 160)}` : 'None run']; },
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
      check.says('Says 21 is the furthest it can go today', /(\b21\b[^.\n]{0,120}(highest|furthest|as far|ceiling|reach|max|limit|stop|\bnot\s+(to\s+)?(angular\s+)?22\b))|((highest|furthest|as far|ceiling|reach|max|limit|stop)[^.\n]{0,80}\b21\b)/i),
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
    name: 'ask-mismatched-versions', tier: 'plan', fixture: 'clean-path',
    prompt: 'which versions of primeng, ng-select and ngx-mask would i need for angular 22? their version numbers confuse me',
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says('Gives ng-select 24.x, whose number does not match Angular', /24\.\d+\.\d+/),
      check.says('Gives PrimeNG 22.x', /22\.\d+\.\d+/),
      check.says('Gives ngx-mask 22.x', /mask[\s\S]{0,120}22\.\d+\.\d+/i),
    ],
  },
  {
    name: 'ask-open-range', tier: 'plan', fixture: 'ag-grid-open',
    prompt: 'Does our AG Grid version work with Angular 22, or do we need to move it? This is before we commit to the upgrade.',
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says("Says npm's range alone doesn't prove it works", /(open-ended|unconfirmed|no upper (bound|limit)|>= ?(17|20)|not (explicitly|specifically)|doesn't (name|list)|does not (name|list)|running app|isn't real evidence|prove little|any future)/i),
      check.says('Gives evidence, or says it has none beyond npm', /(build|built|ran|run|render|compatibility|docs|table|didn't (build|run|test)|haven't (built|run|tested))/i),
    ],
  },
  {
    name: 'ask-no-peer-info', tier: 'plan', fixture: 'plain-20',
    patchPackage: (pkg) => { pkg.dependencies['@syncfusion/ej2-angular-grids'] = '30.1.37'; },
    prompt: 'we use syncfusion grids in this app. will they hold us back if we go to angular 22?',
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says('Says npm cannot confirm it either way', /(declare|list|state|specif|peer)[^.\n]{0,120}(no|not|n't|nothing|none)|(no|not|n't|nothing|none)[^.\n]{0,120}(declare|list|state|specif|peer|confirm|check|vouch|say)|unconfirmed|can't confirm|cannot confirm/i),
    ],
  },
  {
    name: 'ask-deprecated-lib', tier: 'plan', fixture: 'plain-20',
    patchPackage: (pkg) => { pkg.dependencies['@angular/flex-layout'] = '15.0.0-beta.42'; },
    prompt: "We still have @angular/flex-layout in here from years ago. Is that going to be a problem for going to Angular 21? Don't touch anything.",
    assertions: [
      check.skillFired(), check.noChanges(),
      check.says('Says npm cannot confirm it works on 21', /unconfirmed|open-ended|not (been )?(tested|confirmed|verified)|untested|no guarantee|predates|older than|check the running app/i),
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
      check.says('Offers waiting or replacing', /wait|replac/i),
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
      { text: 'Did not discard the changes without asking', run: (ctx) => { const hits = ctx.commands.filter((c) => /\bgit\s+(checkout\s+(--\s+)?\.|checkout\s+(--\s+)?package|restore|reset|clean|stash(?!\s+list))\b/.test(c)); return [hits.length === 0, hits.length ? `Ran: ${hits[0].slice(0, 140)}` : 'Discarded nothing']; } },
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
      check.noDirtyUpdate(), check.noOptionalMigrations(), check.specsUntouched(), check.ranApp(),
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
      check.says('Offers waiting, replacing or forcing', /wait[\s\S]{0,400}(replac|force)|replac[\s\S]{0,400}(wait|force)/i),
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
      { text: 'Moved ag-grid-community with ag-grid-angular', run: (ctx) => { const a = ctx.deps['ag-grid-angular']; const c = ctx.deps['ag-grid-community']; return [a === c && ctx.major(a) >= 35, `angular ${a}, community ${c}`]; } },
      check.says('Flags AG Grid support as unconfirmed by npm', /(open-ended|unconfirmed|no upper (bound|limit)|>= ?20|not (explicitly|specifically))/i),
      check.installs(), check.builds(), check.testsPass(), check.appRuns(),
    ],
  },
];

