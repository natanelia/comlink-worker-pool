import * as Comlink from 'comlink';

export default class WorkerPool {
  constructor(size, onUpdate) {
    this.size = size;
    this.onUpdate = onUpdate;
    this.workers = [];
    this.idle = [];
    this.queue = [];
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      const proxy = Comlink.wrap(worker);
      const obj = { id: i, proxy };
      this.workers.push(obj);
      this.idle.push(obj);
    }
    this._updateStats();
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._next();
      this._updateStats();
    });
  }

  _next() {
    if (this.idle.length > 0 && this.queue.length > 0) {
      const workerObj = this.idle.shift();
      const { task, resolve, reject } = this.queue.shift();
      workerObj.proxy.handleTask(task)
        .then(result => resolve({ id: workerObj.id, result }))
        .catch(err => reject(err))
        .finally(() => {
          this.idle.push(workerObj);
          this._updateStats();
          this._next();
        });
      this._updateStats();
    }
  }

  _updateStats() {
    if (this.onUpdate) {
      this.onUpdate({ size: this.size, idle: this.idle.length, queue: this.queue.length });
    }
  }
}
