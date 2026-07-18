# comlink-worker-pool-react

## 0.1.0

### Minor Changes

- 2f3fc84: Add structured task and worker lifecycle events plus queue age, capacity, lifecycle state, and cumulative outcome counters to pool statistics. Forward event observers through the React hook without recreating its pool.
- bb1a044: Add a typed `run()` API with abort signals, priorities, and queue deadlines;
  add configurable queue bounds with reject or drop-oldest overflow behavior;
  and balance concurrent work across the least-loaded workers. React bindings now
  forward the pool-level queue controls.
- 5b587a1: Expose initializing, ready, error, and closed pool lifecycle state, add awaitable manual close, introduce a fully inferred method-bound `useWorkerTask` hook, and use a conservative capped default pool size.
- 4b4afad: Harden worker ownership and shutdown: settle queued and active calls on
  termination/crash, prevent stale completions and zombie workers, enforce strict
  capacity/lifecycle limits, add a five-minute default task deadline with an
  explicit opt-out, quarantine failed terminations behind a bounded replacement
  budget with retries and observability, add proxy cleanup, and fix ESM/CommonJS
  exports. The React hook now handles StrictMode, inline factories,
  initialization errors, unmount races, latest-call result ownership, and the new
  termination controls.

### Patch Changes

- 99f3b53: Publish readable ESM and CommonJS artifacts with linked source maps, complete package metadata, focused documentation, and a runnable React playground example.
- 1aeac03: Correct conditional type exports for CommonJS consumers and publish the React package with an installable core dependency range.
- Updated dependencies [2f3fc84]
- Updated dependencies [bcd75e9]
- Updated dependencies [bb1a044]
- Updated dependencies [99f3b53]
- Updated dependencies [4b4afad]
- Updated dependencies [1aeac03]
  - comlink-worker-pool@0.1.0

## 0.0.9

### Patch Changes

- fix: npm package descriptions
- Updated dependencies
  - comlink-worker-pool@0.0.9

## 0.0.8

### Patch Changes

- Fix: When browser idles, idle worker count becomes 0 when no worker is running
- Updated dependencies
  - comlink-worker-pool@0.0.8

## 0.0.4

### Patch Changes

- Release version 0.0.4 with latest changes
- Updated dependencies
  - comlink-worker-pool@0.0.4
