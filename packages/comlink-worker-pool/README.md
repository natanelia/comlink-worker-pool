# comlink-worker-pool

A reusable, high-performance Web Worker pool library for Bun and React projects, powered by [Comlink](https://github.com/GoogleChromeLabs/comlink).

## Features

- Simple API for parallelizing tasks in the browser or with Bun
- Built on top of Comlink for ergonomic worker communication
- TypeScript support
- Easily configurable pool size and worker factory
- Automatic queuing and parallel execution of tasks beyond pool size for maximum throughput
- Full error propagation from workers to main thread for seamless debugging
- Live pool statistics and onUpdateStats callback for real-time monitoring
- Idle worker auto-termination for resource efficiency and cost-effectiveness
- Automatic worker recovery after crashes for high availability and reliability
- Supports both async and sync worker APIs for flexibility and ease of use
- Type-safe and ergonomic Comlink integration for a seamless development experience

## Installation

From the monorepo root:

```bash
bun add comlink-worker-pool
```

## Usage

Import and use the worker pool in your app:

```ts
import { WorkerPool } from "comlink-worker-pool";
import * as Comlink from "comlink"; // or your Comlink import

// Define your worker API interface
interface WorkerApi {
  fibAsync(n: number): Promise<number>;
}

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

A React playground demo is available in [`../playground`](../playground). To run it:

```bash
bun run --filter playground dev
```

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
