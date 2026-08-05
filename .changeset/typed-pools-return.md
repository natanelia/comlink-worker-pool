---
"comlink-worker-pool": patch
"comlink-worker-pool-react": patch
---

Correct the public scheduled API types so every pooled method returns a Promise, while reserved `then` and symbol keys are omitted from `getApi()` and the React hook API.
