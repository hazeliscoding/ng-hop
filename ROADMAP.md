# Roadmap

ng-hop is an agent skill that upgrades an Angular app one tested major at a time, with its UI libraries, and stops to ask when one blocks the next major.

## What the design protects

1. **A plan you can trust.** It never recommends a version it can't back up. It says "unknown" instead of guessing and never downgrades a library silently. *Gave up:* some reports look more cautious than they needed to.
2. **Safe to interrupt.** Each major gets its own commit, so a stop only costs the major in progress. *Gave up:* it won't start on a repo with uncommitted changes.
3. **Low upkeep.** It reads npm and Angular's Update Guide live, with no version tables, so a new Angular should work without a new release. *Gave up:* it needs a network connection.

Everything else gets ordinary care, but none of these three gets traded away for speed, install size or support for other agents.

## Decisions

- **Stop at the ceiling and ask (2026-11-04).** When a library blocks the next major, go as far as everything supports, commit that, and ask whether to wait, replace it or force it. *Why:* you still get a working upgrade, and nothing gets forced without your say. *Gave up:* a single run may not reach the target.
- **Judge libraries by peer range and publish date, never by version number (2026-11-04).** *Why:* on 2026-11-04, 13 of the 21 libraries checked that declare Angular 22 support had a version number that doesn't match Angular's (`@clr/angular` 18.5.0, `ag-grid-angular` 36.3.0). *Gave up:* nothing; the data is on npm.
- **Reject an old open-ended release instead of downgrading to it (2026-11-04).** `ngx-toastr` 19.1.0 accepts Angular 22 through `>=16.0.0-0`, but it predates Angular 22 and is older than the current 20.0.5. *Why:* "a version that accepts 22" would quietly downgrade to something nobody tested. *Gave up:* the rare case where that old release would have worked.
- **Name every moving library in one `ng update`, with no `--force` (2026-11-04).** *Why:* `ng update` checks peers against everything it's about to install, so naming them together passes the check. Proven on real apps, where a plain agent had used `--force` on three of four updates. *Gave up:* long commands.
- **Run the app at every major (2026-11-04).** *Why:* `marked` dropping a file breaks `ng serve` and the build, and on Angular 22 `ng serve` broke while the build and tests stayed green. *Gave up:* time per major.
- **Render with the system's Chrome from the command line, with no Puppeteer or Playwright (2026-11-04).** *Why:* the skill has no install step. *Gave up:* Chrome's log doesn't record a message's level, so a plain `console.error('oops')` goes unnoticed. Angular's own error handler and uncaught errors are caught.
- **No runtime dependencies, with one vendored parser (2026-11-04).** Version ranges are the one thing too risky to hand-write, so `semver` is bundled into one file. *Why:* skills run from a plugin cache with no install step. *Gave up:* updating `semver` is a manual step, described in `scripts/vendor/VENDORED.md`.
- **Read the registry directly, and fall back to npm on an auth error (2026-11-04).** *Why:* a direct read takes under two seconds for a real app where `npm view` took 17 seconds for one package, and npm already holds any private-registry credentials. *Gave up:* a second code path, covered by a test with a registry that demands a token.
- **Never run npm through a shell, and validate names from `package.json` (2026-11-04).** *Why:* on Windows, a shell reads `>=` as a redirect, and a crafted dependency name could inject a command. `package.json` is untrusted input. *Gave up:* nothing.
- **Every printed command uses `npx --no-install` (2026-11-05).** *Why:* npm has an unrelated package named `ng`, and plain `npx ng` downloads and runs it whenever the project's CLI isn't installed. A security review flagged this on the patch path, and it applied to every major's command too. A test now fails on a bare `npx ng`. *Gave up:* longer commands.
- **A library that already names the major stays put (2026-11-04).** *Why:* an upgrade shouldn't change what it doesn't have to. *Gave up:* newer patch releases come later, by choice.
- **Parse the Update Guide as text, never by running it (2026-11-04).** *Why:* it's TypeScript from the network. *Gave up:* a small parser that fails loudly if the file's shape changes.
- **Evals run in clean headless sessions, and the grader rebuilds every result (2026-11-04).** *Why:* an agent's account of its own work is what an eval can't trust, so the grader reinstalls, builds, tests and runs the app itself. `claude plugin eval` can't run a build after a case, and refuses to grant Bash on Windows. *Gave up:* evals are slow, and they run by hand instead of in CI.
- **A library that could stay moves when a sibling needs it newer (2026-11-04).** *Why:* `@angular/cdk` 20 accepts Angular 21, so it stayed, but Nebular 17 on Angular 21 needs cdk ^21, and the plan wrongly reported the app as blocked. An OpenCode run on a free model found this. *Gave up:* a little of the "change as little as possible" rule, only where a peer requires it.
- **When someone says an upgrade was interrupted and asks to finish, finish (2026-11-04).** Stash the leftovers and redo that major, without asking first. Changes nobody has explained still get a question. *Why:* the first version asked, and plain Claude did better by just finishing. Stashing keeps the leftovers recoverable. *Gave up:* a moment of extra caution, since the person already gave the answer.
- **Offer patch releases when already on the target major (2026-11-04).** *Why:* someone asking for "the latest" means it, and plain Claude did this where the first version said there was nothing to do. *Gave up:* nothing.
- **Audit the eval scores before believing them (2026-11-04).** The first run scored 100% against 67%, and much of that gap was the harness: it left out two tsconfig files, punished safe experiments in temp folders, and cut runs off at 10 minutes. Fixed, it was 100% against about 90%. *Why:* a benchmark that flatters the thing you built is worse than none. *Gave up:* the bigger number.
- **Stay a plain Agent Skill, with the Claude Code plugin as one way to install it (2026-11-04).** *Why:* OpenCode and GitHub Copilot read the same `SKILL.md` format and both scan `.agents/skills/`, so nothing in the skill needs to know which agent runs it. The first OpenCode run also found a real plan bug, so other agents are worth testing on purpose. *Gave up:* no agent-specific features, such as a dialog for the final question.
- **Library versions in eval cases come from the live registry (2026-11-04).** *Why:* an upgrade needs real packages. *Gave up:* cases expire when a library catches up, so they carry an as-of date, and `test/` holds the permanent versions on a fake registry.

