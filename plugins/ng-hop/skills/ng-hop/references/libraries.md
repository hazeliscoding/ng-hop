# Upgrading a library you publish

A workspace of Angular libraries goes up a major the way an app does, through `ng update` one major at a time. Two things an app doesn't have move with it: each library's own peer ranges and version, and the publish that lets the apps using it follow.

## What's different in a library workspace

- **The plan and `ng update` work as for an app.** They read the workspace's `package.json`, which holds Angular and the build tools. Each library's `projects/<name>/package.json` is what apps install, and nothing moves it for you.
- **There may be no app to run.** `smoke.mjs` needs a `serve` target. In a workspace of libraries only, the build and the tests are the checks, and the apps that use the libraries are where they really run, so say that the app check didn't apply.
- **Build and test with the workspace's own scripts.** With several libraries, a plain `ng build` stops with `Cannot determine project for command.`, and a library that imports another from the same workspace builds against it from `dist`, so the one it needs has to be built first, for its tests too. For the starting point and every check, use the workspace's build and test scripts, or `ng build <library>` for each in dependency order before `ng test`, run through the workspace's package manager as `SKILL.md` step 3 runs `<ng>`, the same way before and after, and say which in the report.

## Move each library to the new major

After the workspace's `ng update`, for each library:

1. **Its Angular peers:** move every `@angular/*` peer range to the new major, such as `^22.0.0`. A library built with Angular 22's compiler isn't promised to work on 21, so move the range rather than widening it.
2. **Its peers and dependencies on the team's other libraries:** move them to the releases you're about to publish, such as `"@acme/ui-core": "^22.0.0"`.
3. **Its version:** a new major, since dropping the old Angular breaks its users. Follow how its history numbers releases (many internal libraries match Angular's major), and ask if that isn't clear.
4. **Its changelog,** if it keeps one.

Then build every library, run their tests and commit, as for any major. Say under hand fixes which ranges and versions you moved.

## Publishing waits for the person

Publishing changes what every app using the library installs, and a version number can't be published twice. So stop before it. Name each package and version, the commit they come from, on a branch nobody has pushed or reviewed yet, and the registry each would go to, as a dry run prints it from where the publish runs, usually the workspace root: `pnpm publish <its dist folder> --dry-run --no-git-checks` (pnpm's own check refuses any branch but main or master by default, even for a dry run) or `npm publish <its dist folder> --dry-run`. The registry can come from the workspace's `.npmrc` or from the library's own `publishConfig`, and pnpm and npm disagree on which wins. Run from inside the dist folder, neither reads the workspace's `.npmrc` at all, so a library with no `publishConfig` would go to the public registry. Then ask. Once they say yes, build from that commit and use the workspace's own publish script if it has one, or publish them one at a time in the order the app's plan gave.

Then go back to the app and run the plan again. The app moves one major at a time, so it needs a release for each major it crosses. When it's more than one behind, take the libraries only to the major the app's plan names (`--to <major>`), publish, move the app, and repeat. On pnpm 11 or newer, or yarn 4.15 or newer, a release less than a day old is held back, so the app's plan shows the major that needs it as `waiting until` the release is a day old, or, from a registry that gives it no publish time, as `waiting on a publish time from the registry`: ask, as `SKILL.md` says.
