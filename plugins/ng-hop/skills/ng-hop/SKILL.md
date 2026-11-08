---
name: ng-hop
description: >-
  Upgrade an Angular app across one or more major versions, together with its UI libraries and other dependencies,
  one tested commit per major. Finds the highest version the whole app can reach today, and stops there to ask when a
  library blocks the next one. Use this whenever someone wants to upgrade, update or migrate Angular, go from Angular
  X to Y, get on the latest Angular, or run `ng update`. Also use it when they ask how far they can upgrade, or whether
  any library (Angular Material, PrimeNG, ng-zorro, NgRx, AG Grid, or any other) supports a newer Angular, since library
  version numbers and old open-ended peer ranges mislead a quick lookup. Use it too when they paste an `ng update` or
  peer dependency error, even if they don't say "upgrade". Not for AngularJS (1.x) migrations, or for adopting signals,
  standalone or new control flow without changing the Angular version.
---

# ng-hop

Move an Angular app up one major at a time, as far as its whole dependency set supports today. Every major ends in its own commit with the build, tests and running app checked, so a stop at any point loses little. When a library blocks the next major, stop there, keep what's done, and ask.

Scripts are in this skill's `scripts/` folder. They need Node 18 or newer and no install. Below, `$SCRIPTS` means that folder.

## 1. Check the repo

Run `git status --short`. Commits are the safety net for this whole process, so it can't start on uncommitted changes.

- **Uncommitted changes that look like the person's own work:** stop and ask them to commit or stash. Don't stash for them, because they may not notice it happened.
- **They told you an upgrade was interrupted and asked you to finish it:** you have your answer, so don't ask again. Leftovers from an interrupted major can't be trusted to be complete, and `ng update` skips migrations for a version `package.json` already claims, so save them with `git stash push --include-untracked -m "ng-hop: interrupted upgrade"`, reinstall, and redo that major from step 2. Say in your report that the leftovers are in the stash.
- **Changes that look like an upgrade, but nobody has mentioned one** (`package.json`, the lockfile, migration edits): say so and ask whether they're safe to set aside.
- **Not a git repo:** ask whether to run `git init` and commit first.

## 2. Plan

```sh
node $SCRIPTS/plan.mjs --to <major>     # omit --to for the latest Angular
```

It reads `package.json`, the lockfile and npm, and changes nothing. Exit 0 means the target is reachable or there's nothing to do, 2 means blocked before the target, 1 means no plan could be made. On exit 1, report the error and stop: a version guessed from memory or from the numbers is how upgrades go wrong, because library versions often don't match Angular's (`@clr/angular` 18.5.0 supports Angular 22) and an old release can claim to support a major it predates.

Show the person the result in a few lines: where they can get to, what blocks anything further, and which libraries are unconfirmed.

- **If they only asked a question** ("how far can I go?", "does PrimeNG support 22?", "is this upgrade safe?"), answer from the plan and stop. Change nothing.
- **If it's already on the target major,** and they asked to upgrade: with patch releases available, create the branch as the paragraph below says, install dependencies as in step 3, run the command it prints, check it as in step 4f, and commit. If the plan also lists Node pins below what this major needs, raise them as step 4e says, in that commit, or in a commit of their own on the branch when there's nothing else to upgrade, because an earlier upgrade left them failing on the team's machines. That's the whole job.
- **If the plan is blocked,** carry on up to the highest reachable major, then stop as step 5 describes. Say that's what you're doing.
- **A note that a library's license changes on a major,** or that a library brings packages under a license that changed or isn't a common open-source one: the build, tests and app check all pass after a change like this, so the plan is the only warning they'll get, and it can cost them money. Read both license files (`npm pack <package>@<version>` in a temporary folder, then unpack it with `tar`). If only names or dates differ, say so and carry on. If the terms differ, go as far as the major before it and stop, even if they asked for the later one, because they can't have agreed to a license they haven't seen. Quote the new license's own words, and ask whether to accept it, stay where they are, or replace the library. If they accept, carry on with that major. Don't add a key or look for a way around the license's check. Check the library's companion packages too, such as `@primeuix/themes` with PrimeNG, because the plan only compares what it moves. If they only asked a question, tell them in your answer.
- **`Node: too-old` on a major:** `ng` will refuse to run. Stop before that major and ask them to switch Node. Don't switch it yourself, since `nvm use` changes it for the whole machine on Windows. `unsupported` means Node is newer than Angular lists: mention it and carry on while the checks pass.
- **An Nx workspace:** the plan says so. Use `nx migrate` for the framework packages, and the plan for the library facts.
- **A workspace of libraries the person publishes,** built with `ng-packagr`, often with no app to serve: read `references/libraries.md` too, because each library's own peer ranges and version have to move as well, and publishing waits for their go-ahead.
- **They asked to try a prerelease** (an RC, Angular's `next`, or a major the plan says has a prerelease out): plan with `--next`, and only then, because nothing else should land on a version that isn't meant for production. The rest works the same way, one committed major at a time. Say in your report that it's a prerelease, and which libraries only accept it through a prerelease of their own.

Before changing anything, if you're on the default branch, create `upgrade/angular-<major>`, named for the last major this run will commit: the target, or where the plan's ceiling, a license change or Node stops it. On any other branch, stay there. Never push.

## 3. Record the starting point

Install dependencies if they're missing (`npm ci`, `pnpm install --frozen-lockfile` or `yarn install --immutable`). If pnpm stops with `ERR_PNPM_IGNORED_BUILDS`, the project hasn't decided which packages may run install scripts: read that section of `references/troubleshooting.md`, because it needs its own commit before anything else can run. Then record, before changing anything:

```sh
npx --no-install ng build
npx --no-install ng test --watch=false        # with Karma, add --browsers=ChromeHeadless
node $SCRIPTS/smoke.mjs          # runs the dev server, and renders the page in Chrome if it's installed
```

Keep the exact results. Anything failing now isn't caused by the upgrade, so it stays out of the upgrade: don't fix it, and don't count it against a major. Report it at the end. If the build itself fails here, stop and ask, because nothing after this point could be told apart from what was already broken.

With no `test` target in `angular.json`, `ng test` stops with `Unknown argument: watch`. Run the test command the project's `package.json` scripts or CI use instead, at the git root too in a monorepo, through `npm test`, `npm run <script>` or `npx --no-install`, never a deploy or publish step, and say which. If no test can run at all, because there are none or the suite stops before any spec runs (Karma's `Found 1 load error`), the upgrade would go untested, so treat it like a failing build: say so and ask. When one broken spec stops the suite, they can have it fixed first in its own commit, the one exception to leaving what fails here alone. Otherwise they can have you go on with the build and app check only.

