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
- If `x` isn't a direct dependency, it's pulled in by one. Find the parent with `npm ls x` (`pnpm why x` on pnpm) and treat the parent as the library to move.
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

If the repository was clean immediately before pnpm printed this sequence from a plain `pnpm exec ng update`:

```text
The installed Angular CLI version is outdated.
Installing a temporary Angular CLI versioned 22 to perform the update.
Error: Repository is not clean. Please commit or stash any changes before updating.
```

The installed CLI put its temporary package inside the project (`node_modules`, or `.angular/cache/angular-cli-tmp-packages-*`), where pnpm treats it as another workspace importer and changes the lockfile. It happens from Angular 21's CLI onward, in any project with a `pnpm-workspace.yaml`, and a `packages` list in that file doesn't prevent it. Plain `pnpm dlx` can still hand off to that local CLI, so current plans use `update.mjs`: pnpm acquires the target CLI in its cache, and `NG_DISABLE_VERSION_CHECK` is scoped to the child to keep that selected CLI in control. This is the same version-dispatch control Angular uses in its own temporary runner, not a Git or peer bypass. Do not retry an old command, commit an unexplained lockfile change, or bypass cleanliness. Preserve the diff and output, verify which migrations actually ran, and ask before removing verified bootstrap-only leftovers. Then make a fresh plan from the clean, verified starting point.

## `ERR_PNPM_IGNORED_BUILDS`, or `Unable to install packages` on pnpm

```
Error: ERR_PNPM_IGNORED_BUILDS
  × installing dependencies
  ╰─▶ Ignored build scripts: @parcel/watcher@2.6.0, esbuild@0.28.1,
      lmdb@3.4.2, msgpackr-extract@3.0.6
```

pnpm 11 and newer won't run a dependency's install script until the project has decided about it, and every install exits 1 until each one is decided. Inside `ng update` this only shows as `✖ Installing packages [FAILED: Unable to install packages]`, with no migrations run, so run `pnpm install` yourself to see the reason. pnpm also writes `set this to true or false` placeholders into `pnpm-workspace.yaml`, which dirties the tree and must never be committed.

1. Put the tree back: `git restore .`, and delete `pnpm-workspace.yaml` if `git status` shows it as untracked, since pnpm just made it.
2. Decline each package the error names, by adding it to `pnpm-workspace.yaml` as `false` and keeping any entries already there:
   ```yaml
   allowBuilds:
     esbuild: false
   ```
   That's what pnpm was already doing, so no new code runs, and it's easy to reverse. A real Angular 20 app installed, built, tested and ran with all four packages above declined.
3. Don't approve a script yourself. `true` lets that package's code run on every install, so it's the person's decision.
4. Run `pnpm install --frozen-lockfile`, commit the decision by itself, and carry on from where you were. If this interrupted `ng update`, re-run the plan and do that major again.
5. If the build, tests or app then fail because a script didn't run, stop and ask. Name the package and what pulls it in (`pnpm why <package>`), and ask whether to allow it.

In your report, list what you declined and say that `pnpm approve-builds <package>` reverses it.

## `Package @angular/core was not found on the registry. Skipping.`

Through Angular 21's CLI, `ng update` prints this for a package declared as `catalog:` in a pnpm project, and still exits 0. The libraries in the command move, Angular stays behind, and no migrations run, so it looks like success. Angular 22's CLI stops with an error instead and lists manual steps. The plan refuses to start on either. If you see this line anyway, put the tree back with `git restore .`.

A catalog is shared across the workspace, so report it and ask. There are two ways forward: give the Angular packages plain versions in this app's `package.json` and plan again, or update the catalog by hand, run `pnpm install`, then run `pnpm exec ng update <package> --migrate-only --from <old version>` for each package.

## `Found 0 dependencies` and `Package '@angular/core' is not a dependency`

```
Collecting installed dependencies...
Found 0 dependencies.
Package '@angular/core' is not a dependency.
```

This is an app below a pnpm workspace root, on pnpm 12.0 to 12.6. In those versions `pnpm list` also returns the workspace root, listed first, and Angular's CLI ends up looking at the root's empty dependencies instead of the app's. Nothing has changed at this point. Check `pnpm --version`: pnpm 12.7 and newer are fine, and a real app went from Angular 20 to 22 inside a workspace on 12.16.1. Updating pnpm changes the person's tool, or their `packageManager` pin, so ask first.

## The build and tests pass, but the dev server fails

`smoke.mjs` exists for this. Read its `server error` lines.

- **`Could not resolve "marked-katex-extension"` (or `mermaid`, `katex`, `clipboard`):** `ngx-markdown` imports its optional extras dynamically, and the dev server's prebundling tries to resolve them even when the app never uses them. If the app doesn't use the extra, add the name to `externalDependencies` under the `build` options in `angular.json`, and mention it under hand fixes.
- **Anything else:** check whether the same error appears in the `smoke.mjs` result from before this major. If it does, it isn't from this upgrade.

## `No matching export in "node_modules/@angular/cdk/fesm2022/collections.mjs" for import "_VIEW_REPEATER_STRATEGY"`

A peer range says which versions a library accepts, not that it works with them. Nebular 17 accepts `@angular/cdk` `^21.0.0`, but it imports a private CDK name that CDK removed in 21.1.0, so the plan's newest CDK breaks the build.

1. Find the newest release in the same major that still exports the name, by unpacking releases with `npm pack` in a temporary folder.
2. Install that exact version, with no override, and run the checks again.
3. Under hand fixes, say which package is held, why, and that it won't get fixes until the library catches up. That also counts toward replacing the library.

## The app shows a license banner after a major (`Invalid PrimeUI License`)

A library's new major can change its license, and the build, tests and `smoke.mjs` all still pass. PrimeNG 21 is MIT, while PrimeNG 22 is the commercial PrimeUI license with a required key and a free tier for small organizations, and it shows a red badge without a key, in production builds too. No PrimeNG 21 release accepts Angular 22. npm can't warn about this: its `license` field says `SEE LICENSE IN LICENSE.md` on both.

This can cost the person money, so put it first in your report and ask whether to keep the major, stay on the one before, or replace the library. Quote the library's own `LICENSE.md` instead of summarizing from memory, and don't add a key or look for a way around the check.

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
