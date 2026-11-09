# Troubleshooting an upgrade

Read the section that matches what you see. These all came from real upgrades.

## `ng update` crashes partway through migrations

```
An unhandled exception occurred: Cannot find module '@angular-devkit/core'
- ...\node_modules\@ngrx\effects\migrations\6_0_0\index.js
```

The packages are already installed. Packages whose migrations ran before the crash are done, and those after it never ran. The exit code and the app can still look fine, so a skipped migration may only surface later.

1. Find which packages printed `Executing migrations of package` before the crash.
2. For each package in the command that didn't, run its migrations on their own, with `<ng>` as `SKILL.md` step 3 runs the project's CLI, on pnpm in the same environment. `--allow-dirty` is correct here, because the tree holds this major's unfinished work:
   ```sh
   <ng> update <package> --migrate-only --from=<old version> --to=<new version> --allow-dirty
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
- If the command names `x` at a release that does support this major, and the error still quotes the old release's peers, `ng update` is most likely skipping a release less than a day old, as Angular CLI 22.1 and newer do on pnpm 11 or newer, or yarn 4.15 or newer: see the next section.

Don't reach for `--force`. It only skips this check, and the same mismatch comes back at install time or at runtime.

## A release published minutes ago is held back

```
Package "@acme/ui-core" has an incompatible peer dependency to "@angular/common" (requires "^21.2.0", would install "22.2.5").
```

The plan prints a major that needs such a release as `waiting until` a time, with no `Run:` line. So the command came from an older plan or was typed by hand: plan again. Or the plan couldn't check `release age`, and says so under `Could not check`: ask the manager yourself (`pnpm config get minimum-release-age`, `yarn config get npmMinimalAgeGate`), and check the release's age with `npm view <package> time`.

From Angular CLI 22.1, `ng update` skips any release younger than the package manager's minimum release age, a guard against a compromised release, and reads no exemption list. It never says so. It keeps the installed release and quotes that one's peers, as above, and when the old release's peers raise no error, it leaves the package where it was and still exits 0, so check `git diff package.json` for every library the command named. It asks the manager: `pnpm config get minimum-release-age` prints `undefined` for the default of a day from pnpm 11, `yarn config get npmMinimalAgeGate` prints minutes and defaults to a day from yarn 4.15, npm gives only `before`, which npm 11.10 to 11.14 also make of `min-release-age`, and bun is asked nothing.

Each manager's own install, which `ng update` runs after writing `package.json`:

- **pnpm**, under its default age, installs a young release when nothing older fits, and writes the exemption into `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` itself, creating the file if it has to: `Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml`. Nobody approved that, so ask, and put the tree back as below if they say no. When the team set `minimumReleaseAge` themselves, or `minimumReleaseAgeStrict: true`, it stops with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` instead. pnpm 12 also checks the lockfile, and a young release there with no exemption fails every install, frozen or not, with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`.
- **yarn** refuses it, with `YN0016: │ @acme/ui-core@npm:^22.0.0: All versions satisfying "^22.0.0" are quarantined`, until `.yarnrc.yml` lists it under `npmPreapprovedPackages`. yarn before 4.10 has no such setting.
- **npm** holds nothing back by default. With `min-release-age` (days, npm 11.10 and newer) or `before`, it stops with `npm error code ETARGET` and `No matching version found for @acme/ui-core@22.0.0 with a date before ...`. With `min-release-age` alone on npm 11.15 or newer, `ng update` reads no age and stops with `✖ Installing packages [FAILED: Unable to install packages]` and `Restored package.json to its original state.`, having deleted `node_modules`: run `npm ci` before anything else.
- **bun** holds nothing back by default. `[install] minimumReleaseAge`, in seconds, stops it with `error: No version matching "@acme/ui-core" found for specifier "^22.0.0" (blocked by minimum-release-age: 86400 seconds)`.

Exempting a release relaxes that guard, so it's the person's call, even for their own package: `blocked.md` has the choices and each manager's setting. With their go-ahead, commit the exemption by itself, which changes no installed package, so it's safe to stop on. Then plan again and run that major's `Sooner, once ...` command. Where `ng update` skips the release, that command has `--install-first <package>` for each library, which the plan offers only for a library it doesn't mark `ships migrations`, since `ng update` skips migrations for a version `package.json` already claims. `update.mjs` installs them first, in the form `package.json` gives them now, checks that only `package.json` and the lockfile changed, and then updates the rest, all in the one commit for that major. Say in the report that the update ran that way, and why.

If `update.mjs` stops with `Installing first also changed pnpm-workspace.yaml`, pnpm wrote an exemption the list didn't cover, such as one for a release newer than the one approved. Put the tree back with `git restore :/`, which also covers a workspace root above the app, where pnpm writes to the root's `pnpm-workspace.yaml` and lockfile. If `git status` shows `pnpm-workspace.yaml` as untracked, pnpm made it beside `package.json` because there was none, so delete it. Then reinstall with `pnpm install --frozen-lockfile`, and ask about that release.

## The plan rejects angular-eslint with "requires no Angular version"

An older planner could report this despite a current, target-aligned builder release:

```text
@angular-eslint/builder: no stable release at or above 22.5.0 supports Angular 22; the latest, 22.6.0 (2026-10-11), requires no Angular version
```

Earlier builder releases declared an Angular CLI peer; later releases moved that coupling to their devkit dependencies. The known angular-eslint major-alignment rule must inspect the preferred eligible release, not let an older release's peer metadata disable it. This matters for `angular-eslint` too: choosing an older peer-bearing metapackage can select its older package group even while a newer builder is installed. Explicit peers on the preferred release still take precedence, and no release below the installed version is selected. Update ng-hop rather than downgrading the builder, removing the lint target or forcing the app upgrade to bypass this planner error.

## `npm ERESOLVE` during an install

Read which two requirements conflict. Usually a shared package such as `marked` has to move in the same command as the library that needs it, so install them together. Don't use `--legacy-peer-deps`, which skips the check and records a lockfile that the next `npm ci` may reject.

**`peer @angular/common@"20.1.8" from @angular/animations@20.1.8`:** `@angular/animations` is deprecated from 20.2 on, and npm avoids deprecated releases when a range has another, so `npm install @angular/animations@20` lands on 20.1.8 and asks for the rest of Angular at exactly that version. The same happens when a library that peers on it, such as PrimeNG, gets installed into an app that doesn't list it. Name the version `@angular/core` is on in the same command, such as `@angular/animations@20.3.35`.

## `Repository is not clean`

Something changed since the last commit. Finish and commit the major in progress, or find out what changed. `--allow-dirty` belongs only to the `--migrate-only` case above. `update.mjs --install-first` passes it to `ng update` itself, once it has checked that its own install changed only `package.json` and the lockfile.

If the repository was clean immediately before pnpm printed this sequence from a plain `pnpm exec ng update`:

```text
The installed Angular CLI version is outdated.
Installing a temporary Angular CLI versioned 22 to perform the update.
Error: Repository is not clean. Please commit or stash any changes before updating.
```

The installed CLI put its temporary package inside the project (`node_modules`, or `.angular/cache/angular-cli-tmp-packages-*`), where pnpm treats it as another workspace importer and changes the lockfile. It happens from Angular 21's CLI onward, in any project with a `pnpm-workspace.yaml`, and a `packages` list in that file doesn't prevent it. Plain `pnpm dlx` can still hand off to that local CLI, so current plans use `update.mjs`: pnpm acquires the target CLI in its cache, and `NG_DISABLE_VERSION_CHECK` is scoped to the child to keep that selected CLI in control. This is the same version-dispatch control Angular uses in its own temporary runner, not a Git or peer bypass. Do not retry an old command, commit an unexplained lockfile change, or bypass cleanliness. Preserve the diff and output, verify which migrations actually ran, and ask before removing verified bootstrap-only leftovers. Then make a fresh plan from the clean, verified starting point.

## yarn stops at `Installing a temporary Angular CLI`

```text
The installed Angular CLI version is outdated.
Installing a temporary Angular CLI versioned 21.2.29 to perform the update.
```

On yarn 4, a plain `yarn ng update` printed this and stopped, with no error and nothing changed. An older CLI asked to update installs a temporary newer one with the project's package manager, and that install failed silently. The plan's command for a yarn project runs `update.mjs` instead, which has npm run the target CLI from its own cache and keeps it in control, so no temporary CLI is needed. If you see this, run the plan's command.

## `ERR_PNPM_IGNORED_BUILDS`, or `Unable to install packages` on pnpm

```
Error: ERR_PNPM_IGNORED_BUILDS
  × installing dependencies
  ╰─▶ Ignored build scripts: @parcel/watcher@2.6.0, esbuild@0.28.1,
      lmdb@3.4.2, msgpackr-extract@3.0.6
