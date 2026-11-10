# Security

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/hazeliscoding/ng-hop/security/advisories/new) instead of opening a public issue.

## What the skill does on your machine

- **`plan.mjs`** reads `package.json` and your lockfile, and reads package data from your npm registry. For the minimum release age, it reads your package manager's own settings: `pnpm-workspace.yaml` or `.yarnrc.yml`, their global files, and the environment. It never runs code from your repo, such as a `yarnPath` release, a yarn plugin, or an `npm` your repo puts on a relative `PATH` entry. When nothing pins pnpm or yarn to one version, it asks the one you have installed for its version, from an empty folder it makes in your home folder and then removes. npm runs without a shell, and keeps its log and cache in a temporary folder the plan removes, whatever your repo's `.npmrc` says. It changes nothing. Dependency names from `package.json` are treated as untrusted: a name that isn't a valid npm name never reaches a URL or a command.
- **`guide.mjs`** downloads Angular's Update Guide data from GitHub and parses it as text. It never runs it.
- **`smoke.mjs`** starts your app's dev server on `127.0.0.1` and, if Chrome is installed, opens the page in a temporary headless profile. This runs your app's code, the same as `ng serve` would.
- **`update.mjs`** runs the planned `ng update` through pnpm, or through npm on a yarn project. When that project's `package.json` has `devEngines`, which npm would refuse, npm runs for a private temporary folder instead, holding a copy of your project's `.npmrc`, tokens included, and the script removes it afterwards, unless the run is killed.
- **The upgrade itself** runs `ng update` and your package manager, which download and run package code, including migrations. That's true of any Angular upgrade.

The skill commits locally on a new branch and never pushes.

## Privacy

ng-hop has no telemetry and no server of its own. It talks only to your npm registry and GitHub. Your agent's own data handling is separate, so check its documentation.