## Milestones

### M0: Placeholder

- [x] Repo, brand, license, agent rules and CI with secret scanning.

**Done when:** the repo is on GitHub with all of the above, and CI passes.

### M1: The plan

- [x] `plan.mjs` finds the highest reachable major, each library's version per major, shared peers, blockers and what it can't check.
- [x] Tests against a fake registry that behaves like npm, including the abbreviated form, auth failures and outages.

**Done when:** `npm test` passes and a plan for a real 15-dependency app takes a few seconds.

### M2: The skill

- [x] `SKILL.md`, `references/`, `guide.mjs` and `smoke.mjs`.
- [x] The plan's command upgrades real apps with no `--force`.

**Done when:** an agent with the skill takes a real app across two majors, with one commit per major.

### M3: Proof

- [x] Eval cases for questions and refusals, each run with and without the skill.
- [ ] Whole-upgrade evals, each run with and without the skill and rebuilt by the grader. `resume-interrupted` has run. The other eight were stopped when the machine ran low on memory.
- [x] Trigger evals, and a description tuned against a held-out set.
- [ ] Scores in the README, with the cases where plain Claude does just as well.

**Done when:** every case's result is in the benchmark, and the README reports it honestly.

### M4: 0.1.0

- [ ] `CONTRIBUTING.md`, `SECURITY.md` and a changelog.
- [ ] Install from the marketplace on a clean machine.
- [ ] Tag `v0.1.0`.

**Done when:** someone can install it from the README's commands and run it on their app.

## Later

- Run the skill in GitHub Copilot for real, and take a whole upgrade through OpenCode. So far Copilot is checked from its docs and OpenCode on one question.
- Real pnpm and yarn fixtures. The plan handles them, but evals only cover npm so far.
- Evals in GitHub Actions on a schedule, so a library catching up shows as a changed result.
- A `--next` mode for upgrading to a prerelease Angular.
- Use the DevTools protocol in `smoke.mjs`, so it sees every console error.

## Not planned

- **AngularJS (1.x) migrations.** That's a rewrite, and other skills cover it.
- **Adopting signals, standalone or new control flow.** Angular's own schematics do this, and mixing it into an upgrade makes the diff unreadable.
- **Replacing a library automatically.** That's a project with its own decisions, so the skill only gives you the facts.
- **Nx automation.** Nx has `nx migrate`. The plan flags Nx and still gives library facts.

## How we'll know it works

- The with-and-without benchmark shows a gap on the things this skill exists for, and it says so where there's none.
- Issues from people whose real apps it stopped or broke, which `.github/ISSUE_TEMPLATE/` asks for.
- It takes my own apps on old majors (`readme-wizard`, `pr-sweep`) to the latest Angular.
