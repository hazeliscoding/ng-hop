# Lint and modernization: ask which cost to take

An upgrade can expose a rule across hundreds of components. Fixing every finding can make the PR hard to review, while deferring the same work can mean paying for another full regression later. Neither cost is always right.

## Establish what failed

Read the exact rule or diagnostic IDs, installed tool versions, effective lint configuration, and the before/after results. Separate findings that were already failing, new upgrade failures, and optional modernization. Do not repair or suppress unrelated baseline findings as part of this choice.

Estimate the affected file/component count and describe the kind of code changes, not just the number of messages. Label estimates as estimates. If a repair would require optional migrations, broad reactive-state changes, or lint exceptions, ask before doing it. Do not run blanket autofix to find out how large the change is.

## Offer both paths

1. **Modernize now.** Fix the affected code, using signals, OnPush or other supported APIs where the actual findings call for them. Include only the agreed rules/components and any explicitly approved optional migrations. Explain that this means a larger PR, but the team can plan one combined final regression pass instead of two separate changes. It does not mean converting every variable to a signal.
2. **Compatibility-first.** Keep supported existing behavior and make the smallest required repairs. Propose only policy-permitted, narrowly scoped rule exceptions or supported compatibility settings. Show the exact proposed rules/settings and affected files before changing them, and obtain approval for those exceptions. Record each exception's reason, affected files, and a removal condition or follow-up. If no safe, permitted exception exists, say so and ask whether to modernize or stop.

Recommend a path using the team's review capacity, regression cost and ownership model, but wait for their answer. A domain team may prefer one combined regression; a centrally maintained repo may prefer incremental work. Repo type alone does not choose for them.

For example:

> New findings: [rule IDs], approximately [files/components]. Fixing them requires [changes].
> 1. Modernize now: larger diff, combined final regression.
> 2. Compatibility-first: smaller diff, [specific proposed exceptions/settings], with follow-up work.
> I recommend [path] because [tradeoff]. Which should this upgrade use?

If the person already chose a path and scope, honor it without asking again. Keep the decision in the upgrade report or the repo's existing work record, not a new tracking system. Ask again only if the scope grows materially, a new exception needs approval, or the chosen path cannot preserve correctness. With no relevant findings or scope decision, carry on without an extra question.

## Keep the safety net

Both choices keep lint, build, tests, app checks and other required gates at every major. A combined final regression never replaces those per-major checks. Preserve assertions, coverage and bundle budgets.

Do not disable lint globally, turn off `strictTemplates`, blanket-suppress compiler diagnostics, or weaken security checks. A repository or organization policy that forbids an exception still wins. Approval to keep a small diff is not permission to hide runtime defects or unsupported APIs. An actual compiler/runtime failure needs a correct supported repair, not just a quieter linter.

Rerun the same commands and inspect the resulting diff. Report the choice, what it changed, the exact approved exceptions and their removal conditions, deferred work, and anything not verified. Do not describe a suppressed finding as fixed code.

## Angular 22 example: Eager versus OnPush

Angular 22 makes OnPush the default. Its migration adds `ChangeDetectionStrategy.Eager` to existing components that relied on the old default, preserving their behavior. A configured `@angular-eslint/prefer-on-push-component-change-detection` rule reports those migrated components. That is a lint-policy conflict, not a compiler requirement to rewrite every field: Angular 22 does not require every variable to be a signal.

Modernizing may involve signals, immutable inputs, `AsyncPipe` or `ChangeDetectorRef.markForCheck()`, depending on the component. Merely deleting `Eager` changes runtime behavior and is not a safe blanket fix. Compatibility-first can retain the migration's `Eager` and propose a scoped exception to that exact rule, if policy permits. In a zoneless app, `Eager` alone does not schedule change detection: Angular still needs a notification, such as a template-consumed signal update or `markForCheck()`.

Check the app's actual Angular/angular-eslint versions and diagnostics before applying this example:

- [Angular change detection strategies](https://angular.dev/guide/components/advanced-configuration#changedetectionstrategy)
- [OnPush lint rule and the v22 migration](https://github.com/angular-eslint/angular-eslint/blob/main/packages/eslint-plugin/docs/rules/prefer-on-push-component-change-detection.md)
- [Zoneless notification requirements](https://angular.dev/guide/zoneless#requirements-for-zoneless-compatibility)