## 4. Upgrade one major at a time

`ng update` refuses to skip majors, and each major's migrations need the previous one's output. For each major up to the target or ceiling:

**a. Re-run the plan** and take its first major. The plan reads the lockfile, so this also makes resuming after an interruption automatic.

**b. Read the official steps:**

```sh
node $SCRIPTS/guide.mjs --from <N-1> --to <N>
```

Most steps won't apply to this app. Search the code for what each one mentions instead of assuming, and check which builder `angular.json` uses, since some steps are for `@angular/build` or the older `@angular-devkit/build-angular` only. Do the "before" steps that apply. If the script can't reach the guide, read the page it names and say so in your report.

**c. Run the plan's `Run:` command exactly as printed.** It names Angular and every library that has to move, because `ng update` checks peers against everything it's about to install. Naming them together is what makes `--force` unnecessary. The earlier commit means the tree is clean, so `--allow-dirty` isn't needed either.

For pnpm, the command runs `$SCRIPTS/update.mjs` through `pnpm exec node`, and for yarn through `node`, where npm's own cache holds the target CLI. This small transport uses pnpm's `dlx` cache for the target CLI and scopes Angular's own version-dispatch control to that child, so it cannot redispatch to the app's old CLI and bootstrap inside the workspace. It still checks a clean Git tree and leaves Angular's peer checks enabled. It does not install a global CLI, provision a package manager, retry, reset or commit anything itself.

**d. Read the output, not just the exit code.** Each package should show `Executing migrations of package`. A crash partway leaves the packages installed with some migrations never run, and that looks like success until something breaks later. Read `references/troubleshooting.md` for this and for any other error. If `git diff --stat` shows a migration re-indented whole files, read its "Whole files show as changed" section now, before any hand fix lands in them.

