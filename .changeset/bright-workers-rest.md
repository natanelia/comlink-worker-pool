---
"comlink-worker-pool": patch
"comlink-worker-pool-react": patch
---

Harden scheduler reentrancy, stalled drains, timeout enforcement, discarded thenable cleanup, task outcome accounting, React binding and async-observer isolation, commit-phase hook binding, callable state values, and interface-based API typings. Refresh vulnerable development dependencies without cross-major overrides, declare root browser/package-test and React type dependencies explicitly, migrate package builds to current Bunup configuration with isolated ESM and CommonJS outputs, remove stale build artifacts before build and watch modes, validate each emitted source map, and simplify repository configuration and tests.
