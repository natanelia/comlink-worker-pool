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
import { useWorkerPool } from "comlink-worker-pool-react";
import { wrap } from "comlink";

type Api = {
  add: (a: number, b: number) => Promise<number>;
};

const { api, status, result, error, call } = useWorkerPool<Api>({
  workerFactory: () => new Worker(new URL("./worker", import.meta.url)),
  proxyFactory: (worker) => wrap<Api>(worker),
  poolSize: 2,
});

return (
  <div>
    <button
      onClick={async () => {
        await call("add", 2, 3);
      }}
    >
      Add 2 + 3
    </button>
    {status}
    {result && <div>Result: {result}</div>}
    {error && <div>Error: {String(error)}</div>}
  </div>
);
```

> 💡 **Tip:** Try the [live playground demo](https://natanelia.github.io/comlink-worker-pool/) for a full working example!

## Get Started Now!

Ready to make your React apps faster and smoother? Install `comlink-worker-pool-react` today and experience effortless parallelism.

---

Made with ❤️ by [@natanelia](https://github.com/natanelia)
