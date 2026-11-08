# An enterprise upgrade

Acme's portal is on Angular 21 and can't go to 22 on its own. Its UI comes from Acme's own libraries, and they only accept Angular 21, so they have to be upgraded and published first, and the app after them. This sets that up on one machine, the way a company has it: the libraries in a repository of their own, published to a private registry, and the app in another, with a dev container for the team.

## What's here

- `acme-ui/`: the libraries, `@acme/ui-core` and `@acme/ui-forms`, which needs ui-core. Both at 21.4.0, with peer ranges that stop at Angular 21.
- `acme-portal/`: the app that uses them, with a dev container pinned to Node 22.12. Angular 21 accepts that Node, and Angular 22 doesn't.
- `registry/config.yaml`: a local [Verdaccio](https://verdaccio.org) that stands in for the company registry. Each repo's `.npmrc` sends only the `@acme` scope there.
- `setup.mjs`: copies both repos to a folder of your choice, publishes the 21.4.0 libraries and makes each a git repository.

## Set it up

You need Node 24.15 or newer, pnpm 12 and git, and Docker Desktop for the dev container. Verdaccio 7 needs Node 24 or newer, and Angular 22, which the upgrade moves to, needs 24.15 or newer on Node 24.

1. Start the registry, and leave it running:
   ```sh
   npx verdaccio@7.0.2 --config examples/enterprise/registry/config.yaml
   ```
2. In another terminal:
   ```sh
   node examples/enterprise/setup.mjs <folder>
   ```
3. Open `<folder>/acme-portal` in your agent, with ng-hop installed, and ask: "Upgrade this app to Angular 22."

To start over, stop the registry, delete `examples/enterprise/registry/storage/` and start it again. The registry keeps what each run publishes, and once the libraries' 22.0.0 is in it, the portal isn't blocked any more.

## What should happen

1. The plan says the portal is blocked by `@acme/ui-core` and `@acme/ui-forms`, that both come from the registry your npm config sets for `@acme`, and that, if they're your team's, ui-core goes first.
2. Asked where they live, you point the agent at `<folder>/acme-ui`. It upgrades that workspace to Angular 22, moves each library's peer ranges and version, builds and tests them, and asks before publishing.
3. Back in the portal, the plan is clear. But the libraries' 22.0.0 is only minutes old, and pnpm holds a release back for its first day (its minimum release age). So the agent asks before exempting the two releases, the way `pnpm-workspace.yaml` already exempts 21.4.0. `ng update` applies the same rule itself and ignores the exemption, so, with your go-ahead, the agent installs the two releases before it updates Angular. If you'd rather not exempt them, wait a day. Then the agent takes the app to 22, raises the dev container's Node to one Angular 22 accepts, and checks the build, the tests and the running app.

The upgrade runs from your machine, not inside the dev container. The container has its own Node and its own `node_modules`, so rebuild it afterwards and check the app there. In VS Code, run "Dev Containers: Rebuild and Reopen in Container", or "Dev Containers: Rebuild Container" if you're already in it, then `pnpm run build` and `pnpm test --watch=false` in its terminal. From a terminal:

```sh
npx @devcontainers/cli up --remove-existing-container --workspace-folder <folder>/acme-portal
npx @devcontainers/cli exec --workspace-folder <folder>/acme-portal pnpm run build
npx @devcontainers/cli exec --workspace-folder <folder>/acme-portal pnpm test --watch=false
```

A plain `up` keeps a container made before the upgrade, on its old Node, and it reports success once the install is done, before anything runs Angular. `--watch=false` makes the tests run once and stop, since in a terminal they'd wait for changes.

The container reaches the registry on your machine through `.devcontainer/registry-forward.mjs` and Docker Desktop's `host.docker.internal`, which leads to your machine's 127.0.0.1, where the registry listens. Docker Engine on Linux has no such name by default, so there the container can't install the `@acme` packages.

## On video

The M7 tutorial follows one run of this, from the plan to the rebuilt container. Its source is in [`docs/video/enterprise`](../../docs/video/enterprise/).
