---
"comlink-worker-pool": minor
"comlink-worker-pool-react": minor
---

Harden worker ownership and shutdown: settle queued and active calls on
termination/crash, prevent stale completions and zombie workers, enforce strict
capacity/lifecycle limits, add a five-minute default task deadline with an
explicit opt-out, quarantine failed terminations behind a bounded replacement
budget with retries and observability, add proxy cleanup, and fix ESM/CommonJS
exports. The React hook now handles StrictMode, inline factories,
initialization errors, unmount races, latest-call result ownership, and the new
termination controls.
