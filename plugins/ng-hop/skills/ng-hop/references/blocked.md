# When a library blocks the next major

Everything up to the ceiling should be committed before you ask. Then put the choice to the person with facts, so they can decide in one reply.

## Gather the facts

For each blocker, from the plan and a quick search:

- **What it requires, and how old it is:** the plan prints the latest release, its Angular range and its publish date. A release from last month means support may be coming. One from two years ago probably isn't.
- **How much the app uses it:** count the files that import it (for example `git grep -l "<package>" -- src`). Three files and three hundred are different decisions.
- **Whether it's used at all.** If nothing imports it, removing it clears the blocker, and that's your recommendation. Search for its imports and selectors across `src` instead of reading a few files, because a template can sit inside a component's `.ts` file.
- **Any sign of support on the way:** a prerelease in the plan's output, or an open issue or pull request on its repository. Say what you found, and say so if you didn't look.
- **Whether it's the person's own.** The plan says when a blocker comes from their own registry, and in which order to upgrade several. Its source is usually in a repository of its own, so ask where.

## The choices

**Upgrade it first.** When the plan says a blocker comes from the person's own registry, it's most likely their team's library, and waiting would only wait on themselves. Work in that library's repository, with this skill and `references/libraries.md`, in the order the plan gives, and publish once they say so. Then come back to the app and run the plan again. Recommend this for their own libraries, and say which needs which.

**Wait.** Stay on the ceiling, with the work committed, and run the plan again later. It costs nothing and the app is already further along than it was. This is the usual recommendation for a maintained library, especially when the Angular major is recent.

**Replace.** Move to a library that supports the target, or remove the need for one. This is a real project of its own, so don't start it unprompted. Before suggesting a replacement, check that it actually supports the target: put it in a scratch `package.json` and run the plan on that, or read its release's peer range. Recommend this when the library looks abandoned or is deprecated on npm, or when the app barely uses it.

**Force.** Install anyway, with an override telling the package manager to ignore the mismatch. It can work: a peer range is only a promise, and many libraries run fine on the next major. But nobody has tested this combination, and the failure may only show at runtime in a flow nobody checks. Recommend it only when the library is small or its use is narrow enough to check by hand, and say what would need checking.

**Use a prerelease.** Only an option when the plan reports one, and it behaves like a smaller version of forcing: the library's authors have started, but they haven't said it's ready.

## End with one question

Name the blocker, give your recommendation and the reason, and ask. For example:

> You're on Angular 21 now, committed and passing. `@nebular/theme` is the one thing blocking 22: its latest release is from January and requires Angular 21, and 14 files import it. I'd wait, because it has had a release for every Angular major so far. Do you want to wait, replace it, or try forcing it?

Or, when the blockers are their own:

> This app is on Angular 21, and only your own libraries block 22: `@acme/ui-core` and `@acme/ui-forms`, both from your registry, both requiring Angular 21. I'd upgrade them first, `@acme/ui-core` and then `@acme/ui-forms`, which needs it, publish both, and then come back for this app. Where is their repository, and shall I start there?

## Only if they choose to force

Do it as its own commit, so it's easy to revert and easy to see in review.

1. Add the override, narrowly, for this library's Angular peers only:
   - **npm:** `overrides` in `package.json`, such as `{ "@nebular/theme": { "@angular/core": "$@angular/core" } }`, with one entry for each Angular package it names as a peer.
   - **pnpm 11 or newer:** `peerDependencyRules.allowedVersions` in `pnpm-workspace.yaml`, with one entry for each Angular package it names as a peer, such as `'@nebular/theme>@angular/core': '22'`. These versions ignore the `pnpm` field in `package.json`. pnpm's docs call this setting deprecated in favour of `overrides` with `:peer`, but on pnpm 12.16.1 that form fails with `ERR_PNPM_INVALID_SELECTOR`, so try it first only on a newer pnpm.
   - **pnpm 10 or older:** `pnpm.peerDependencyRules.allowedVersions` in `package.json`.
   - **yarn:** `resolutions`, which is less precise, so name exact versions.
2. Run the `ng update` for the major with `--force`, since the peer check would otherwise stop it. Passing `--force` is what they just approved.
3. Run the full checks from the skill, and then exercise what the library actually does in the app, since that's the risk being taken. Don't count a page that renders as proof, if the library's components aren't on that page.
4. Report it plainly: the library is running unsupported on this major, what you checked, and what you didn't.
