# Contributing

Use Node.js 22 or later and pnpm. Development compiles against the exact npm packages listed
in `devDependencies`; the host provides compatible peer versions at runtime. Do not commit registry
credentials, local SDK paths, or copied DSH source.

Before opening a pull request, run:

```sh
NPM_TOKEN=<short-lived-read-token> pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
```

Keep the concrete read token in the process environment and reference it through
local npm configuration. Never write it into the repository, logs or fixtures.

Commit source and regenerated `lib/` artifacts together. Community games belong under
`community-games/<slug>/`; run `node scripts/update-catalog.mjs` after changing that directory.
Only submit code and assets you are allowed to redistribute.

The package remains `private: true` and is installed from a pinned Git source. Contributions must
not add public npm publishing scripts or runtime CDN fallbacks.
