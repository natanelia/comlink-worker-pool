# ⚛️ comlink-worker-pool-react

[![npm version](https://img.shields.io/npm/v/comlink-worker-pool-react?color=blue)](https://www.npmjs.com/package/comlink-worker-pool-react)
[![bun compatible](https://img.shields.io/badge/bun-%E2%9C%94%EF%B8%8F-green)](https://bun.sh/)[![CI](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/natanelia/comlink-worker-pool/actions)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

> 🚀 **Try the [Live Playground Demo](https://natanelia.github.io/comlink-worker-pool/)!**

**Effortless, scalable web worker pools for React.**

Supercharge your React apps with parallelism and keep your UI buttery smooth. Powered by [comlink-worker-pool](../comlink-worker-pool/README.md) — now with a beautiful, idiomatic hook-based API for React developers.

---

## ✨ Why comlink-worker-pool-react?

- **Blazing fast UI:** Run CPU-intensive tasks in parallel, outside the main thread.
- **Zero boilerplate:** Integrate worker pools with a single hook.
- **TypeScript first:** Full type safety and autocompletion.
- **Seamless DX:** Designed for React, by React devs.
- **Works using [comlink-worker-pool](../comlink-worker-pool/README.md) underneath**.

---

## 🚦 Features

- 🪝 `useWorkerPool()` React hook for easy worker pool integration
- 🧑‍💻 Simple, declarative API
- 🛡️ TypeScript support out of the box
- ⚡ Automatic pool management & lifecycle handling
- 🔄 Real-time status, results, and error tracking
- 🧩 Works with any Comlink-compatible worker

---

## ⚡ Quick Start

Install:

```bash
npm install comlink-worker-pool-react comlink-worker-pool
```

or

```bash
yarn add comlink-worker-pool-react comlink-worker-pool
```

## Usage

1. **Create your worker (e.g., `worker.ts`)**

```ts
// worker.ts
import { expose } from "comlink";

const api = {
  add: async (a: number, b: number) => a + b,
};

expose(api);
```

2. **Use the hook in your React component:**

```tsx
import { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";
import { wrap } from "comlink";

type Api = {
  add: (a: number, b: number) => Promise<number>;
};

function Calculator() {
  const { poolStatus, status, result, error, call, close } = useWorkerPool<Api>({
    workerFactory: () =>
      new Worker(new URL("./worker", import.meta.url), { type: "module" }),
    proxyFactory: (worker) => wrap<Api>(worker),
    poolSize: 2,
    taskTimeoutMs: 60_000, // Customize the five-minute default
    terminationFailureWorkerBuffer: 2,
  });

  return (
    <div>
      <button disabled={poolStatus !== "ready"} onClick={() => call("add", 2, 3)}>
        Add 2 + 3
      </button>
      <button onClick={() => close()}>Close workers</button>
      {poolStatus} / {status}
      {result !== null && <div>Result: {String(result)}</div>}
      {error && <div>Error: {String(error)}</div>}
    </div>
  );
}
```

Inline factories are safe: callback identity churn does not recreate the pool.
If a new `workerFactory`, `proxyFactory`, or `proxyCleanup` must take
effect, change the `reconfigureKey` option explicitly. Pool-size and
lifecycle-option changes reconfigure automatically. When calls overlap,
status/result/error belong to the latest-started `call()`.

`poolStatus` reports `"initializing"`, `"ready"`, `"error"`, or `"closed"`
independently from task status. When `poolSize` is omitted, the hook leaves one
logical core free and caps the automatic pool at four workers.

For method-specific, fully inferred result state, bind `useWorkerTask` to the
pool API:

```tsx
const pool = useWorkerPool<Api>({ workerFactory, proxyFactory });
const addTask = useWorkerTask(pool.api, "add");

await addTask.run(2, 3); // arguments and Promise<number> are inferred
addTask.result; // number | null
```

The hook forwards the core pool's bounded termination options:
`terminationFailureWorkerBuffer`, `terminationRetryAttempts`,
`terminationRetryDelayMs`, `terminationAttemptTimeoutMs`,
`workerTerminator`, and `onWorkerTerminationError`. The buffer defaults to
`max(2, floor(poolSize / 2))`, preserving healthy capacity through that many
extra potentially-live workers before degrading capacity. Change
`reconfigureKey` when replacing `workerTerminator`; callback identity changes
alone do not recreate the pool.

The core queue controls—`maxQueueSize`, `queueOverflowPolicy`, and
`queueTimeoutMs`—are also forwarded and recreate the owned pool when changed.
`onUpdateStats` and `onEvent` are forwarded through stable refs, so changing an
observer does not recreate the pool.

> 💡 **Tip:** Try the [live playground demo](https://natanelia.github.io/comlink-worker-pool/) for a full working example!

## Get Started Now!

Ready to make your React apps faster and smoother? Install `comlink-worker-pool-react` today and experience effortless parallelism.

---

Made with ❤️ by [@natanelia](https://github.com/natanelia)
