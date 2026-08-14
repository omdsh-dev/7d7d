# Contributing

Use Node.js 22 or later and pnpm. Development compiles against the exact npm packages listed
in `devDependencies`; the host provides compatible peer versions at runtime. Do not commit registry
credentials, local SDK paths, or copied DSH source.

Before opening a pull request, run:

```sh
NPM_CONFIG_USERCONFIG=/dev/null pnpm install --frozen-lockfile --ignore-scripts
pnpm workshop:check
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
```

The declared DSH dependencies are publicly readable. CI and local verification must not depend on
GitHub or npm credentials, and credentials must never be written into the repository, logs or fixtures.

Commit source and regenerated `lib/` artifacts together. Community games belong under
`community-games/<slug>/`; run `node scripts/update-catalog.mjs` after changing that directory.
Only submit code and assets you are allowed to redistribute.

The package remains `private: true` and is installed from a pinned Git source. Contributions must
not add public npm publishing scripts or runtime CDN fallbacks.
