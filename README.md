# comlink-plus Monorepo

A modern Bun-based monorepo for high-performance web workers in React and JavaScript/TypeScript projects.

**comlink-plus** provides:

- [**comlink-worker-pool**](./packages/comlink-worker-pool/README.md): A reusable, Comlink-based worker pool library for parallel processing in web apps
- [**comlink-worker-pool-react**](./packages/comlink-worker-pool-react/README.md): React bindings for comlink-worker-pool, including the `useWorkerPool` hook
- [**playground**](./packages/playground/README.md): An interactive React demo app showcasing the worker pool and React bindings in action

## Getting Started

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

## Monorepo Structure

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

## About

- Built with [Bun](https://bun.sh/) for fast builds and workspace management
- Worker pool powered by [Comlink](https://github.com/GoogleChromeLabs/comlink)
- Playground built with [React](https://react.dev/) and [Vite](https://vitejs.dev/)

## Contributing

Contributions are welcome! Please open issues or submit pull requests. For details, see the individual package READMEs:

- [comlink-worker-pool](./packages/comlink-worker-pool/README.md)
- [comlink-worker-pool-react](./packages/comlink-worker-pool-react/README.md)
- [playground](./packages/playground/README.md)

---

© 2025 comlink-plus. Licensed under the MIT License.
