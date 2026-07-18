# Playground

The playground is a browser workbench for `comlink-worker-pool` and `comlink-worker-pool-react`.

It uses real module workers and demonstrates:

- `useWorkerPool` lifecycle ownership and configuration changes
- `useWorkerTask` with inferred method arguments and results
- live `WorkerPoolStats` capacity and outcome counters
- structured scheduler and worker lifecycle events
- CPU, typed transform, and deterministic delayed batch workloads
- bounded queue and task deadlines

[Open the live playground](https://natanelia.github.io/comlink-worker-pool/), or run it from the repository root:

```bash
bun install
bun run playground:dev
```

The implementation is intentionally available as a complete example:

- [React application](src/App.tsx)
- [Comlink worker](src/worker.ts)

The playground runs predefined workloads. It does not execute user-authored code or make simulated network requests.