```

pnpm 11 and newer won't run a dependency's install script until the project has decided about it, and every install exits 1 until each one is decided. Inside `ng update` this only shows as `✖ Installing packages [FAILED: Unable to install packages]`, with no migrations run, so run `pnpm install` yourself to see the reason. pnpm also writes `set this to true or false` placeholders into `pnpm-workspace.yaml`, which dirties the tree and must never be committed.

1. Put the tree back: `git restore :/`, which also covers a workspace root above the app, and delete `pnpm-workspace.yaml` if `git status` shows it as untracked, since pnpm just made it.
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

## `EBADDEVENGINES`, or pnpm stops on the version the project pins

```text
npm error code EBADDEVENGINES
npm error EBADDEVENGINES Invalid devEngines.packageManager
npm error EBADDEVENGINES Invalid name "pnpm" does not match "npm" for "packageManager"
```

npm 11.19.0 refuses `npx`, `npm run` and `npm ci` alike in a project whose `devEngines.packageManager` names another manager, as pnpm 12's `pnpm init` writes it, or another npm version, unless its `onFail` is `warn`, which only warns, or `ignore`, which says nothing. npm 10.9.9 refused `npx` the same way. On an npm project the install stops too, so the pin is the person's to meet. In a pnpm or yarn project, run `ng` through that manager, as `SKILL.md` step 3 lists. A yarn hop's `update.mjs` still runs the target CLI through npm, for an empty folder of its own with a copy of the project's `.npmrc`, so the pin doesn't stop it.

```text
Error: ERR_PNPM_BAD_CONFIG_DEP
  × resolve package manager dependencies
  ╰─▶ Failed to resolve config dependency pnpm@12.16.1: GET ...
