# AGENTS.md

Working rules for agents in this repo. ng-hop is an agent skill that upgrades an Angular app one tested major at a time, with its UI libraries (MIT). It ships as a Claude Code plugin, and `plugins/ng-hop/skills/ng-hop/` also works as a plain Agent Skill.

## Sources of truth

- `README.md`: the pitch, and the eval scores.
- `ROADMAP.md`: decisions already made, milestones, and what's out of scope. Work from the next unchecked item, tick it off, and record new or changed decisions there. Mark a changed decision superseded instead of deleting it.
- GitHub issues are for bug reports and contributor tasks. Planned work stays in `ROADMAP.md`.
- Angular and library facts come from npm and from Angular's own source. Never from memory, and never as a table in this repo, because a table is what goes stale.

## Commands

```sh
npm test                                   # the fake-registry tests, offline; Chrome tests skip if Chrome is missing
claude plugin validate .                   # the marketplace manifest
claude plugin validate plugins/ng-hop      # the plugin manifest

node evals/prepare.mjs                     # builds the fixture apps into ../ng-hop-workspace, slow the first time
node evals/run.mjs --iteration 1 --tier plan           # questions and refusals, with and without the skill
node evals/run.mjs --iteration 1 --case upgrade-blocked   # one whole upgrade, rebuilt by the grader
```

Evals spend real money and take real time, so run them only when a change could move a result. They run one session at a time because each real build can hold gigabytes.

Keep commands cross-platform, because the owner develops on Windows. Node scripts, not bash.

## Hard rules

Each of these protects one of the three things in `ROADMAP.md`.

- **The skill never guesses a version.** `plan.mjs` decides from peer ranges and publish dates. If it can't reach the registry it makes no plan, because a plan built on a failed lookup looks like a clean bill of health.
- **The skill never forces, overrides or downgrades without the person's approval.** Those hide the conflict the plan exists to surface.
- **Every commit the skill makes is safe to stop on,** with the build, tests and running app checked against how they were before.
- **`package.json` is untrusted input.** No shell around npm, no name that fails `VALID_NAME` in a URL or a command. This caught a real command injection on Windows.
- **The scripts have no install step and no dependencies** beyond the vendored `semver`. Don't edit `scripts/vendor/` by hand: `VENDORED.md` has the commands.
- **Any check for an absence needs a positive control.** `smoke.test.mjs` has apps that must fail, and they caught a bug that let crashing apps pass. Prove a new check by showing it fail on the thing it exists to catch.
- **An eval's grader rebuilds the result itself.** Never grade on what the agent's final message claims happened, except for assertions about what the message says.

## Skill conventions

- `SKILL.md` holds the workflow and stays under 500 lines. Detail goes in `references/`, loaded only when needed.
- Explain the reason for each rule instead of shouting it. Models apply reasons to cases nobody foresaw. Keep the description under 1024 characters.
- Scripts print plain text for people by default and JSON with `--json`, and they exit 0 for fine, non-zero with a one-line reason otherwise.
- Add behaviour to the plan through a test on the fake registry first. Use real library names in tests when a real library is why the rule exists.
- When real-world behaviour teaches something (a crash, a dropped file), add it to `references/troubleshooting.md` with the exact error text, since that's what the next agent will search for.

## Dependencies

- A special-purpose dev tool for tests or evals is fine, with its reason in the commit.
- A general-purpose helper only after checking nothing in the project already does the job.
- Anything the skill itself needs at runtime: ask first, because it would break the no-install promise. A framework: never without asking.

## Commits

Conventional Commits, atomic, with no AI attribution. Scopes in use: `plan`, `guide`, `smoke`, `skill`, `evals`, `brand`.
