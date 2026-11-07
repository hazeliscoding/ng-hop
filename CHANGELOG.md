# Changelog

## 0.1.0 (unreleased)

The first release.

- **A plan before anything changes:** `plan.mjs` reads your lockfile and npm's real peer ranges and publish dates, and says how far you can go, what moves at each major, and what blocks you.
- **One major at a time:** each hop runs `ng update` with Angular's migrations, then checks the build, the tests and the running app, and commits. Every commit is safe to stop on.
- **Stops at a blocker:** when a library has no release for the next major, the skill stops there and asks whether to wait, replace it or force it. It never forces, overrides or downgrades without asking.
- **pnpm:** real upgrades on pnpm 12, including an app inside a workspace. It declines undecided install scripts rather than approving them, and refuses an app whose Angular comes from a catalog, because `ng update` can't move those packages.
- **Warns before a license change:** the plan compares the license files of each library it moves, and the skill stops before a major that changes one, such as PrimeNG 22 going from MIT to commercial.
- **Says what npm doesn't:** a peer a library newly requires, what a library's new major changed, and Angular's Node minimum. A library that still accepts the new Angular through an open-ended range stays where it is.
- **Evals on GitHub's machines:** 25 cases, run with and without the skill, rebuilt by the grader, with the login kept away from anything an npm package can run. The scores are in the README.
- **Other agents:** a plain Agent Skill that OpenCode and GitHub Copilot can read. OpenCode has run it on one question. Copilot is checked from its docs only.
