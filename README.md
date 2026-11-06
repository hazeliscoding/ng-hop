<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-dark.svg">
    <img src="docs/brand/lockup.svg" alt="ng-hop" height="72">
  </picture>
</p>

<p align="center"><strong>Upgrade an Angular app one tested major at a time, without forcing past the libraries that aren't ready.</strong></p>

An Angular upgrade fails on your dependencies, not on Angular. Library version numbers rarely match Angular's, some libraries lag behind, and an old release can claim to support a major it predates. `--force` makes the error go away and leaves you to find out what broke. ng-hop is an agent skill that works out how far your whole app can go today, moves it there one commit per major, and asks you when a library is in the way.

**Status:** in development. See [ROADMAP.md](ROADMAP.md).

## What it does

```text
> Upgrade this app to Angular 22.

Result: BLOCKED at Angular 22. Angular 21 is the highest version everything supports today.

Angular 21 (21.2.26)
  @nebular/theme: 16.0.0 -> 17.0.0; supports it (^21.0.0)
  primeng: 20.0.0 -> 21.1.10; supports it (^21.0.0)
  ag-grid-angular: 34.0.0 -> 36.3.0; UNCONFIRMED: open-ended range, check the running app (>= 20.0.0)
  Run: npx --no-install ng update @angular/core@21 @angular/cli@21 @nebular/theme@17.0.0 ag-grid-angular@36.3.0 primeng@21.1.10

Blockers
  Angular 22: @nebular/theme: no stable release at or above 17.0.0 supports Angular 22;
  the latest, 17.0.0 (2026-01-15), requires ^21.0.0.
```

It upgrades to 21, commits it with the build, tests and running app checked, then stops: *14 files import Nebular, and it's had a release for every Angular major so far. I'd wait. Do you want to wait, replace it, or try forcing it?*

- **Finds the ceiling first,** in seconds, from npm's own data, before anything changes.
- **Follows peer ranges, not version numbers.** For Angular 22, `@clr/angular` is 18.5.0 and `ag-grid-angular` is 36.3.0.
- **Never downgrades to get past a check.** `ngx-toastr` 19.1.0 accepts Angular 22 through an open-ended range, but it predates Angular 22 and is older than what you have, so the plan rejects it.
- **Says what npm can't confirm.** Open-ended ranges and libraries with no Angular peer are called out, and checked in the running app.
- **Makes every major a commit you can stop on.** An interrupted upgrade picks up at the next major.
- **Runs the app, not just the build.** On real upgrades the dev server broke while the build and tests stayed green.
- **Stays in scope.** No optional migrations, no rewritten tests, no drive-by bumps.

## Install

```sh
claude plugin marketplace add hazeliscoding/ng-hop
claude plugin install ng-hop@ng-hop
```

It needs Node 18 or newer, and nothing else.

Real upgrades have run on npm and on pnpm 12, including an app inside a pnpm workspace. The plan refuses an app whose Angular comes from a pnpm catalog, because `ng update` can't move those packages. yarn and bun get the right commands, but no real upgrade has run on them yet.

### Other agents

The skill is a plain [Agent Skill](https://agentskills.io): a `SKILL.md` and Node scripts, with nothing tied to Claude Code. The plugin commands above are Claude Code's, so elsewhere you copy the folder instead:

```sh
git clone https://github.com/hazeliscoding/ng-hop
cp -r ng-hop/plugins/ng-hop/skills/ng-hop your-app/.agents/skills/ng-hop
```

| Agent | Folder it reads | How far this is checked |
|---|---|---|
| Claude Code | installed by the plugin | Full evals, with and without the skill |
| [OpenCode](https://opencode.ai/docs/skills) | `.agents/skills/` or `.opencode/skills/` | Run for real on v2.2.0: it found the skill, ran the plan and answered correctly. No full upgrade tested yet. |
| [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills) | `.agents/skills/` or `.github/skills/` | From Copilot's docs only. Not run yet, so please report what you find. |

## Use it

Ask in your own words: "upgrade this to Angular 22", "how far can I upgrade?", "does PrimeNG support 22?", or paste an `ng update` error.

To see the plan by itself, with no agent involved:

```sh
node plugins/ng-hop/skills/ng-hop/scripts/plan.mjs --project path/to/app --to 22
```

## Contributing

Bug reports are most useful when they include the `plan.mjs` output and the error. See [AGENTS.md](AGENTS.md) for how the repo works.

## License

[MIT](LICENSE). The bundled `semver` is ISC.
