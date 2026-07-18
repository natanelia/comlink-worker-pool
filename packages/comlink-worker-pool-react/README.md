# comlink-worker-pool-react

[![npm version](https://img.shields.io/npm/v/comlink-worker-pool-react?color=blue)](https://www.npmjs.com/package/comlink-worker-pool-react)
[![CI](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Typed React hooks for owning a `WorkerPool` and tracking worker task state.

## Install

```bash
npm install comlink-worker-pool comlink-worker-pool-react comlink
```

React 17 or newer is required.

## Usage

Expose the worker API with Comlink:

```ts
// worker.ts
import { expose } from "comlink";

const api = {
  add: async (left: number, right: number) => left + right,
};

export type WorkerApi = typeof api;
expose(api);
```

Own the pool with `useWorkerPool` and bind method-specific state with `useWorkerTask`:

```tsx
import { wrap } from "comlink";
import { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";
import type { WorkerApi } from "./worker";

function Calculator() {
  const pool = useWorkerPool<WorkerApi>({
    workerFactory: () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    proxyFactory: (worker) => wrap<WorkerApi>(worker),
    poolSize: 2,
    maxQueueSize: 32,
    queueTimeoutMs: 2_000,
    onUpdateStats: (stats) => console.log(stats.runningTasks),
  });
  const addTask = useWorkerTask(pool.api, "add");

  return (
    <div>
      <button
        disabled={pool.poolStatus !== "ready" || addTask.status === "running"}
        onClick={() => void addTask.run(2, 3)}
      >
        Add
      </button>
      <output>{addTask.result ?? "No result"}</output>
      {addTask.error ? <p role="alert">{String(addTask.error)}</p> : null}
    </div>
  );
}
```

See the [playground application](../playground/src/App.tsx) and [worker](../playground/src/worker.ts) for a complete runnable example.

## `useWorkerPool`

The hook creates its pool after the component commits and closes it during cleanup. It returns:

| Field | Meaning |
| --- | --- |
| `api` | Typed proxy API, or `null` before initialization or after close |
| `poolStatus` | `initializing`, `ready`, `error`, or `closed` |
| `status` | State of the latest call made through `call` |
| `result` | Result of the latest tracked call |
| `error` | Latest call or initialization error |
| `call(method, ...args)` | Typed method invocation with latest-call state |
| `close()` | Awaitable immediate shutdown with a termination report |

When `poolSize` is omitted, the default leaves one reported logical core free and caps the pool at four workers. Pool size, lifecycle, concurrency, queue, and timeout option changes recreate the owned pool.

Inline factory identities do not recreate the pool. Increment or replace `reconfigureKey` when a new `workerFactory`, `proxyFactory`, `proxyCleanup`, or `workerTerminator` must take effect.

Observers are held through stable refs, so updating `onUpdateStats`, `onEvent`, or `onWorkerTerminationError` does not recreate the pool.

## `useWorkerTask`

`useWorkerTask(api, method)` returns a method-bound `run` function with inferred arguments and result, plus `status`, `result`, `error`, and `reset`.

For overlapping hook calls, only the latest-started invocation updates tracked state. Every returned promise still resolves or rejects normally.

## Forwarded pool options

`useWorkerPool` forwards the core pool's scheduling and lifecycle controls, including:

- `maxConcurrentTasksPerWorker`
- `maxQueueSize`, `queueOverflowPolicy`, and `queueTimeoutMs`
- `taskTimeoutMs`
- `workerIdleTimeoutMs`, `maxTasksPerWorker`, and `maxWorkerLifetimeMs`
- termination retry, timeout, buffer, and custom terminator options
- `onUpdateStats`, `onEvent`, and `onWorkerTerminationError`

See the [core package documentation](../comlink-worker-pool/README.md) for exact semantics.

## License

[MIT](../../LICENSE)
