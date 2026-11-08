# acme-ui

Acme's UI libraries: `@acme/ui-core`, with buttons, cards and the design tokens in `theme.css`, and `@acme/ui-forms`, with form fields built on ui-core. They're published to the company registry that `.npmrc` names, and Acme's apps install them from there.

- `pnpm run build` builds both, ui-core first, because ui-forms builds against it.
- `pnpm test` runs both libraries' tests.
- `pnpm run publish` publishes what `build` made. Only a release does this.
