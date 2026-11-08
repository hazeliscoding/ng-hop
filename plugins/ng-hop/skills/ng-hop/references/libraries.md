# Upgrading a library you publish

A workspace of Angular libraries goes up a major the way an app does, through `ng update` one major at a time. Two things an app doesn't have move with it: each library's own peer ranges and version, and the publish that lets the apps using it follow.

## What's different in a library workspace

- **The plan and `ng update` work as for an app.** They read the workspace's `package.json`, which holds Angular and the build tools. Each library's `projects/<name>/package.json` is what apps install, and nothing moves it for you.
- **There may be no app to run.** `smoke.mjs` needs a `serve` target. In a workspace of libraries only, the build and the tests are the checks, and the apps that use the libraries are where they really run, so say that the app check didn't apply.
- **Build in dependency order.** A library that imports another from the same workspace builds against it from `dist`, so the one it needs builds first. The workspace's own scripts usually do this already.

## Move each library to the new major

After the workspace's `ng update`, for each library:

1. **Its Angular peers:** move every `@angular/*` peer range to the new major, such as `^22.0.0`. A library built with Angular 22's compiler isn't promised to work on 21, so move the range rather than widening it.
2. **Its peers on the team's other libraries:** move them to the releases you're about to publish, such as `"@acme/ui-core": "^22.0.0"`.
3. **Its version:** a new major, since dropping the old Angular breaks its users. Follow how its history numbers releases (many internal libraries match Angular's major), and ask if that isn't clear.
4. **Its changelog,** if it keeps one.

Then build every library, run their tests and commit, as for any major. Say under hand fixes which ranges and versions you moved.

## Publishing waits for the person

Publishing changes what every app using the library installs, and a version number can't be published twice. So stop before it: name each package and version you'd publish, and the registry the repo's `.npmrc` sends it to, and ask. Once they say yes, use the workspace's own publish script if it has one. Then go back to the app and run the plan again: the libraries shouldn't block it any more.
