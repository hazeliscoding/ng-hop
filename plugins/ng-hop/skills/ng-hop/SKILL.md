---
name: ng-hop
description: >-
  Upgrade an Angular app across one or more major versions, together with its UI libraries and other dependencies,
  one tested commit per major. Finds the highest version the whole app can reach today, and stops there to ask when a
  library blocks the next one. Use this whenever someone wants to upgrade, update or migrate Angular, go from Angular
  X to Y, get on the latest Angular, or run `ng update`. Also use it when they ask how far they can upgrade, whether a
  library such as Angular Material, PrimeNG, ng-bootstrap, NgRx or AG Grid supports a newer Angular, or when they paste
  an `ng update` or peer dependency error from an upgrade, even if they don't say "upgrade". Not for AngularJS (1.x)
  migrations, or for adopting signals, standalone or new control flow without changing the Angular version.
---

# ng-hop

Move an Angular app up one major at a time, as far as its whole dependency set supports today. Every major ends in its own commit with the build, tests and running app checked, so a stop at any point loses little. When a library blocks the next major, stop there, keep what's done, and ask.

Scripts are in this skill's `scripts/` folder. They need Node 18 or newer and no install. Below, `$SCRIPTS` means that folder.

## 1. Check the repo

Run `git status --short`. Commits are the safety net for this whole process, so it can't start on uncommitted changes.

- **Uncommitted changes that look like the person's own work:** stop and ask them to commit or stash. Don't stash for them, because they may not notice it happened.
- **Uncommitted changes that look like an interrupted upgrade** (`package.json`, the lockfile and migration edits): say so, and ask whether to discard them and redo that major. Discarding can't be undone, so wait for a yes. Then restore the files, reinstall, and continue from step 2.
- **Not a git repo:** ask whether to run `git init` and commit first.

If you're on the default branch, create `upgrade/angular-<target>` before changing anything. On any other branch, stay there. Never push.

## 2. Plan

```sh
node $SCRIPTS/plan.mjs --to <major>     # omit --to for the latest Angular
```

It reads `package.json`, the lockfile and npm, and changes nothing. Exit 0 means the target is reachable or there's nothing to do, 2 means blocked before the target, 1 means no plan could be made. On exit 1, report the error and stop: a version guessed from memory or from the numbers is how upgrades go wrong, because library versions often don't match Angular's (`@clr/angular` 18.5.0 supports Angular 22) and an old release can claim to support a major it predates.

Show the person the result in a few lines: where they can get to, what blocks anything further, and which libraries are unconfirmed.

- **If they only asked a question** ("how far can I go?", "does PrimeNG support 22?", "is this upgrade safe?"), answer from the plan and stop. Change nothing.
- **If the plan is blocked,** carry on up to the highest reachable major, then stop as step 5 describes. Say that's what you're doing.
- **`Node: too-old` on a major:** `ng` will refuse to run. Stop before that major and ask them to switch Node. Don't switch it yourself, since `nvm use` changes it for the whole machine on Windows. `unsupported` means Node is newer than Angular lists: mention it and carry on while the checks pass.
- **An Nx workspace:** the plan says so. Use `nx migrate` for the framework packages, and the plan for the library facts.

## 3. Record the starting point

Install dependencies if they're missing (`npm ci`, `pnpm install --frozen-lockfile` or `yarn install --immutable`), then record, before changing anything:

```sh
npx ng build
npx ng test --watch=false        # with Karma, add --browsers=ChromeHeadless
node $SCRIPTS/smoke.mjs          # runs the dev server, and renders the page in Chrome if it's installed
```

Keep the exact results. Anything failing now isn't caused by the upgrade, so it stays out of the upgrade: don't fix it, and don't count it against a major. Report it at the end. If the build itself fails here, stop and ask, because nothing after this point could be told apart from what was already broken.

## 4. Upgrade one major at a time

`ng update` refuses to skip majors, and each major's migrations need the previous one's output. For each major up to the target or ceiling:

