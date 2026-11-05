# When a library blocks the next major

Everything up to the ceiling should be committed before you ask. Then put the choice to the person with facts, so they can decide in one reply.

## Gather the facts

For each blocker, from the plan and a quick search:

- **What it requires, and how old it is:** the plan prints the latest release, its Angular range and its publish date. A release from last month means support may be coming. One from two years ago probably isn't.
- **How much the app uses it:** count the files that import it (for example `git grep -l "<package>" -- src`). Three files and three hundred are different decisions.
- **Whether it's used at all.** If nothing imports it, removing it clears the blocker, and that's your recommendation.
- **Any sign of support on the way:** a prerelease in the plan's output, or an open issue or pull request on its repository. Say what you found, and say so if you didn't look.

## The choices

**Wait.** Stay on the ceiling, with the work committed, and run the plan again later. It costs nothing and the app is already further along than it was. This is the usual recommendation for a maintained library, especially when the Angular major is recent.

**Replace.** Move to a library that supports the target, or remove the need for one. This is a real project of its own, so don't start it unprompted. Before suggesting a replacement, check that it actually supports the target: put it in a scratch `package.json` and run the plan on that, or read its release's peer range. Recommend this when the library looks abandoned or is deprecated on npm, or when the app barely uses it.

**Force.** Install anyway, with an override telling the package manager to ignore the mismatch. It can work: a peer range is only a promise, and many libraries run fine on the next major. But nobody has tested this combination, and the failure may only show at runtime in a flow nobody checks. Recommend it only when the library is small or its use is narrow enough to check by hand, and say what would need checking.

**Use a prerelease.** Only an option when the plan reports one, and it behaves like a smaller version of forcing: the library's authors have started, but they haven't said it's ready.

## End with one question

Name the blocker, give your recommendation and the reason, and ask. For example:

> You're on Angular 21 now, committed and passing. `@nebular/theme` is the one thing blocking 22: its latest release is from January and requires Angular 21, and 14 files import it. I'd wait, because it has had a release for every Angular major so far. Do you want to wait, replace it, or try forcing it?

## Only if they choose to force

Do it as its own commit, so it's easy to revert and easy to see in review.

1. Add the override, narrowly, for this library's Angular peers only:
   - **npm:** `overrides` in `package.json`, such as `{ "@nebular/theme": { "@angular/core": "$@angular/core" } }`, with one entry for each Angular package it names as a peer.
   - **pnpm 11 or newer:** `peerDependencyRules.allowedVersions` in `pnpm-workspace.yaml`. These versions ignore the `pnpm` field in `package.json`.
   - **pnpm 10 or older:** `pnpm.peerDependencyRules.allowedVersions` in `package.json`.
   - **yarn:** `resolutions`, which is less precise, so name exact versions.
2. Run the `ng update` for the major with `--force`, since the peer check would otherwise stop it. Passing `--force` is what they just approved.
3. Run the full checks from the skill, and then exercise what the library actually does in the app, since that's the risk being taken. Don't count a page that renders as proof, if the library's components aren't on that page.
4. Report it plainly: the library is running unsupported on this major, what you checked, and what you didn't.
