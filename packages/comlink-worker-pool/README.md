# 🚀 comlink-worker-pool

[![npm version](https://img.shields.io/npm/v/comlink-worker-pool?color=blue)](https://www.npmjs.com/package/comlink-worker-pool)
[![bun compatible](https://img.shields.io/badge/bun-%E2%9C%94%EF%B8%8F-green)](https://bun.sh/)
[![CI](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/natanelia/comlink-worker-pool/actions)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🚀 **Try the [Live Playground Demo](https://natanelia.github.io/comlink-plus/)!**

**Effortless parallelism for your React and JS/TS apps.**

A blazing-fast, ergonomic Web Worker pool library powered by [Comlink](https://github.com/GoogleChromeLabs/comlink). Developed with Bun for fast builds and tests, but works in any modern JS/TS/React app. Offload CPU-intensive work to a pool of workers, maximize throughput, and keep your UI smooth.

---

## ✨ Why comlink-worker-pool?

- **Supercharge performance:** Run heavy computations in parallel without blocking the main thread.
- **Zero-hassle API:** Simple, type-safe, and ergonomic. No boilerplate.
- **Easy to develop & test:** Built with Bun for development and CI, but no Bun dependency at runtime.
- **Crash resilience:** Automatic worker recovery and error propagation.
- **Live stats:** Monitor pool health and performance in real time.
- **Resource efficient:** Idle worker auto-termination saves memory and CPU.

---

## 🚦 Features

- 🧩 Simple API for parallelizing tasks
- 🔗 Built on Comlink for ergonomic worker communication
- 🦾 TypeScript support
- ⚡ Configurable pool size & worker factory
- 📈 Live stats and onUpdateStats callback
- 💥 Full error propagation for seamless debugging
- 💤 Idle worker auto-termination
- 🔄 Automatic worker recovery
- 🔒 Type-safe and ergonomic integration
- ⏱️ **Worker lifecycle management** - Terminate workers based on task count or lifetime duration

---

## ⚡ Quick Start

Install from your monorepo root:

```bash
bun add comlink-worker-pool
```

Or with npm:

```bash
npm install comlink-worker-pool
```

## Usage

Import and use the worker pool in your app:

```ts
import { WorkerPool } from "comlink-worker-pool";
import * as Comlink from "comlink"; // or your Comlink import

// Define your worker API interface
type WorkerApi = {
  fibAsync(n: number): Promise<number>;
};

// Create the worker pool
const pool = new WorkerPool<
  { method: string; args: unknown[] }, // Task type
  unknown, // Result type (can be more specific)
  WorkerApi // Proxy type
>({
  size: 2,
  workerFactory: () =>
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  proxyFactory: (worker) => Comlink.wrap<WorkerApi>(worker),
  onUpdateStats: (stats) => console.log("Pool stats:", stats),
  workerIdleTimeoutMs: 30000, // Optional: terminate idle workers after 30s
  maxTasksPerWorker: 100, // Optional: terminate workers after 100 tasks
  maxWorkerLifetimeMs: 5 * 60 * 1000, // Optional: terminate workers after 5 minutes
});

// Use the API proxy for ergonomic calls
const api = pool.getApi();
const result = await api.fibAsync(10);
console.log(result); // Output: 55

// Get live pool stats
console.log(pool.getStats());
```

## WorkerPool Options

| Option                | Type                               | Description                                      |
| --------------------- | ---------------------------------- | ------------------------------------------------ |
| `size`                | `number`                           | Number of workers in the pool                    |
| `workerFactory`       | `() => Worker`                     | Factory function to create new workers           |
| `proxyFactory`        | `(worker: Worker) => P`            | Factory to wrap a worker with Comlink or similar |
| `onUpdateStats`       | `(stats: WorkerPoolStats) => void` | Callback on pool stats update (optional)         |
| `workerIdleTimeoutMs` | `number`                           | Idle timeout for terminating workers (optional)  |
| `maxTasksPerWorker`   | `number`                           | Max tasks per worker before termination (optional) |
| `maxWorkerLifetimeMs` | `number`                           | Max worker lifetime in milliseconds (optional)   |

### Advanced Usage

- The pool is generic: `WorkerPool<T, R, P>`
  - `T`: Task type (must be `{ method: string; args: unknown[] }` for proxy mode)
  - `R`: Result type
  - `P`: Proxy type (your worker API interface)

### Worker Lifecycle Management

The WorkerPool supports automatic worker termination based on different criteria to prevent memory leaks and ensure optimal performance:

#### Task-Based Termination (`maxTasksPerWorker`)
```ts
const pool = new WorkerPool<WorkerApi>({
  // ... other options
  maxTasksPerWorker: 100, // Terminate workers after 100 tasks
});
```
- Prevents memory leaks from long-running workers
- Ensures fresh worker state periodically
- Useful for workers that accumulate state over time

#### Time-Based Termination (`maxWorkerLifetimeMs`)
```ts
const pool = new WorkerPool<WorkerApi>({
  // ... other options
  maxWorkerLifetimeMs: 5 * 60 * 1000, // Terminate workers after 5 minutes
});
```
- Limits worker lifetime to prevent resource accumulation
- Useful for workers that may develop memory leaks over time
- Ensures periodic refresh of worker processes

#### Idle Termination (`workerIdleTimeoutMs`)
```ts
const pool = new WorkerPool<WorkerApi>({
  // ... other options
  workerIdleTimeoutMs: 30 * 1000, // Terminate idle workers after 30 seconds
});
```
- Reduces resource usage when demand is low
- Workers are recreated on-demand when needed
- Helps with memory management in variable-load scenarios

All lifecycle management options can be combined for comprehensive worker management.

## Example Worker

```ts
// worker.ts
export function fibAsync(n: number): number {
  return n <= 1 ? n : fibAsync(n - 1) + fibAsync(n - 2);
}
```

## API Reference

- `getApi(): P` — Returns a proxy for calling worker methods as if local (recommended).
- `getStats(): WorkerPoolStats` — Returns live stats about the pool.
- `terminateAll(): void` — Terminates all workers and clears the pool.

## Development

- **Build the library:**
  ```bash
  bun run --filter comlink-worker-pool build
  ```
- **Run tests:**
  ```bash
  bun run --filter comlink-worker-pool test
  ```

## Playground Demo

Try the live playground demo here: [https://natanelia.github.io/comlink-plus/](https://natanelia.github.io/comlink-plus/)

If you want to run it locally, see the [playground README](../playground/README.md).

## Troubleshooting

- Ensure you are running with Bun v1.0.0+.
- Worker file paths must be valid URLs relative to the importing module.
- If you encounter module resolution issues in the playground, try rebuilding the worker pool package.

## Contributing

Issues and PRs are welcome! Please open an issue or submit a pull request on the [GitHub repository](https://github.com/natanelia/comlink-worker-pool).

## License

MIT

---

See the [global README](../../README.md) for overall monorepo setup and structure.

See the [global README](../../README.md) for monorepo setup and structure.