**e. Finish the major:**
- Install anything the plan from step (a) lists under this major that `ng update` didn't move (check `package.json`). A shared package's line says which versions fit: if `ng update` already put it on one of them, keep it. TypeScript usually moves on its own. Other shared packages such as `marked` or `ag-grid-community` often don't, and nor does a peer a library newly needs, listed as `not installed`, which yarn won't add for you.
- On pnpm, `pnpm add` lets in a release less than a day old by writing it into `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, and creates that file if it has to. If `git status` shows that, the exemption is the person's call, so ask before committing it. If they say no, undo the whole add (`package.json`, the lockfile and `pnpm-workspace.yaml`) and reinstall, since taking out only the entry leaves the release in the lockfile.
- Raise each Node pin the plan lists under the major (`Node pins below that, in the repo:`, or `Node pins below what Angular <N> needs` when the app is already on it), such as a dev container's image or Dockerfile, `.nvmrc`, `engines` or a CI workflow, to a version in that range, keeping its form, and say so under hand fixes. Those are the team's machines, and they'd fail where this one passes. Don't switch this machine's Node. The plan reads `.nvmrc`, `.node-version`, `.tool-versions`, `package.json`, a root or `.devcontainer/` Dockerfile, `.devcontainer/devcontainer.json` and GitHub workflows, and passes over a version it can't read, such as `lts/iron`. So search the repo for other pins too, such as a compose file, another CI system, a root `.devcontainer.json` or a Dockerfile its `build.dockerfile` names elsewhere, and say in the report where you looked.
- For an `angular.json:` line under the major, a file the app loads that the library no longer ships, follow `references/troubleshooting.md` for a file named in `angular.json` that no longer exists.
- Do the guide's remaining steps that apply.
- Read what each library's new major changed, even if nothing broke: its changelog in `node_modules/<package>`, or when it ships none, the release notes or `CHANGELOG.md` in the repository the plan names, for every major crossed. A build and tests can't see a dropdown that now renders somewhere else, which is what ng-select 24 did when it started requiring `@angular/cdk`. Anything that touches what this app uses goes in your report, and so does a library `ng update` took to a later major than the plan named.
- Fix what the upgrade broke. When a library's own major change breaks your code, read that library's changelog or migration guide instead of guessing at its API.

**f. Check it against the starting point:** the same build, tests and `smoke.mjs` as step 3. Only new failures count. When one fails, look its error text and symptom up in `references/troubleshooting.md` before investigating. A build and tests can pass while the app won't start, so don't skip `smoke.mjs`. For a library the plan marks UNCONFIRMED, npm can't vouch for it, so look for the library's own compatibility table and check the running app, and say what you found. Staying on an installed version that passes is right: only move it, to the newer version the plan names, if it fails, and say that a move wasn't required. If `smoke.mjs` reports no browser, say that the page was fetched but never rendered.

If a failure won't yield to a reasonable effort, stop and ask. Say what you tried, and don't commit a broken major, since every commit in this history has to be safe to stop on.

**g. Review your own diff.** Run `node $SCRIPTS/eol.mjs`, which puts back each changed file's line endings and final newline as the repo has them, then `git diff --stat`. Look for files you didn't mean to touch, and keep the diff to what this major needed. Keep migration output as the migration wrote it, because a hand rewrite leaves the reviewer nothing to check it against. Don't restore or rerun a migration at this point, since your hand fixes are in those files now: if one reformatted whole files, tell reviewers to read the diff with `git diff -w`.

**h. Commit,** following the repo's commit convention, with one commit per major. For example `chore(deps): upgrade to Angular 21`, with a body listing the versions moved and any fixes made by hand, since reviewers skim tool output but need to read hand fixes. Then go back to (a).

## 5. Stop at the ceiling and ask

When the plan is blocked, the highest reachable major is the end of this run, however close the next one looks. Read `references/blocked.md`, gather the facts it lists, and put the choice to the person: **wait** for the library, **replace** it, or **force** past it, or, when the plan says it comes from their own registry, **upgrade it first**, with your recommendation and why. End your message with that question.

Don't try a prerelease, an `overrides` entry or `--force` to see if it works. These change what the project depends on in ways that are easy to miss in review, so the person decides first.

## 6. Report

Keep it short and lead with the result:

- **Result:** the Angular version reached, and the target if it fell short.
- **Commits:** one line per major.
- **Hand fixes:** what you changed yourself and why. This is what needs a reviewer.
- **Library changes:** what each library's new major changed that touches this app, any peer it newly requires, and any library `ng update` took further than the plan. Never leave this out: when nothing applies, say what you read.
- **Node:** the range the new Angular needs, if it's stricter than before, and any pin you raised. Their CI, deployment and dev container images need it too, even if this machine is fine.
- **Unconfirmed:** libraries npm couldn't vouch for, and what you checked instead.
- **Already failing:** anything from step 3, left as it was.
- **Available but not done:** the optional migrations the last major's `ng update` still offers that would change this app (search the code for what each one targets), settings the migrations added to keep the old behaviour (such as `ChangeDetectionStrategy.Eager`), and deprecations to plan for. A deprecated package nothing imports only needs removing.
- **Not checked:** anything you skipped or that couldn't run, such as unit tests when none ran, and flows the app check can't reach.

## Staying in scope

An upgrade diff is already hard to review, and changes nobody asked for are the hardest part of it. Each of these looks helpful in the moment and costs the reviewer later:

- **No optional migrations** (`ng update --name ...`) and no moving to signals, standalone or new control flow, unless the major can't build without it. List them in the report instead.
- **Tests stay as they are** unless the upgrade itself broke them or the person asks. Never delete a test or loosen an assertion to get to green. If you do change a spec because an API changed, say so under hand fixes.
- **No unrelated bumps or cleanups:** no `npm audit fix`, no newer versions of libraries the plan leaves alone, no reformatting.
- **No `--force`, `--legacy-peer-deps`, `overrides`, `resolutions`, `peerDependencyRules` or prereleases** without the person's approval. They hide the conflict the plan exists to surface.
- **No approving a package's install script** without the person's approval. It runs that package's code on every install.
- **No release-age exemption** (`minimumReleaseAgeExclude`, `npmPreapprovedPackages`) without the person's approval. It lets in a release too new for a compromise to have been caught.
