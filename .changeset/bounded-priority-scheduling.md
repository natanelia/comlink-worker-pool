---
"comlink-worker-pool": minor
"comlink-worker-pool-react": minor
---

Add a typed `run()` API with abort signals, priorities, and queue deadlines;
add configurable queue bounds with reject or drop-oldest overflow behavior;
and balance concurrent work across the least-loaded workers. React bindings now
forward the pool-level queue controls.
