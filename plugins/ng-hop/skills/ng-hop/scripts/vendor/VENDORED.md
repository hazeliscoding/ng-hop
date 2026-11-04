# Vendored files

`semver.cjs` is [semver](https://github.com/npm/node-semver) 7.7.3, bundled into one file so the skill runs with no install step:

```sh
npm i semver@7.7.3 esbuild
npx esbuild node_modules/semver/index.js --bundle --platform=node --format=cjs --outfile=semver.cjs
```

Do not edit it by hand. To update, repeat those steps and keep the license header.
