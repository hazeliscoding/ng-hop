# When a library blocks the next major

Everything up to the ceiling should be committed before you ask. Then put the choice to the person with facts, so they can decide in one reply.

## Gather the facts

For each blocker, from the plan and a quick search:

- **What it requires, and how old it is:** the plan prints the latest release, its Angular range and its publish date. A release from last month means support may be coming. One from two years ago probably isn't.
- **How much the app uses it:** count the files that import it (for example `git grep -l "<package>" -- src`). Three files and three hundred are different decisions.
- **Whether it's used at all.** If nothing imports it, removing it clears the blocker, and that's your recommendation. Search for its imports and selectors across `src` instead of reading a few files, because a template can sit inside a component's `.ts` file.
- **Any sign of support on the way:** a prerelease in the plan's output, or an open issue or pull request on its repository. Say what you found, and say so if you didn't look.
- **Whether it's the person's own.** The plan says when a blocker's scope has a registry of its own in their npm config, and in which order to upgrade several. That's how a company publishes its own libraries, but it's also how a vendor ships a paid one: Font Awesome Pro's customers point `@fortawesome` at Font Awesome's registry, and Infragistics' point `@infragistics` at theirs. So confirm it's the team's before recommending they upgrade it first: its repository and author (`npm view <package> repository.url author`) should be theirs, and if that doesn't settle it, ask. Their own library's source is usually in a repository of its own, so ask where.

## The choices

**Upgrade it first.** When the blocker is the team's own library, waiting would only wait on themselves. Work in that library's repository, with this skill and `references/libraries.md`, to the Angular major the plan names, in the order it gives, and publish once they say so. Libraries the plan says need each other have no order between them, so upgrade and publish them together. Then come back to the app and run the plan again. Recommend this for their own libraries, once you've confirmed they are, and say which needs which. A vendor's library behind a registry of its own is a maintained library like any other, so for one of those, waiting is usually right.

**Wait.** Stay on the ceiling, with the work committed, and run the plan again later. It costs nothing and the app is already further along than it was. This is the usual recommendation for a maintained library, especially when the Angular major is recent.

**Replace.** Move to a library that supports the target, or remove the need for one. This is a real project of its own, so don't start it unprompted. Before suggesting a replacement, check that it actually supports the target: put it in a scratch `package.json` and run the plan on that, or read its release's peer range. Recommend this when the library looks abandoned or is deprecated on npm, or when the app barely uses it.

**Force.** Install anyway, with an override telling the package manager to ignore the mismatch. It can work: a peer range is only a promise, and many libraries run fine on the next major. But nobody has tested this combination, and the failure may only show at runtime in a flow nobody checks. Recommend it only when the library is small or its use is narrow enough to check by hand, and say what would need checking.

**Use a prerelease.** Only an option when the plan reports one, and it behaves like a smaller version of forcing: the library's authors have started, but they haven't said it's ready.

## When a major is waiting on young releases

The plan prints a major as `waiting until` a time when a release it needs is younger than the package manager's minimum release age. Nothing is known to be wrong with that release: the age is a window for a compromised release to be caught and pulled before it reaches the team.

- **Which releases, and until when:** the major's lines and its `Blockers` give each one's publish time and when it's old enough.
- **Whose they are:** the team's own, just published (confirm with `npm view <package> repository.url author`), or anyone else's.
- **Whether there's a sooner way:** `No sooner way:` says why there's none: Angular itself is too young, or has no publish time on the registry, a library ships migrations that installing it first would skip, `ng update` applies npm's setting itself and reads no exemption list, or the project's npm has no `min-release-age-exclude`, which npm 11.17 added. Then only waiting gets past it, for the registry when Angular has no publish time, or under npm's `before` only moving that setting.

**Wait** costs only the time shown. Recommend it for anyone else's library.

**Exempt those releases,** in a commit of their own, then run the plan's `Sooner, once ...` command as printed. That relaxes the guard, so for the team's own release it's reasonable if they trust their registry, and it's still their call. Offer the narrowest entry first, a release on pnpm and yarn or a package on npm and bun, before one for the whole scope, which lets every future release of the scope through. Keep the entry committed until the release is old enough: pnpm 12 checks the lockfile against the age, and without the entry every install, frozen or not, fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. Say in the report what was exempted.

- **pnpm:** `pnpm-workspace.yaml` at the workspace root, `minimumReleaseAgeExclude:` with `- '@acme/ui-core@22.0.0'`, or `- '@acme/*'` for the scope.
- **yarn:** `.yarnrc.yml`, `npmPreapprovedPackages:` with `- "@acme/ui-core@22.0.0"`.
- **npm 11.17 or newer:** `.npmrc`, `min-release-age-exclude[]=@acme/ui-core`.
- **bun:** `bunfig.toml`, under `[install]`, `minimumReleaseAgeExcludes = ["@acme/ui-core"]`.

**With no publish time,** the plan prints the major as `waiting on a publish time from the registry`, and the release as missing its publish time, which some private registries leave out. yarn from 4.11 and pnpm 10 hold such a release back however old it is, while `ng update` takes it, so there's no time to wait for: until whoever runs the registry gives the release its time, exempting it as above is the only way past, and the `Sooner, once ...` command installs nothing first for it. When the major also needs a young release, the plan gives that one's time too.

**Under npm's `before`,** the plan prints the major as `waiting on npm's before`, with no time, since that date moves only when someone moves it. npm's install lets an excluded package past `before` too, but `ng update` from Angular CLI 22.1 applies `before` itself and reads no exemption list, so for a hop to Angular 22.1 or newer the plan prints `No sooner way:`. Moving `before` is the person's call, so ask.

For example:

> You're on Angular 21 now, committed and passing. Angular 22 needs `@acme/ui-core` and `@acme/ui-forms` 22.0.0, which you published 11 minutes ago, and pnpm holds a release back for a day, until 08:31 UTC tomorrow, as a guard against a compromised release. `ng update` skips them until then too. I'd wait, since it costs a day and nothing else, but if you trust your registry I can exempt exactly those two releases in a commit of their own and upgrade now. Wait, or exempt them?

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
