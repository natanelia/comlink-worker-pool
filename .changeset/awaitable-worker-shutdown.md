---
"comlink-worker-pool": minor
---

Add graceful `drain()`, immediate awaitable `close()`, and a shared
`terminated` promise. Shutdown reports whether every worker termination was
confirmed or cleanup retries were exhausted with unconfirmed workers.
