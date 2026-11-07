<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-dark.svg">
    <img src="docs/brand/lockup.svg" alt="ng-hop" height="72">
  </picture>
</p>

<p align="center"><strong>Upgrade an Angular app one tested major at a time, without forcing past the libraries that aren't ready.</strong></p>

An Angular upgrade fails on your dependencies, not on Angular. Library version numbers rarely match Angular's, some libraries lag behind, and an old release can claim to support a major it predates. `--force` makes the error go away and leaves you to find out what broke. ng-hop is an agent skill that works out how far your whole app can go today, moves it there one commit per major, and asks you when a library is in the way.

**Status:** 0.1.0, the first release. See [ROADMAP.md](ROADMAP.md) for what's next.

![Claude Code loads ng-hop, plans the upgrade, moves an Angular 20 app to 21, gets past a build break without forcing anything, commits, and stops to ask what to do about Nebular, which blocks Angular 22](docs/demo/upgrade.gif)

A real upgrade of an Angular 20 app that uses Nebular, with Claude Opus 5.5, sped up 6× with the last frame held. The agent took 4 minutes 17 seconds. Afterwards, a fresh clone of its branch installed, built, passed its test and ran.

## What it does

This is the plan for a real Angular 20 app that uses Nebular, on 2026-11-05:

```text
> Upgrade this app to Angular 22.

Angular 20.3.35 (from lockfile), npm, Node 24.20.0. Latest Angular: 22.2.4.
Result: BLOCKED at Angular 22. Angular 21 is the highest version everything supports today.

Angular 21 (21.2.26)
  Node: ok (needs ^20.19.0 || ^22.12.0 || >=24.0.0)
  @angular/cdk: 20.2.14 -> 21.2.14; supports it (^21.0.0 || ^22.0.0); ships migrations
  @nebular/theme: 16.0.0 -> 17.0.0; supports it (^21.0.0)
  @nebular/eva-icons: 16.0.0 -> 17.0.0; moves with its peer (@nebular/theme 17.0.0)
  Run: npx --no-install ng update @angular/core@21 @angular/cli@21 @angular/cdk@21.2.14 @nebular/theme@17.0.0 @nebular/eva-icons@17.0.0

Blockers
  Angular 22: @nebular/theme: no stable release at or above 17.0.0 supports Angular 22; the latest, 17.0.0 (2026-01-15), requires ^21.0.0.
```

The skill then upgrades to 21, commits that with the build, tests and running app checked, and stops to ask whether to wait for Nebular, replace it or force it.

In the recording, the plan's newest `@angular/cdk` breaks the build, because Nebular 17 imports a private name that CDK removed in 21.1. No peer range shows that, which is why the app gets built at every major. The agent finds the last release that still has the name, pins it with no override, and lists it as a hand fix for review.

- **Finds the ceiling first,** in seconds, from npm's own data, before anything changes.
- **Follows peer ranges, not version numbers.** For Angular 22, `@clr/angular` is 18.5.0 and `@ng-select/ng-select` is 24.2.1.
- **Never downgrades to get past a check.** `ngx-toastr` 19.1.0 accepts Angular 22 through an open-ended range, but it predates Angular 22 and is older than what you have, so the plan rejects it.
- **Says what npm can't confirm.** Open-ended ranges and libraries with no Angular peer are called out, and checked in the running app. A library that still works stays where it is.
- **Warns before a license change.** PrimeNG 22 is commercial where 21 was MIT, and nothing fails, so the plan compares the license files and the skill stops to ask before that major.
- **Names what npm adds quietly.** ng-select 24 started requiring `@angular/cdk`, which npm installs without a word. The plan says so, and the report covers what each library's new major changed.
- **Makes every major a commit you can stop on.** An interrupted upgrade picks up at the next major.
- **Runs the app, not just the build.** On real upgrades the dev server broke while the build and tests stayed green.
- **Stays in scope.** No optional migrations, no rewritten tests, no drive-by bumps.

## How well it works

Each case is a real Angular app built from real npm packages, given to Claude Code three times with ng-hop and three times without. The grader then reinstalls, builds, tests and runs whatever each agent left, so no score rests on what an agent says it did. The cases and the grader are in [`evals/`](evals/).

On 2026-11-07, with 25 cases, Claude Opus 5.5 and Claude Code 2.1.319, on GitHub's Linux machines:

| The same checks for both | With ng-hop | Claude Code alone |
|---|---|---|
| **The result:** the app installs, builds, passes its tests and runs, and the person is told what they need to know | 498/498 | 464/489 (95%) |
| **The process:** one commit per major, on a branch, no `ng update` over uncommitted work, and asking before a license change | 108/108 | 49/108 (45%) |
| Time and usage for 75 runs | 112 min, $18.97 | 98 min, $13.01 |

Claude Code alone is already good at this. It tied on 10 of the 25 cases, including every question about how far an app can go. Nobody asked it to commit, so the process row mostly shows what ng-hop does by default. Nine of its result checks couldn't run, because the install they needed failed first.

Where the result differed, it was in all three runs each time. Without ng-hop, Claude Code:

- **left a blank page** in `upgrade-markdown-chain`. The build and tests passed, the app rendered nothing, and it reported success. ng-hop's app check caught that and fixed it.
- **ran `ng update` over uncommitted work** in `dirty-tree`, where ng-hop stopped and asked.
- **set aside changes it couldn't explain without asking** in `unexplained-upgrade-changes`, though it said so afterwards.
- **left a lockfile that won't install** in `upgrade-pnpm-undecided-scripts`, because pnpm refuses until someone decides about install scripts. ng-hop declined them, which is what pnpm was already doing, and committed that.
- **didn't mention Angular 22's higher Node minimum**, which CI and deployment images need, or PrimeNG 22's new license when asked which versions to use.
- **stopped at Angular 20** to ask about PrimeNG's license, before doing the move to 21 that everything supports.

What the score doesn't show:

- **100% means passing every check written so far.** The checks come from the same place as the skill. Twice the score was 100% while something was wrong, and it took reading the answers to find it. An earlier version moved an app onto PrimeNG 22's commercial license without a word in 5 of 6 runs, where Claude Code alone flagged it every time. Later, its reports left out a library's new required package and Angular's Node minimum. All of these are fixed, and each now has a check.
- **The cases read the live npm registry,** so they describe libraries as they were on that date.
- **Only Claude Code on Linux has full evals.** See the table below for other agents.
- **It loads when it should.** On 22 test prompts, 10 of them held back from tuning the description, it loaded when it should and stayed out when it shouldn't every time, over three runs each.

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
