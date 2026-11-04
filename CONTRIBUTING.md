# Contributing

Thanks for looking. The most useful thing you can send is a real upgrade that went wrong.

## Reporting a problem

Open an issue with:

- The output of `plan.mjs` for your project (`node plugins/ng-hop/skills/ng-hop/scripts/plan.mjs --to <major>`). It lists your Angular and library versions, so check it before posting if any of those are private.
- The exact error, since the troubleshooting guide is searched by error text.
- Which agent you used. Claude Code gets the most testing, and reports from OpenCode and GitHub Copilot help a lot.

## Changing the code

```sh
npm test    # no install step, and offline: the tests run against a fake npm registry
```

- Read [AGENTS.md](AGENTS.md) first. Its hard rules are why people can trust the plan.
- New plan behaviour starts with a test in `test/plan.test.mjs`. If a real library is why the rule exists, name it in the test.
- A check that looks for an absence needs a positive control that proves it can fail.
- The scripts have no dependencies beyond the vendored `semver`, because skills run with no install step.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## Changing the skill's instructions

A change to `SKILL.md` should be backed by an eval that moves. `evals/` runs real upgrades in clean sessions, with and without the skill, and rebuilds every result. These cost money and take a while, so you don't need to run them for a small fix: say in your pull request what you expect to change, and they'll get run before a release.
