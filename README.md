# ⚡️ comlink-worker-pool Monorepo

[![bun compatible](https://img.shields.io/badge/bun-%E2%9C%94%EF%B8%8F-green)](https://bun.sh/)
[![CI](https://github.com/natanelia/comlink-worker-pool/actions/workflows/ci.yml/badge.svg)](https://github.com/natanelia/comlink-worker-pool/actions)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🚀 **Try the [Live Playground Demo](https://natanelia.github.io/comlink-worker-pool/)!**

**The modern monorepo for high-performance, ergonomic web worker pools in React, JS, and TypeScript — powered by Comlink.**

---

## ✨ Why comlink-worker-pool?

- 🚀 Effortless parallelism: Offload heavy computation to workers, keep your UI snappy
- 🧩 Modular: Use just the core, or drop in React bindings for instant hooks
- 🦾 TypeScript-first: Full type safety across packages
- 🛠️ OSS-friendly: Clean structure, easy contributions, and clear docs
- 🧯 Bounded shutdown recovery: Failed terminations are quarantined without
  allowing unlimited replacement workers

---

## 📦 Packages

- [**comlink-worker-pool**](./packages/comlink-worker-pool/README.md): Reusable, Comlink-based worker pool library for parallel processing
- [**comlink-worker-pool-react**](./packages/comlink-worker-pool-react/README.md): React bindings for the worker pool, including the `useWorkerPool` hook
- [**playground**](./packages/playground/README.md): Interactive React demo app showcasing the worker pool and React bindings ([Live playground](https://natanelia.github.io/comlink-worker-pool/))

## 🚀 Quick Start (For Package Users)

Install the packages you need in your own project:

```bash
npm install comlink-worker-pool
# or for React bindings:
npm install comlink-worker-pool comlink-worker-pool-react
```

### Example Usage

#### comlink-worker-pool

1. **Create a worker (worker.ts):**

   ```ts
   import { expose } from "comlink";

   const api = {
     fib: async (n: number): Promise<number> =>
       n <= 1 ? n : (await api.fib(n - 1)) + (await api.fib(n - 2)),
   };

   expose(api);
   ```

2. **Use the WorkerPool in your app:**

   ```ts
   import { WorkerPool } from "comlink-worker-pool";
   import * as Comlink from "comlink";

   type WorkerApi = {
     fib(n: number): Promise<number>;
   };

   const pool = new WorkerPool<WorkerApi>({
     size: 2,
     maxConcurrentTasksPerWorker: 3, // NEW: Allow concurrent tasks per worker
     workerFactory: () =>
       new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
     proxyFactory: (worker) => Comlink.wrap<WorkerApi>(worker),
   });

   const api = pool.getApi();

   // the following .fib calls are run in parallel
   const results = await Promise.all([api.fib(10), api.fib(2), api.fib(3)]);
   console.log(results); // Output: [55, 2, 3]
   ```

---

#### comlink-worker-pool-react

1. **Create a worker (worker.ts):**

   ```ts
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
       <button onClick={async () => await call("add", 2, 3)}>Add 2 + 3</button>
       {status}
       {result && <div>Result: {result}</div>}
       {error && <div>Error: {String(error)}</div>}
     </div>
   );
   ```

See the individual package READMEs for full usage and advanced features:

- [comlink-worker-pool](./packages/comlink-worker-pool/README.md)
- [comlink-worker-pool-react](./packages/comlink-worker-pool-react/README.md)

---

## 🛠️ For Contributors (Monorepo Setup)

If you want to contribute or run the playground locally:

1. **Install dependencies**
   ```bash
   bun install
   ```
2. **Build the worker pool library**
   ```bash
   bun run --filter comlink-worker-pool build
   ```
3. **Run the playground demo**
   ```bash
   bun run --filter playground dev
   ```

## 🗂️ Monorepo Structure

```
comlink-worker-pool/
├── packages/
│   ├── comlink-worker-pool/        # The worker pool library (core)
│   ├── comlink-worker-pool-react/  # React bindings for the worker pool
│   └── playground/                 # React demo app
├── bunfig.toml
├── package.json
└── README.md
```

## 🛠️ Tech Stack

- [Bun](https://bun.sh/) for ultra-fast builds and workspace management
- [Comlink](https://github.com/GoogleChromeLabs/comlink) for type-safe, ergonomic worker communication
- [React](https://react.dev/) + [Vite](https://vitejs.dev/) for a modern playground/demo

## 🤝 Contributing

We love OSS! Issues and PRs are welcome — see the individual package READMEs for details:

- [comlink-worker-pool](./packages/comlink-worker-pool/README.md)
- [comlink-worker-pool-react](./packages/comlink-worker-pool-react/README.md)
- [playground](./packages/playground/README.md)

## 📦 Publishing to npm

This monorepo uses [Changesets](https://github.com/changesets/changesets) for version management and publishing.

### Publishing Workflow

1. **Document your changes:**

   ```bash
   bun run changeset
   ```

   Follow the prompts to select packages and version bump type (major/minor/patch).

2. **Update versions:**

   ```bash
   bun run version
   ```

   This applies changesets, updates package versions and CHANGELOGs, and syncs dependencies.

3. **Publish to npm:**
   ```bash
   bun run release
   ```
   This builds, tests, and publishes all packages to npm (requires `npm login`).

**Note:** Make sure you're logged into npm (`npm login`) before running the release command.

---

Made with ❤️ by [@natanelia](https://github.com/natanelia). Licensed under the MIT License.
