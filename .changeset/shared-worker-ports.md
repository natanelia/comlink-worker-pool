---
"comlink-worker-pool": patch
"comlink-worker-pool-react": patch
---

Accept fresh `SharedWorker` objects as pool-owned handles, infer `SharedWorker` in proxy and termination callbacks, observe failures from both the worker and its port, and close connection ports automatically during retirement. Concurrent scheduling now works through both the core pool and React hook without unsafe casts.
