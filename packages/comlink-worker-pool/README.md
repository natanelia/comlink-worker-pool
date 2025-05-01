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

### Advanced Usage

- The pool is generic: `WorkerPool<T, R, P>`
  - `T`: Task type (must be `{ method: string; args: unknown[] }` for proxy mode)
  - `R`: Result type
  - `P`: Proxy type (your worker API interface)

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
