# acme-portal

Acme's equipment-request app, built on `@acme/ui-core` and `@acme/ui-forms` from the company registry.

- `pnpm start` serves it at http://localhost:4200.
- `pnpm test` runs its tests.
- The dev container in `.devcontainer/` gives everyone the same Node and pnpm. Its `node_modules` is a volume of its own, so a checkout used from both Windows and the container never mixes their packages.
