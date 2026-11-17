# The team's Node, pinned. Angular 21 accepts it, and Angular 22 needs ^22.22.3, ^24.15.0 or >=26.
FROM node:22.12.0-bookworm

# Node 22.12's own corepack can't verify current pnpm releases, so corepack 0.34.7 runs pnpm from package.json's
# packageManager. It's the last corepack that supports Node 22.12, and it's pinned so the image doesn't change with
# corepack's next release. node_modules is a volume owned by the node user, so the container's packages never mix with
# a Windows host's.
RUN npm install -g corepack@0.34.7 \
 && corepack enable \
 && mkdir -p /workspaces/acme-portal/node_modules \
 && chown -R node:node /workspaces/acme-portal

# On Docker Engine on Linux the dev container gives the node user the host user's id, which then doesn't own the
# volume: pnpm's install stopped with "Permission denied (os error 13)". So any user in the container may write there.
RUN chmod 1777 /workspaces/acme-portal/node_modules
