# comlink-worker-pool-react

Supercharge your React apps with effortless, high-performance web worker pools! 🚀

**comlink-worker-pool-react** brings the power of [comlink-worker-pool](https://github.com/natanelia/comlink-worker-pool) to React, making it easy to offload heavy computations to web workers with a beautiful, idiomatic hook-based API.

## Why comlink-worker-pool-react?
- **Blazing Fast UI**: Keep your React app snappy by running CPU-intensive tasks in parallel, outside the main thread.
- **Zero Boilerplate**: Instantly integrate worker pools with a single hook.
- **TypeScript First**: Enjoy full type safety and autocompletion.
- **Seamless Developer Experience**: Designed for React, by React devs.

## Features
- 🪝 `useWorkerPool()` React hook for easy worker pool integration
- 🧑‍💻 Simple, declarative API
- 🛡️ TypeScript support out of the box
- ⚡ Automatic pool management & lifecycle handling
- 🔄 Real-time status, results, and error tracking
- 🧩 Works with any Comlink-compatible worker

## Installation

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
import { expose } from 'comlink';

const api = {
  add: async (a: number, b: number) => a + b,
};

expose(api);
```

2. **Use the hook in your React component:**

```tsx
import { useWorkerPool } from 'comlink-worker-pool-react';
import { wrap } from 'comlink';

type Api = {
  add: (a: number, b: number) => Promise<number>;
};

const { api, status, result, error, call } = useWorkerPool<Api>({
  workerFactory: () => new Worker(new URL('./worker', import.meta.url)),
  proxyFactory: (worker) => wrap<Api>(worker),
  poolSize: 2,
});

return (
  <div>
    <button
      onClick={async () => {
        await call('add', 2, 3);
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

> 💡 **Tip:** See the `playground` directory for a full working example!

## Get Started Now!
Ready to make your React apps faster and smoother? Install `comlink-worker-pool-react` today and experience effortless parallelism.

---

Made with ❤️ by [@natanelia](https://github.com/natanelia)