**a. Re-run the plan** and take its first major. The plan reads the lockfile, so this also makes resuming after an interruption automatic.

**b. Read the official steps:**

```sh
node $SCRIPTS/guide.mjs --from <N-1> --to <N>
```

Most steps won't apply to this app. Search the code for what each one mentions instead of assuming. Do the "before" steps that apply. If the script can't reach the guide, read the page it names and say so in your report.

**c. Run the plan's `Run:` command exactly as printed.** It names Angular and every library that has to move, because `ng update` checks peers against everything it's about to install. Naming them together is what makes `--force` unnecessary. The earlier commit means the tree is clean, so `--allow-dirty` isn't needed either.

**d. Read the output, not just the exit code.** Each package should show `Executing migrations of package`. A crash partway leaves the packages installed with some migrations never run, and that looks like success until something breaks later. Read `references/troubleshooting.md` for this and for any other error.

**e. Finish the major:**
- Install anything the plan lists under the major that `ng update` didn't move (check `package.json`). TypeScript usually moves on its own. Other shared packages such as `marked` or `ag-grid-community` often don't.
- Do the guide's remaining steps that apply.
- Fix what the upgrade broke. When a library's own major change breaks your code, read that library's changelog or migration guide instead of guessing at its API.

**f. Check it against the starting point:** the same build, tests and `smoke.mjs` as step 3. Only new failures count. A build and tests can pass while the app won't start, so don't skip `smoke.mjs`. For a library the plan marks UNCONFIRMED, the running app is the only evidence you'll get: say what you checked. If `smoke.mjs` reports no browser, say that the page was fetched but never rendered.

If a failure won't yield to a reasonable effort, stop and ask. Say what you tried, and don't commit a broken major, since every commit in this history has to be safe to stop on.

**g. Review your own diff.** Run `git diff --stat`, and look for files you didn't mean to touch and for whole-file changes from line endings. Keep the diff to what this major needed.

**h. Commit,** following the repo's commit convention, with one commit per major. For example `chore(deps): upgrade to Angular 21`, with a body listing the versions moved and any fixes made by hand, since reviewers skim tool output but need to read hand fixes. Then go back to (a).

## 5. Stop at the ceiling and ask

When the plan is blocked, the highest reachable major is the end of this run, however close the next one looks. Read `references/blocked.md`, gather the facts it lists, and put the choice to the person: **wait** for the library, **replace** it, or **force** past it, with your recommendation and why. End your message with that question.

Don't try a prerelease, an `overrides` entry or `--force` to see if it works. These change what the project depends on in ways that are easy to miss in review, so the person decides first.

## 6. Report

Keep it short and lead with the result:

- **Result:** the Angular version reached, and the target if it fell short.
- **Commits:** one line per major.
- **Hand fixes:** what you changed yourself and why. This is what needs a reviewer.
- **Unconfirmed:** libraries npm couldn't vouch for, and what you checked instead.
- **Already failing:** anything from step 3, left as it was.
- **Available but not done:** optional migrations `ng update` offered, and deprecations to plan for.
- **Not checked:** anything you skipped, including flows the app check can't reach.

## Staying in scope

An upgrade diff is already hard to review, and changes nobody asked for are the hardest part of it. Each of these looks helpful in the moment and costs the reviewer later:

- **No optional migrations** (`ng update --name ...`) and no moving to signals, standalone or new control flow, unless the major can't build without it. List them in the report instead.
- **Tests stay as they are** unless the upgrade itself broke them. Never delete a test or loosen an assertion to get to green. If you do change a spec because an API changed, say so under hand fixes.
- **No unrelated bumps or cleanups:** no `npm audit fix`, no newer versions of libraries the plan leaves alone, no reformatting.
- **No `--force`, `--legacy-peer-deps`, `overrides`, `resolutions` or prereleases** without the person's approval. They hide the conflict the plan exists to surface.