```

```text
Error: ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE
  × resolve package manager dependencies
  ╰─▶ Cannot update packageManagerDependencies with "frozen-lockfile" because
      the lockfile is not up to date
```

```text
[ERROR] This project is configured to use 11.0.0 of pnpm. Your current pnpm is v11.28.11
```

pnpm looks up the pnpm a project pins before it runs anything. pnpm 10.34.9 does it when `packageManager` names another version, and reads no `devEngines` pin. pnpm 11.28.11 and 12.16.1 do it for a `devEngines` pin naming their own version under any `onFail` but `ignore`, such as the one pnpm 11's own `pnpm init` writes, and pnpm 12.16.1 for its own `packageManager` version too: whenever the lockfile has no record of the pin, they fetch its metadata and write `packageManagerDependencies` into `pnpm-lock.yaml`, which leaves a tree `update.mjs` refuses. A frozen install stops with the second error instead. Offline, pnpm 12.16.1's `exec`, `install` and `list` stop with the first, while its `--version` only warns. For a `devEngines` pin to another version, pnpm 11 and 12 download that pnpm when `onFail` is unset or `download`, only warn under `warn`, and stop under `error` with the third error, which pnpm 12.16.1 prints as `ERR_PNPM_BAD_PM_VERSION`. `pnpm_config_pm_on_fail=ignore` stops pnpm 11 and newer, and `npm_config_manage_package_manager_versions=false` stops pnpm 10, unless the project keeps the pin in force whatever the environment says. pnpm 10.34.9 reads `managePackageManagerVersions: true` in `pnpm-workspace.yaml` over the environment and fetches the pin anyway, which offline fails with `ERR_PNPM_FETCH_404`, and `package-manager-strict-version=true` in `.npmrc` stops every command with `This project is configured to use v10.0.0 of pnpm. Your current pnpm is v10.34.9`. Then meeting the pin is the person's call, so ask. Set both in the environment for every pnpm command, the plan's `Run:` and patch commands included, since `update.mjs` gives them only to what it starts, and not as flags: from Angular CLI 22, `ng` runs `pnpm --version` itself when `package.json`'s `packageManager` gives no version, and that pnpm sees only the environment. If the lockfile has changed already, put it back with `git restore :/` before the upgrade starts.

Through Corepack, a pin to a pnpm or yarn that Corepack hasn't stored yet is downloaded by Corepack itself, before the manager starts, for the install too. No setting of the manager's changes that.

## `Package @angular/core was not found on the registry. Skipping.`

Through Angular 21's CLI, `ng update` prints this for a package declared as `catalog:` in a pnpm project, and still exits 0. The libraries in the command move, Angular stays behind, and no migrations run, so it looks like success. Angular 22's CLI stops with an error instead and lists manual steps.

The plan's pnpm command handles this: `update.mjs` copies the catalog's versions into `package.json`, lets `ng update` run as usual, then writes the new versions back into the catalog, puts `package.json` back on `catalog:`, and runs `pnpm install`. If an update fails, `package.json` goes back on its catalog entries and the catalog is left as it was. So if you see this line, someone ran a plain `ng update`: put the tree back with `git restore :/` and run the plan's command instead.

A catalog is shared across the workspace. When the plan says other projects use the same entries, moving the catalog moves them too, without their migrations, so ask before going ahead.

## `Found 0 dependencies` and `Package '@angular/core' is not a dependency`

```
Collecting installed dependencies...
Found 0 dependencies.
Package '@angular/core' is not a dependency.
```

This is an app below a pnpm workspace root, on pnpm 12.0 to 12.6. In those versions `pnpm list` also returns the workspace root, listed first, and Angular's CLI ends up looking at the root's empty dependencies instead of the app's. Nothing has changed at this point. Check `pnpm --version`: pnpm 12.7 and newer are fine, and a real app went from Angular 20 to 22 inside a workspace on 12.16.1. Updating pnpm changes the person's tool, or their `packageManager` pin, so ask first.

## `✖ Migration failed: 404 Not Found` for the team's own package

```text
Fetching dependency metadata from registry...
✖ Migration failed: 404 Not Found - GET https://registry.npmjs.org/@acme%2fui-core - Not found
```

This is an app below a pnpm workspace root whose `.npmrc` gives the team's scope a registry of its own. Up to Angular CLI 22.0, which runs every hop to Angular 21 or older, `ng update` fetches every dependency's metadata itself, not only the packages in the command. It reads registry settings only from the `.npmrc` in the app's folder, `~/.npmrc` and npm's global config, never from a `.npmrc` above the app, so it asks the public registry for the team's package. pnpm reads the root's `.npmrc`, which is why the install and the plan found it. From CLI 22.1, `ng update` asks pnpm instead. Nothing has changed at this point.

For the hop, put the scope's registry line from the root's `.npmrc` where `ng update` reads it:

- **A `.npmrc` in the app's folder,** committed by itself, because `update.mjs` stops on a tree that isn't clean. It changes no installed package, so it's safe to stop on.
- **`~/.npmrc`,** which leaves the repo alone but is the person's own file, so ask first.

An auth line for that registry that reads its token from an environment variable, such as `//npm.acme.example/:_authToken=${ACME_TOKEN}`, can be copied as it is. Never copy a token itself into a file git tracks. Then run the plan's command again, and say in the report where the line went.

