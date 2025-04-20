# comlink-worker-pool Monorepo

A modern Bun-based monorepo for high-performance web workers in React and JavaScript/TypeScript projects. This monorepo contains:

- **comlink-worker-pool**: A reusable, Comlink-based worker pool library
- **playground**: An interactive React demo app showcasing the worker pool

## Getting Started

1. **Install Dependencies**
   ```bash
   bun install
   ```

2. **Build the Worker Pool Library**
   ```bash
   bun run --filter comlink-worker-pool build
   ```

3. **Run the Playground Demo**
   ```bash
   bun run --filter playground dev
   ```

## Monorepo Structure

```
comlink-worker-pool-react/
├── packages/
│   ├── comlink-worker-pool/   # The worker pool library
│   └── playground/            # React demo app
├── bunfig.toml
├── package.json
└── README.md
```

## About
- Uses [Bun](https://bun.sh/) for fast builds and workspace management
- Worker pool built with [Comlink](https://github.com/GoogleChromeLabs/comlink)
- Playground built with [React](https://react.dev/) + [Vite](https://vitejs.dev/)

---

For details, see the individual package READMEs in `packages/comlink-worker-pool` and `packages/playground`.
