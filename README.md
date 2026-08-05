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

The repository pins Bun through `packageManager` and CI.

```bash
bun install --frozen-lockfile
bun run verify
bun run test:coverage
bun run playground:dev
```

`bun run verify` checks formatting and lint rules, TypeScript, unit tests and coverage, dependency advisories, builds, runtime and bundle budgets, the playground build, package metadata, packed type surfaces, and clean ESM/CommonJS consumer imports.

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

## Releases

[Changesets](https://github.com/changesets/changesets) owns package versioning and the release pull request. Every package-facing change should include a changeset. Merges to `main` run the release workflow, which updates the version PR or publishes approved versions.

The two published packages form one fixed Changesets group and always share a version. The custom release command owns the single aggregate `v<version>` GitHub Release; the Changesets action only coordinates versioning and publication.

To publish the versioned packages to npm and create the matching GitHub Release in one command, authenticate with both npm and GitHub, ensure the release commit is pushed to `origin`, and run:

```bash
bun run release
```

A real release requires a clean working tree, runs `bun run verify`, publishes all versioned packages with Changesets, and creates an idempotent `v<version>` GitHub Release with generated notes. Use `bun run release -- --dry-run` to inspect the selected packages and target commit without publishing.

## License

[MIT](LICENSE)
