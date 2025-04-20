# ⚡️ comlink-plus Monorepo

[![bun compatible](https://img.shields.io/badge/bun-%E2%9C%94%EF%B8%8F-green)](https://bun.sh/)
[![CI](https://github.com/natanelia/comlink-plus/actions/workflows/ci.yml/badge.svg)](https://github.com/natanelia/comlink-plus/actions)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**The modern monorepo for high-performance, ergonomic web worker pools in React, JS, and TypeScript — powered by Bun and Comlink.**

---

## ✨ Why comlink-plus?

- 🚀 Effortless parallelism: Offload heavy computation to workers, keep your UI snappy
- 🧩 Modular: Use just the core, or drop in React bindings for instant hooks
- 🦾 TypeScript-first: Full type safety across packages
- ⚡ Blazing fast builds and workspace management with Bun
- 🛠️ OSS-friendly: Clean structure, easy contributions, and clear docs

---

## 📦 Packages

- [**comlink-worker-pool**](./packages/comlink-worker-pool/README.md): Reusable, Comlink-based worker pool library for parallel processing
- [**comlink-worker-pool-react**](./packages/comlink-worker-pool-react/README.md): React bindings for the worker pool, including the `useWorkerPool` hook
- [**playground**](./packages/playground/README.md): Interactive React demo app showcasing the worker pool and React bindings

## 🚀 Quick Start

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

Or see each package's README for more advanced usage and integration.

## 🗂️ Monorepo Structure

```
comlink-plus/
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

---

© 2025 comlink-plus. Licensed under the MIT License.