## The build and tests pass, but the dev server fails

`smoke.mjs` exists for this. Read its `server error` lines, or its `server log` lines when no error line matched.

- **`Failed to resolve import "marked-katex-extension"` from Vite, or `Could not resolve "marked-katex-extension"` from esbuild (or `mermaid`, `katex`, `clipboard`):** the page comes back but renders nothing, with a 500 for `main.js` in the console. `ngx-markdown` imports its optional extras dynamically, and the dev server's prebundling tries to resolve them even when the app never uses them. If the app doesn't use the extra, add the name to `externalDependencies` under the `build` options in `angular.json`, and mention it under hand fixes.
- **The server starts, but nothing answers on its port:** from Angular 22, `@angular/build`'s dev server takes the `PORT` environment variable over `--port`, and says `Environment variable "PORT" detected. Using port <n>.` `smoke.mjs` sets both. When you run `ng serve` yourself, unset `PORT` or give it the same port.
- **`No Angular CLI at ... Install the project's dependencies first.` on yarn:** under Plug'n'Play there's no `node_modules`, so `smoke.mjs` can't start the CLI, and installing again won't change that. Run `yarn ng serve --port 4287` yourself, fetch the page once it says where it listens, stop it, and say in the report that the page was served but never rendered in Chrome. Angular CLI 22.2.5 built, tested and served an app under Plug'n'Play, though Vite warned that it no longer fixes Plug'n'Play bugs. If `ng test` stops with `vitest tried to access vite (a peer dependency) but it isn't provided by its ancestors`, the app doesn't list `vite` itself, which Plug'n'Play needs. That's the project's to fix, so no test can run: ask, as `SKILL.md` step 3 says.
- **Anything else:** check whether the same error appears in the `smoke.mjs` result from before this major. If it does, it isn't from this upgrade.

## `No matching export in "node_modules/@angular/cdk/fesm2022/collections.mjs" for import "_VIEW_REPEATER_STRATEGY"`

A peer range says which versions a library accepts, not that it works with them. Nebular 17 accepts `@angular/cdk` `^21.0.0`, but it imports a private CDK name that CDK removed in 21.1.0, so the plan's newest CDK breaks the build.

1. Find the newest release in the same major that still exports the name, by unpacking releases with `npm pack` in a temporary folder.
2. Install that exact version, with no override, and run the checks again.
3. Under hand fixes, say which package is held, why, and that it won't get fixes until the library catches up. That also counts toward replacing the library.

## The app shows a license banner after a major (`Invalid PrimeUI License`)

A library's new major can change its license, and the build, tests and `smoke.mjs` all still pass. PrimeNG 21 is MIT, while PrimeNG 22 is the commercial PrimeUI license with a required key and a free tier for small organizations, and it shows a red badge without a key, in production builds too. No PrimeNG 21 release accepts Angular 22. npm can't warn about this: its `license` field says `SEE LICENSE IN LICENSE.md` on both. The plan compares the files and warns before the major for each library it moves, so you should only land here for a package it doesn't, such as a dependency of one of them.

This can cost the person money, so put it first in your report and ask whether to keep the major, stay on the one before, or replace the library. Commit the major first, like any other that passes its checks: it's on its own branch, going back takes one command, and a stop shouldn't leave work uncommitted. Quote the library's own `LICENSE.md` instead of summarizing from memory, and don't add a key or look for a way around the check.

## `Could not resolve "@angular/cdk/overlay"` after a library's new major

```text
✘ [ERROR] Could not resolve "@angular/cdk/overlay"
    node_modules/@ng-select/ng-select/fesm2022/ng-select-ng-select.mjs:3:153:
