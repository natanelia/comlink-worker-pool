# comlink-worker-pool

## 0.1.1

### Patch Changes

- 24fe37f: Harden scheduler reentrancy, stalled drains, timeout enforcement, discarded thenable cleanup, task outcome accounting, React binding and async-observer isolation, commit-phase hook binding, callable state values, and interface-based API typings. Refresh vulnerable development dependencies without cross-major overrides, declare root browser/package-test and React type dependencies explicitly, migrate package builds to current Bunup configuration with isolated ESM and CommonJS outputs, remove stale build artifacts before build and watch modes, validate each emitted source map, and simplify repository configuration and tests.

  Prevent premature shutdown confirmation while worker construction is in progress, capture failures during proxy/listener setup, and ensure cancellation reentrancy cannot execute settled work. Replace quadratic queue operations with an adaptive FIFO/priority heap, add constant-time idle-worker and removal paths, reduce dispatch allocations, and enforce task-throughput, worker-churn, and burst-lifecycle performance budgets.

## 0.1.0

### Minor Changes

- 2f3fc84: Add structured task and worker lifecycle events plus queue age, capacity, lifecycle state, and cumulative outcome counters to pool statistics. Forward event observers through the React hook without recreating its pool.
- bcd75e9: Add graceful `drain()`, immediate awaitable `close()`, and a shared
  `terminated` promise. Shutdown reports whether every worker termination was
  confirmed or cleanup retries were exhausted with unconfirmed workers.
- bb1a044: Add a typed `run()` API with abort signals, priorities, and queue deadlines;
  add configurable queue bounds with reject or drop-oldest overflow behavior;
  and balance concurrent work across the least-loaded workers. React bindings now
  forward the pool-level queue controls.
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

## 0.0.9

### Patch Changes

- fix: npm package descriptions

## 0.0.8

### Patch Changes

- Fix: When browser idles, idle worker count becomes 0 when no worker is running

## 0.0.4

### Patch Changes

- Release version 0.0.4 with latest changes
