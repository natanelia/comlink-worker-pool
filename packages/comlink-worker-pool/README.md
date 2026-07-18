# comlink-worker-pool

[![npm version](https://img.shields.io/npm/v/comlink-worker-pool?color=blue)](https://www.npmjs.com/package/comlink-worker-pool)
[![CI](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

A typed Comlink worker pool with bounded scheduling, observable lifecycle state, and graceful shutdown.

## Install

```bash
npm install comlink-worker-pool comlink
```

The package publishes ESM and CommonJS with declarations and linked source maps. Bun is used by this repository, but it is not a runtime dependency.

## Quick start

Expose an API from a module worker:

```ts
// worker.ts
import { expose } from "comlink";

function fibonacci(n: number): number {
  return n <= 1 ? n : fibonacci(n - 1) + fibonacci(n - 2);
}

const api = {
  fib: async (n: number) => fibonacci(n),
};

export type WorkerApi = typeof api;
expose(api);
```

Create the pool in the owning application:

```ts
import { wrap } from "comlink";
import { WorkerPool } from "comlink-worker-pool";
import type { WorkerApi } from "./worker";

const pool = new WorkerPool<WorkerApi>({
  size: 2,
  workerFactory: () =>
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  proxyFactory: (worker) => wrap<WorkerApi>(worker),
  maxQueueSize: 64,
  taskTimeoutMs: 60_000,
});

const api = pool.getApi();
const values = await Promise.all([api.fib(38), api.fib(39), api.fib(40)]);
const shutdown = await pool.drain();
console.log(values, shutdown.confirmed);
```

Calls through `getApi()` are scheduled lazily. Workers are created as demand arrives, up to `size`.

## Scheduling and backpressure

Each worker runs one task at a time by default. Increase `maxConcurrentTasksPerWorker` for APIs that spend most of their time awaiting asynchronous work. CPU-bound tasks normally benefit from one task per worker.

`getApi()` is the simplest submission interface. Use `run()` when one call needs priority, cancellation, or a queue-specific deadline:

```ts
const controller = new AbortController();

const result = pool.run("fib", [42], {
  priority: 10,
  queueTimeoutMs: 2_000,
  signal: controller.signal,
});
```

Higher numeric priorities run first. Equal priorities remain FIFO. `maxQueueSize` counts only waiting work, not running work. The default overflow policy rejects the new call with `WorkerPoolQueueFullError`; `"drop-oldest"` instead rejects the oldest queued call.

Aborting queued work removes it immediately. Aborting active work rejects the caller's promise but does not forcibly interrupt worker code because that worker may host other concurrent calls. Its slot remains occupied until the underlying call finishes or the task timeout recycles the worker.

## Shutdown

Choose the shutdown behavior that matches the owner lifecycle:

```ts
const drainReport = await pool.drain(); // finish accepted work
const closeReport = await pool.close(); // reject accepted work immediately
```

Both methods reject future calls, terminate workers, and return a `WorkerPoolShutdownReport`. The shared `pool.terminated` promise exposes the same final report.

`terminateAll()` is the synchronous compatibility entry point. It begins immediate close and cleanup but does not await the final report.

Worker termination is retried with bounded exponential backoff. A termination that cannot be confirmed is quarantined and remains visible in statistics. Replacement workers are limited by `terminationFailureWorkerBuffer`, preventing an unbounded number of potentially live workers.

## Observability

Read a snapshot with `getStats()` or subscribe with `onUpdateStats`. Statistics include:

- pool state, configured capacity, instantiated workers, and active tasks
- queue depth, capacity, remaining slots, and oldest queued task age
- healthy and quarantined worker counts
- submitted, started, completed, failed, cancelled, timed out, and dropped task counters
- termination failure counters

`onEvent` receives structured task and worker events. Task arguments and results are intentionally excluded.

```ts
const pool = new WorkerPool<WorkerApi>({
  size: 4,
  workerFactory,
  proxyFactory,
  onUpdateStats: (stats) => console.log(stats.queue, stats.runningTasks),
  onEvent: (event) => {
    if (event.type === "task-settled") {
      console.log(event.taskId, event.outcome, event.durationMs);
    }
  },
});
```

Observer exceptions are isolated from scheduler behavior.

## Configuration

| Option | Type | Behavior |
| --- | --- | --- |
| `size` | `number` | Maximum scheduler-managed workers |
| `workerFactory` | `() => Worker` | Creates a fresh worker |
| `proxyFactory` | `(worker: Worker) => P` | Creates the worker API proxy |
| `maxConcurrentTasksPerWorker` | `number` | Per-worker concurrency, default `1` |
| `maxQueueSize` | `number` | Maximum waiting tasks, default unlimited |
| `queueOverflowPolicy` | `"reject" \| "drop-oldest"` | Full-queue behavior, default `"reject"` |
| `queueTimeoutMs` | `number \| false` | Default maximum queue wait, disabled by default |
| `taskTimeoutMs` | `number \| false` | Running task deadline, default five minutes |
| `workerIdleTimeoutMs` | `number` | Retires an idle worker after the duration |
| `maxTasksPerWorker` | `number` | Retires a worker after assigned task count |
| `maxWorkerLifetimeMs` | `number` | Retires a worker after the lifetime once idle |
| `proxyCleanup` | `(proxy: P) => void` | Custom proxy cleanup before worker termination |
| `onUpdateStats` | `(stats) => void` | Receives live statistics |
| `onEvent` | `(event) => void` | Receives structured scheduler events |
| `terminationFailureWorkerBuffer` | `number` | Extra physical-worker allowance for quarantined workers |
| `terminationRetryAttempts` | `number` | Retries after the initial termination attempt, default `3` |
| `terminationRetryDelayMs` | `number` | Initial retry delay, default `100` ms |
| `terminationAttemptTimeoutMs` | `number` | Async attempt deadline, default five seconds |
| `workerTerminator` | `(worker) => void \| PromiseLike<unknown>` | Host-specific termination implementation |
| `onWorkerTerminationError` | `(error) => void` | Receives isolated termination failures |

The default five-minute task timeout is the portable recovery mechanism for a worker that silently closes or never settles. Set it to `false` only for intentionally unbounded work. Timed-out calls are not retried because they may already have produced side effects.

## API

- `getApi()` returns a typed proxy whose methods submit scheduled work.
- `run(method, args, options)` submits a typed call with scheduling controls.
- `getStats()` returns a current `WorkerPoolStats` snapshot.
- `drain()` rejects new work, finishes accepted work, and awaits cleanup.
- `close()` rejects work immediately and awaits cleanup.
- `terminated` is the shared final shutdown promise.
- `terminateAll()` begins immediate shutdown without awaiting its report.

Exported error classes let callers distinguish capacity, queue overflow, cancellation, queue timeout, task timeout, worker failure, and closed-pool outcomes.

## React and complete example

Use [comlink-worker-pool-react](../comlink-worker-pool-react/README.md) when a React component should own the pool lifecycle or task state.

The browser [playground application](../playground/src/App.tsx) and [worker](../playground/src/worker.ts) form a complete runnable example with queue telemetry and lifecycle events.

## License

[MIT](../../LICENSE)
