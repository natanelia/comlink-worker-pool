---
"comlink-worker-pool-react": patch
---

Commit worker-pool callbacks and factories before publishing them to the live pool so suspended or abandoned React renders cannot leak uncommitted options.
