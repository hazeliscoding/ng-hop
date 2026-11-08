# An enterprise upgrade

Acme's portal is on Angular 21 and can't go to 22 on its own. Its UI comes from Acme's own libraries, and they only accept Angular 21, so they have to be upgraded and published first, and the app after them. This sets that up on one machine, the way a company has it: the libraries in a repository of their own, published to a private registry, and the app in another, with a dev container for the team.

## What's here

- `acme-ui/`: the libraries, `@acme/ui-core` and `@acme/ui-forms`, which needs ui-core. Both at 21.4.0, with peer ranges that stop at Angular 21.
- `acme-portal/`: the app that uses them, with a dev container pinned to Node 22.12. Angular 21 accepts that Node, and Angular 22 doesn't.
- `registry/config.yaml`: a local [Verdaccio](https://verdaccio.org) that stands in for the company registry. Each repo's `.npmrc` sends only the `@acme` scope there.
- `setup.mjs`: copies both repos to a folder of your choice, publishes the 21.4.0 libraries and makes each a git repository.

## Set it up

You need Node 22.22.3 or newer and pnpm 12.

1. Start the registry, and leave it running:
   ```sh
   npx verdaccio@7.0.2 --config examples/enterprise/registry/config.yaml
   ```
2. In another terminal:
   ```sh
   node examples/enterprise/setup.mjs <folder>
   ```
3. Open `<folder>/acme-portal` in your agent, with ng-hop installed, and ask: "Upgrade this app to Angular 22."

## What should happen

1. The plan says the portal is blocked by `@acme/ui-core` and `@acme/ui-forms`, that both come from your own registry, and that ui-core goes first.
2. Asked where they live, you point the agent at `<folder>/acme-ui`. It upgrades that workspace to Angular 22, moves each library's peer ranges and version, builds and tests them, and asks before publishing.
3. Back in the portal, the plan is clear. The agent takes the app to 22, raises the dev container's Node to one Angular 22 accepts, and checks the build, the tests and the running app.

The upgrade runs from your machine, not inside the dev container. The container keeps its own `node_modules`, so open it afterwards to check it still works: "Reopen in Container" in VS Code, or `npx @devcontainers/cli up --workspace-folder <folder>/acme-portal`. It reaches the registry on your machine through `.devcontainer/registry-forward.mjs`.