```

The library's new major started requiring a peer the app doesn't list: ng-select 24 needs `@angular/cdk`. npm, pnpm and bun install a required peer on their own, and yarn doesn't, so this shows on yarn. The plan lists the peer under the major as `not installed`, with the version to install. Install that version and run the checks again.

## A file named in `angular.json` no longer exists

Libraries drop files between majors. `marked` 16 stopped shipping `marked.min.js`, which apps often list under `scripts`. The plan names such a file under the major, in an `angular.json:` line, and otherwise the build fails with `Could not resolve "node_modules/marked/marked.min.js"`. Before removing the entry, search the code for anything using what it provided (a global `marked`, for instance). If nothing does, remove it and say so under hand fixes. If something does, switch that code to an import.

## Whole files show as changed

Migrations and package managers write their own line endings on any OS, and can drop a file's final newline, so a repo that commits CRLF gets whole files back in LF. Compare `git diff --stat` with `git diff --ignore-cr-at-eol --stat`. If the second is much smaller, run `eol.mjs`: it puts back each changed file's endings and final newline as git checks the file out, following `.gitattributes`, and changes nothing else.

A migration can also reformat whole files. Angular 21's control-flow migration re-indents every template it converts, because its `format` option is on by default. Don't rebuild the files from the previous version by hand, since a reviewer has nothing to check that against. Straight after `ng update`, before any hand fix, restore from the last commit only the files whose whole change is the conversion: `git diff -w` shows nothing else in them, apart from the `NgIf`, `NgFor` or `CommonModule` imports it drops. Then run `<ng> generate @angular/core:control-flow --path=src --format=false`, with `<ng>` as `SKILL.md` step 3 runs the project's CLI, which converts them without re-indenting. Keep the migration's output in any file with other changes, such as a component whose inline template another migration also edited. Then carry on from step 4e, so the checks and `eol.mjs` cover what the rerun wrote. For a migration with no such option, keep its output. Either way, tell reviewers to read the diff with `git diff -w`.

## Tests that won't run

- **Karma** needs `--browsers=ChromeHeadless` when there's no display. Upgrading doesn't switch an existing project to Vitest, so don't move test runners as part of this.
- **`CHROME_BIN`:** set it if Chrome isn't found.
- **A spec that fails to compile because of an API change** is the upgrade's to fix. A spec that already failed in step 3 isn't.
- **`Unknown argument: watch`:** the project has no `test` target in `angular.json`. Run what its `package.json` scripts and CI run instead, at the git root too in a monorepo, and say which in your report.
- **The suite stops before any spec runs,** as with Karma's `Found 1 load error` from one spec that doesn't compile: no unit test gives any signal, before or after the upgrade. `SKILL.md` step 3 treats that like a failing build, so ask the person before going on. Read the lines above the load error first: `Cannot load browser` points to the `--browsers` flag, not to a spec.

## Resuming after an interruption

Committed majors are safe. The plan reads the lockfile, so it picks up at the next major on its own. Uncommitted changes from the major that was interrupted can't be trusted to be complete, so stash them as `SKILL.md` describes, reinstall and redo that major. Stashing keeps them recoverable, and reverting them outright wouldn't.

## Node has to change partway

Angular's supported Node range moves with each major, and the plan prints it per major. If the current Node is too old for a later major, stop before that major and ask. Newer Node than a major lists usually still works, so only treat it as a problem if the build or the app check fails.
