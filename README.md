# comlink-worker-pool

[![CI](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A TypeScript monorepo for bounded, observable Web Worker pools built on [Comlink](https://github.com/GoogleChromeLabs/comlink).

[Open the live playground](https://natanelia.github.io/comlink-worker-pool/) to configure a pool, run real worker tasks, and inspect scheduler events.

## Packages

| Package | Purpose | Documentation |
| --- | --- | --- |
| `comlink-worker-pool` | Core scheduler, worker lifecycle, backpressure, observability, and awaitable shutdown | [Core README](packages/comlink-worker-pool/README.md) |
| `comlink-worker-pool-react` | React-owned pool lifecycle and typed task state hooks | [React README](packages/comlink-worker-pool-react/README.md) |
| `comlink-worker-pool-playground` | Browser workbench that exercises both published packages | [Playground README](packages/playground/README.md) |

Install the core package, plus the React bindings when needed:

```bash
npm install comlink-worker-pool
npm install comlink-worker-pool-react
```

The package READMEs contain focused API examples. The playground is the complete runnable React example:

- [React application](packages/playground/src/App.tsx)
- [Comlink worker](packages/playground/src/worker.ts)

## Development

The repository pins Bun through `packageManager` and CI. Dependency lifecycle scripts are disabled by policy; do not bypass that protection without a reviewed security change.

```bash
bun install --frozen-lockfile --ignore-scripts
bun run verify
bun run test:coverage
bun run playground:dev
```

`bun run verify` starts with the repository's supply-chain policy and then checks formatting and lint rules, TypeScript, unit tests and coverage, dependency advisories, builds, runtime and bundle budgets, the playground build, package metadata, packed type surfaces, and clean ESM/CommonJS consumer imports.

Real browser worker tests run separately:

```bash
bunx playwright install chromium firefox webkit
bun run test:browser
```

For watch-mode package builds, run `bun run build:watch`.

The performance harness can also be run directly:

```bash
bun run benchmark
```

The runtime harness measures task throughput, sequential worker churn, and burst creation/teardown. Configure task count, sample count, and task p95 with `WORKER_POOL_BENCHMARK_TASKS`, `WORKER_POOL_BENCHMARK_RUNS`, and `WORKER_POOL_BENCHMARK_BUDGET_MS`. Churn uses `WORKER_POOL_BENCHMARK_CHURN_WORKERS` and `WORKER_POOL_BENCHMARK_CHURN_BUDGET_MS`; burst lifecycle uses `WORKER_POOL_BENCHMARK_BURST_WORKERS` and `WORKER_POOL_BENCHMARK_BURST_BUDGET_MS`.

## Supply-chain security

The repository disables dependency install scripts, pins GitHub Actions to immutable commits, reviews dependency changes, and rejects release credentials in source-controlled workflows. See [SECURITY.md](SECURITY.md) for the enforced policy, required GitHub/npm settings, release-review procedure, and compromise response.

## Releases

[Changesets](https://github.com/changesets/changesets) owns package versioning. Every package-facing change should include a changeset. The two published packages form one fixed Changesets group and always share a version.

Package publication is deliberately split into independent trust zones:

1. A maintainer runs **Prepare version PR patch** from `main`. Changesets runs in a read-only workflow with no repository-write or npm authority and produces a checksummed patch artifact.
2. A maintainer verifies and applies the patch to a branch, inspects the generated versions and changelogs, and opens a normal pull request. That PR follows the same CI and Code Owner protections as every other change.
3. After the version PR merges, a maintainer runs **Stage npm release** from the exact version commit. Dependencies are built in a read-only job without publishing credentials. The resulting tarballs are checksummed and transferred to a separate OIDC job that can only run `npm stage publish`.
4. A maintainer downloads, verifies, and approves each staged npm package with 2FA. Until that approval, the package is not public.
5. After both packages are public, a maintainer runs **Finalize npm release** with the exact version and source commit. That workflow verifies npm and source metadata before creating the aggregate `v<version>` GitHub Release.

The trusted publisher must be configured for `stage-release.yml`, the `npm-release` environment, and staged publishing only. Reusable npm tokens are not supported. The complete one-time setup and per-release checklist are in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
