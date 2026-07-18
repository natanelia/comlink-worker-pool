# 🚀 comlink-worker-pool

[![npm version](https://img.shields.io/npm/v/comlink-worker-pool?color=blue)](https://www.npmjs.com/package/comlink-worker-pool)
[![bun compatible](https://img.shields.io/badge/bun-%E2%9C%94%EF%B8%8F-green)](https://bun.sh/)
[![CI](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/natanelia/comlink-worker-pool/actions)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🚀 **Try the [Live Playground Demo](https://natanelia.github.io/comlink-worker-pool/)!**

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
- 🚀 **Concurrent task execution** - Run multiple tasks concurrently on the same worker for I/O-bound operations

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
const pool = new WorkerPool<WorkerApi>({
  size: 2,
  workerFactory: () =>
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  proxyFactory: (worker) => Comlink.wrap<WorkerApi>(worker),
  onUpdateStats: (stats) => console.log("Pool stats:", stats),
  workerIdleTimeoutMs: 30000, // Optional: terminate idle workers after 30s
  maxTasksPerWorker: 100, // Optional: terminate workers after 100 tasks
  maxWorkerLifetimeMs: 5 * 60 * 1000, // Optional: terminate workers after 5 minutes
  taskTimeoutMs: 60_000, // Customize the 5-minute silent-exit/hang deadline
  terminationFailureWorkerBuffer: 2, // Optional replacement budget for failed termination
});

// Use the API proxy for ergonomic calls
const api = pool.getApi();
const result = await api.fibAsync(10);
console.log(result); // Output: 55

// Get live pool stats
console.log(pool.getStats());
```

## WorkerPool Options

| Option                        | Type                               | Description                                      |
| ----------------------------- | ---------------------------------- | ------------------------------------------------ |
| `size`                        | `number`                           | Maximum scheduler-managed, non-quarantined workers |
| `workerFactory`               | `() => Worker`                     | Factory function to create new workers           |
| `proxyFactory`                | `(worker: Worker) => P`            | Factory to wrap a worker with Comlink or similar |
| `onUpdateStats`               | `(stats: WorkerPoolStats) => void` | Callback on pool stats update (optional)         |
| `workerIdleTimeoutMs`         | `number`                           | Idle timeout for terminating workers (optional)  |
| `maxTasksPerWorker`           | `number`                           | Max tasks per worker before termination (optional) |
| `maxWorkerLifetimeMs`         | `number`                           | Max worker lifetime in milliseconds (optional)   |
| `maxConcurrentTasksPerWorker` | `number`                           | Max concurrent tasks per worker (optional, defaults to 1) |
| `maxQueueSize`                | `number`                           | Maximum waiting tasks; defaults to unlimited |
| `queueOverflowPolicy`         | `"reject" \| "drop-oldest"`     | Full-queue behavior; defaults to `"reject"` |
| `queueTimeoutMs`              | `number \| false`                  | Default queue-wait deadline; disabled by default |
| `taskTimeoutMs`               | `number \| false`                   | Task deadline; defaults to 5 minutes, false disables it |
| `proxyCleanup`                | `(proxy: P) => void`               | Custom proxy cleanup before worker termination (optional) |
| `terminationFailureWorkerBuffer` | `number`                       | Extra worker slots that preserve capacity after termination failure; defaults to `max(2, floor(size / 2))` |
| `terminationRetryAttempts`    | `number`                           | Additional termination attempts after the first; defaults to 3 |
| `terminationRetryDelayMs`     | `number`                           | Initial exponential-backoff delay; defaults to 100ms |
| `terminationAttemptTimeoutMs` | `number`                           | Deadline for each async termination attempt; defaults to 5 seconds |
| `workerTerminator`            | `(worker: Worker) => void \| PromiseLike<unknown>` | Optional host-specific termination implementation |
| `onWorkerTerminationError`    | `(error: WorkerTerminationError) => void` | Isolated callback for failed or timed-out termination attempts |

### Advanced Usage

- Most callers only need `WorkerPool<WorkerApi>`. Advanced callers can use
  `WorkerPool<TProxy, TTask, TResult>`.

### Controlled Scheduling and Backpressure

`getApi()` remains the simplest way to submit work. Use `run()` when a call
needs cancellation, priority, or a queue-specific deadline:

```ts
const controller = new AbortController();
const result = pool.run("fibAsync", [42], {
  signal: controller.signal,
  priority: 10,
  queueTimeoutMs: 2_000,
});
```

Higher priorities run first and equal priorities remain FIFO. `maxQueueSize`
counts only waiting work. A full queue rejects new work with
`WorkerPoolQueueFullError`, or evicts its oldest waiting task when
`queueOverflowPolicy` is `"drop-oldest"`.

Aborting queued work removes it immediately. Aborting active work rejects the
caller immediately but does not forcibly interrupt worker code, because doing
so could also destroy unrelated concurrent calls on that worker. The worker
slot remains occupied until the underlying call finishes or `taskTimeoutMs`
recycles the worker.

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

### Unconfirmed Termination Containment

The browser provides no stronger portable primitive if `worker.terminate()`
itself throws. The pool therefore quarantines that worker and continues counting
it as potentially alive. It admits replacements using two independent bounds:

```text
managed workers <= size
managed + quarantined workers <= size + terminationFailureWorkerBuffer
```

`terminationFailureWorkerBuffer` defaults to
`max(2, floor(size / 2))`. Full healthy capacity is preserved while the
quarantine count fits within that buffer. After the physical limit is
reached, capacity degrades instead of creating unbounded possible zombie
workers. If no healthy worker or retry path remains, queued and future work
rejects with `WorkerPoolCapacityError`.

Termination is attempted once plus three retries by default, using exponential
backoff from 100ms. A promise returned by `workerTerminator` must confirm
termination within five seconds per attempt. These values can be changed with
`terminationRetryAttempts`, `terminationRetryDelayMs`, and
`terminationAttemptTimeoutMs`. `terminateAll()` closes the scheduler
immediately and continues this bounded retry policy; quarantined workers remain
visible in statistics until termination is confirmed.

Use `workerTerminator` for a host-specific supervisor:

```ts
const pool = new WorkerPool<WorkerApi>({
  size: 4,
  terminationFailureWorkerBuffer: 2,
  workerFactory,
  proxyFactory,
  workerTerminator: async (worker) => {
    await supervisor.terminate(worker); // Resolve only after confirmed shutdown
  },
  onWorkerTerminationError: (error) => {
    console.error(error.attempt, error.exhausted, error.cause);
  },
});
```

### Concurrent Task Execution

By default, each worker processes tasks sequentially (one at a time). However, you can configure workers to handle multiple tasks concurrently, which is especially beneficial for I/O-bound operations or tasks that involve waiting.

#### Basic Concurrent Execution

```ts
const pool = new WorkerPool<WorkerApi>({
  size: 2,
  maxConcurrentTasksPerWorker: 3, // Allow up to 3 concurrent tasks per worker
  workerFactory: () => new Worker(new URL("./worker.ts", import.meta.url)),
  proxyFactory: (worker) => Comlink.wrap<WorkerApi>(worker),
});

// These 6 tasks will run on 2 workers, with up to 3 tasks per worker concurrently
const results = await Promise.all([
  api.fetchData("url1"),  // Worker 1, Task 1
  api.fetchData("url2"),  // Worker 1, Task 2  
  api.fetchData("url3"),  // Worker 1, Task 3
  api.fetchData("url4"),  // Worker 2, Task 1
  api.fetchData("url5"),  // Worker 2, Task 2
  api.fetchData("url6"),  // Worker 2, Task 3
]);
```

#### When to Use Concurrent Execution

**✅ Good for:**
- I/O-bound operations (network requests, file operations)
- Tasks with async waiting periods
- Database queries
- API calls

**❌ Avoid for:**
- CPU-intensive computations (use more workers instead)
- Tasks that compete for the same resources
- Memory-intensive operations

#### Performance Considerations

```ts
// For I/O-bound tasks: Higher concurrency can improve throughput
const ioPool = new WorkerPool<ApiWorker>({
  size: 2,
  maxConcurrentTasksPerWorker: 10, // High concurrency for I/O
  // ...
});

// For CPU-bound tasks: Use more workers instead of concurrency
const cpuPool = new WorkerPool<ComputeWorker>({
  size: navigator.hardwareConcurrency || 4, // More workers
  maxConcurrentTasksPerWorker: 1, // Sequential processing (default)
  // ...
});
```

#### Updated Statistics

When using concurrent execution, the pool statistics include additional information:

```ts
const stats = pool.getStats();
console.log({
  runningTasks: stats.runningTasks, // Total tasks currently executing
  availableForConcurrency: stats.availableForConcurrency, // Workers that can accept more tasks
  // ... other existing stats
});
```

## Example Worker

```ts
// worker.ts
export function fibAsync(n: number): number {
  return n <= 1 ? n : fibAsync(n - 1) + fibAsync(n - 2);
}
```

## API Reference

- `getApi(): P` — Returns a proxy for calling worker methods as if local (recommended).
- `run(method, args, options)` — Submits a typed call with priority,
  `AbortSignal`, and queue-deadline controls.
- `getStats(): WorkerPoolStats` — Returns live stats about the pool.
- `terminateAll(): void` — Permanently closes the pool, rejects queued and
  active work, releases standard Comlink proxies, and starts bounded
  termination for every healthy worker.

Standard browser Workers do not emit a portable `close` event when worker code
calls `self.close()`, so tasks have a five-minute default deadline. Customize
`taskTimeoutMs` for the workload, or set it to `false` only for intentionally
unbounded jobs. A timeout rejects all tasks on that worker and replaces it for
queued work; tasks are never automatically retried because they may have already
produced side effects.

### WorkerPoolStats Interface

```ts
interface WorkerPoolStats {
  size: number;                    // Maximum scheduler-managed workers
  available: number;               // Workers available to take new tasks
  queue: number;                   // Tasks waiting in the queue
  workers: number;                 // Healthy plus quarantined physical workers
  healthyWorkers: number;          // Managed workers, including busy workers retiring afterward
  quarantinedWorkers: number;      // Workers with unconfirmed termination
  terminationFailureWorkerBuffer: number; // Configured failed-termination buffer
  terminationFailures: number;     // Cumulative failed/timed-out attempts
  idleWorkers: number;             // Workers with no running tasks
  runningTasks: number;            // Total tasks currently executing
  availableForConcurrency: number; // Workers that can accept additional concurrent tasks
}
```

**Key differences with concurrent execution:**
- `idleWorkers`: Workers with zero running tasks
- `runningTasks`: Total count of all executing tasks across all workers
- `availableForConcurrency`: Workers that haven't reached their `maxConcurrentTasksPerWorker` limit
- `workers` can exceed `size` only by the configured termination-failure buffer;
  quarantined workers never receive tasks.

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

Try the live playground demo here: [https://natanelia.github.io/comlink-worker-pool/](https://natanelia.github.io/comlink-worker-pool/)

If you want to run it locally, see the [playground README](../playground/README.md).

## Troubleshooting

- Worker file paths must be valid URLs relative to the importing module.
- If you encounter module resolution issues in the playground, try rebuilding the worker pool package.

## Contributing

Issues and PRs are welcome! Please open an issue or submit a pull request on the [GitHub repository](https://github.com/natanelia/comlink-worker-pool).

## License

MIT

---

See the [global README](../../README.md) for overall monorepo setup and structure.

See the [global README](../../README.md) for monorepo setup and structure.
