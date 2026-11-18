# Changelog

## Unreleased

- **Lint and modernization:** baseline the repo's existing lint commands, then ask whether to modernize the affected code now or preserve supported behavior with explicitly approved, scoped exceptions. Keep the choice within its agreed scope, retain per-major checks, and report deferred work. Angular 22's Eager/OnPush lint conflict is an example, not a requirement to make every variable a signal.

## 0.5.0 (2026-11-16)

The first release since 0.1.0. It carries what was planned as 0.2.0 to 0.5.0.

- **Release age:** the plan holds back a release younger than pnpm's, yarn's, npm's or bun's minimum release age, as the package manager and `ng update` do, and says how long the wait is.
- **Your team's own libraries:** when a blocking library comes from your registry, the plan says so and gives the order to upgrade them in. `examples/enterprise` is a whole setup to try it on, with a video.
- **Workspaces:** an app inside an npm, yarn or bun workspace gets a plan, from the root's lockfile and `.npmrc`.
- **pnpm catalogs:** an app whose Angular comes from a catalog is upgraded instead of refused.
- **yarn and bun:** real upgrades from Angular 20 to 22 pass on both. The app check also runs under yarn's Plug'n'Play.
- **Asks before sending a secret:** when the repo's `.npmrc` takes a value from your environment, the plan stops before any request and names it, and goes on with `--send-env` after your yes.
- **Node:** the plan names the repo's own Node pins below a major's range, a pin it can't read, such as `lts/iron`, and a Node major too new for that Angular's CLI to start on.
- **The app check:** it sees every console error through Chrome's DevTools protocol, and the dev server's errors after startup.
- **More in the plan:** a deprecated framework package, the licenses of what a moved library brings with it, a file `angular.json` loads that the next release drops, and `--next` for a prerelease Angular.
- **Other agents and Windows:** OpenCode took a whole upgrade from Angular 20 to 22 on Windows. The plan's real commands run on Windows on every change.
- **Evals:** the question cases run weekly, and the enterprise example is one of them.

## 0.1.0 (2026-11-07)

The first release.

- **A plan before anything changes:** `plan.mjs` reads your lockfile and npm's real peer ranges and publish dates, and says how far you can go, what moves at each major, and what blocks you.
- **One major at a time:** each hop runs `ng update` with Angular's migrations, then checks the build, the tests and the running app, and commits. Every commit is safe to stop on.
- **Stops at a blocker:** when a library has no release for the next major, the skill stops there and asks whether to wait, replace it or force it. It never forces, overrides or downgrades without asking.
- **pnpm:** real upgrades on pnpm 12, including an app inside a workspace. It declines undecided install scripts rather than approving them, and refuses an app whose Angular comes from a catalog, because `ng update` can't move those packages.
- **Warns before a license change:** the plan compares the license files of each library it moves, and the skill stops before a major that changes one, such as PrimeNG 22 going from MIT to commercial.
- **Says what npm doesn't:** a peer a library newly requires, what a library's new major changed, and Angular's Node minimum. A library that still accepts the new Angular through an open-ended range stays where it is.
- **Evals on GitHub's machines:** 25 cases, run with and without the skill, rebuilt by the grader, with the login kept away from anything an npm package can run. The scores are in the README.
- **Other agents:** a plain Agent Skill that OpenCode and GitHub Copilot can read. OpenCode has run it on one question. Copilot is checked from its docs only.
