# Troubleshooting an upgrade

Read the section that matches what you see. These all came from real upgrades.

## `ng update` crashes partway through migrations

```
An unhandled exception occurred: Cannot find module '@angular-devkit/core'
- ...\node_modules\@ngrx\effects\migrations\6_0_0\index.js
```

The packages are already installed. Packages whose migrations ran before the crash are done, and those after it never ran. The exit code and the app can still look fine, so a skipped migration may only surface later.

1. Find which packages printed `Executing migrations of package` before the crash.
2. For each package in the command that didn't, run its migrations on their own. `--allow-dirty` is correct here, because the tree holds this major's unfinished work:
   ```sh
   npx --no-install ng update <package> --migrate-only --from=<old version> --to=<new version> --allow-dirty
   ```
3. If a package's migrations crash when loaded, as NgRx's can, check whether it has any for this move. The file named by `ng-update.migrations` in `node_modules/<package>/package.json` lists each migration's `version`. If none falls after the old version and at or before the new one, nothing was missed, so say that in your report. If some do, report them as not run, and apply them by hand from that package's docs.
4. Check that `--migrate-only` really ran something. `ng update` can hand off to a temporary copy of the newest CLI, and in one upgrade to Angular 21 that printed success while the CLI's migrations never ran. If there's no `Executing migrations of package` line, set `NG_DISABLE_VERSION_CHECK=1` so it uses the project's own CLI, and run it again.

## `Package "x" has an incompatible peer dependency`

```
Package "ngx-markdown" has an incompatible peer dependency to "@angular/common" (requires "^21.0.0", would install "22.2.4").
```

Something in the project needs an older Angular, and it isn't in the command.

- Re-run `plan.mjs`. If it names `x` with a version, you ran an out-of-date command, so run the new one.
- If `x` isn't a direct dependency, it's pulled in by one. Find the parent with `npm ls x` and treat the parent as the library to move.
- If no release of `x` supports this major, it's a blocker: go to `blocked.md`.

Don't reach for `--force`. It only skips this check, and the same mismatch comes back at install time or at runtime.

## The plan rejects angular-eslint with "requires no Angular version"

An older planner could report this despite a current, target-aligned builder release:

```text
@angular-eslint/builder: no stable release at or above 22.5.0 supports Angular 22; the latest, 22.6.0 (2026-10-11), requires no Angular version
```

Earlier builder releases declared an Angular CLI peer; later releases moved that coupling to their devkit dependencies. The known angular-eslint major-alignment rule must inspect the preferred eligible release, not let an older release's peer metadata disable it. This matters for `angular-eslint` too: choosing an older peer-bearing metapackage can select its older package group even while a newer builder is installed. Explicit peers on the preferred release still take precedence, and no release below the installed version is selected. Update ng-hop rather than downgrading the builder, removing the lint target or forcing the app upgrade to bypass this planner error.

## `npm ERESOLVE` during an install

Read which two requirements conflict. Usually a shared package such as `marked` has to move in the same command as the library that needs it, so install them together. Don't use `--legacy-peer-deps`, which skips the check and records a lockfile that the next `npm ci` may reject.

## `Repository is not clean`

Something changed since the last commit. Finish and commit the major in progress, or find out what changed. `--allow-dirty` belongs only to the `--migrate-only` case above.

If the repository was clean immediately before an older pnpm plan printed this sequence:

```text
The installed Angular CLI version is outdated.
Installing a temporary Angular CLI versioned 22 to perform the update.
Error: Repository is not clean. Please commit or stash any changes before updating.
```

The installed CLI may have put its temporary package inside `node_modules`, where pnpm treats it as another workspace importer and changes the shared lockfile. Plain `pnpm dlx` can still hand off to that local CLI, so current plans use `update.mjs`: pnpm acquires the target CLI in its cache, and `NG_DISABLE_VERSION_CHECK` is scoped to the child to keep that selected CLI in control. This is the same version-dispatch control Angular uses in its own temporary runner, not a Git or peer bypass. Do not retry an old command, commit an unexplained lockfile change, or bypass cleanliness. Preserve the diff and output, verify which migrations actually ran, and ask before removing verified bootstrap-only leftovers. Then make a fresh plan from the clean, verified starting point.

## The build and tests pass, but the dev server fails

`smoke.mjs` exists for this. Read its `server error` lines.

- **`Could not resolve "marked-katex-extension"` (or `mermaid`, `katex`, `clipboard`):** `ngx-markdown` imports its optional extras dynamically, and the dev server's prebundling tries to resolve them even when the app never uses them. If the app doesn't use the extra, add the name to `externalDependencies` under the `build` options in `angular.json`, and mention it under hand fixes.
- **Anything else:** check whether the same error appears in the `smoke.mjs` result from before this major. If it does, it isn't from this upgrade.

## A file named in `angular.json` no longer exists

Libraries drop files between majors. `marked` 16 stopped shipping `marked.min.js`, which apps often list under `scripts`. Before removing the entry, search the code for anything using what it provided (a global `marked`, for instance). If nothing does, remove it and say so under hand fixes. If something does, switch that code to an import.

## Whole files show as changed

Migrations can rewrite a file with different line endings, mostly on Windows. Compare `git diff --stat` with `git diff --ignore-cr-at-eol --stat`. If the second is much smaller, restore the original endings before committing, because otherwise real changes get buried. Follow `.gitattributes` if the repo has one.

## Tests that won't run

- **Karma** needs `--browsers=ChromeHeadless` when there's no display. Upgrading doesn't switch an existing project to Vitest, so don't move test runners as part of this.
- **`CHROME_BIN`:** set it if Chrome isn't found.
- **A spec that fails to compile because of an API change** is the upgrade's to fix. A spec that already failed in step 3 isn't.

## Resuming after an interruption

Committed majors are safe. The plan reads the lockfile, so it picks up at the next major on its own. Uncommitted changes from the major that was interrupted can't be trusted to be complete, so stash them as `SKILL.md` describes, reinstall and redo that major. Stashing keeps them recoverable, and reverting them outright wouldn't.

## Node has to change partway

Angular's supported Node range moves with each major, and the plan prints it per major. If the current Node is too old for a later major, stop before that major and ask. Newer Node than a major lists usually still works, so only treat it as a problem if the build or the app check fails.
