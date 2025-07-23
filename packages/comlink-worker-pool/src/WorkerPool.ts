/**
 * Factory type for creating new Web Workers.
 * Used by the WorkerPool to instantiate worker instances.
 */
export type WorkerFactory = () => Worker;

/**
 * Statistics about the current state of the worker pool.
 * Useful for monitoring, dashboards, or adaptive scaling.
 */
export interface WorkerPoolStats {
  /**
   * Configured maximum number of workers in the pool.
   */
  size: number;
  /**
   * Number of workers available to take new tasks (idle + not yet created).
   */
  available: number;
  /**
   * Number of tasks currently waiting in the queue.
   */
  queue: number;
  /**
   * Number of workers currently instantiated.
   */
  workers: number;
  /**
   * Number of workers currently idle (no running tasks).
   */
  idleWorkers: number;
  /**
   * Total number of tasks currently running across all workers.
   */
  runningTasks: number;
  /**
   * Number of workers that can accept additional concurrent tasks.
   */
  availableForConcurrency: number;
}

/**
 * Internal representation of a scheduled task in the pool.
 *
 * @template T The task payload type (usually { method: string; args: unknown[] }).
 * @template R The result type returned by the task.
 */
export interface Task<TTask, TResult> {
  /**
   * The task payload.
   */
  task: TTask;
  /**
   * Resolve function for the task promise.
   */
  resolve: (value: TResult) => void;
  /**
   * Reject function for the task promise.
   */
  reject: (reason?: unknown) => void;
}

/**
 * Options for creating a new WorkerPool instance.
 *
 * @template TProxy The proxy type (API interface) exposed by each worker.
 */
export interface WorkerPoolOptions<
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  TProxy extends Record<string, (...args: any[]) => Promise<unknown>>
> {
  /**
   * The maximum number of workers to create in the pool.
   */
  size: number;
  /**
   * Optional callback to receive live pool statistics updates.
   */
  onUpdateStats?: (stats: WorkerPoolStats) => void;
  /**
   * Factory function to create a new worker instance.
   */
  workerFactory: WorkerFactory;
  /**
   * Factory function to create a new proxy instance for a given worker.
   */
  proxyFactory: (worker: Worker) => TProxy;
  /**
   * Optional timeout (in milliseconds) after which idle workers are terminated.
   */
  workerIdleTimeoutMs?: number;
  /**
   * Optional maximum number of tasks a worker can execute before being terminated.
   * Worker will be terminated after completing its current task when this limit is reached.
   */
  maxTasksPerWorker?: number;
  /**
   * Optional maximum lifetime (in milliseconds) for a worker.
   * Worker will be terminated after completing its current task when this time is exceeded.
   */
  maxWorkerLifetimeMs?: number;
  /**
   * Optional maximum number of concurrent tasks per worker (defaults to 1).
   * Set to a higher value to allow multiple tasks to run concurrently on the same worker.
   * This can improve throughput for I/O-bound or async operations.
   */
  maxConcurrentTasksPerWorker?: number;
}

/**
 * Internal worker metadata for lifecycle management.
 */
interface WorkerMetadata<TProxy = any> {
  id: number;
  proxy: TProxy;
  worker: Worker;
  taskCount: number;
  createdAt: number;
  runningTasks: number;
  markedForTermination?: boolean;
}

/**
 * A generic, high-performance worker pool for parallelizing tasks using Web Workers and Comlink.
 *
 * @template TProxy  The proxy type (API interface) exposed by each worker.
 */

export class WorkerPool<
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  TProxy extends Record<string, (...args: any[]) => Promise<unknown>>,
  TTask extends { method: keyof TProxy; args: unknown[] } = {
    method: keyof TProxy;
    args: unknown[];
  },
  TResult = TProxy[TTask["method"]]
> {
  /**
   * The maximum number of workers in the pool.
   */
  private size: number;

  /**
   * Optional callback to receive live pool statistics updates.
   */
  private onUpdate?: (stats: WorkerPoolStats) => void;

  /**
   * Array of worker objects.
   */
  private workers: WorkerMetadata<TProxy>[] = [];

  /**
   * Array of idle worker objects.
   */
  private idle: WorkerMetadata<TProxy>[] = [];

  /**
   * Array of scheduled tasks.
   */
  private queue: Task<TTask, TResult>[] = [];

  /**
   * Factory function to create a new proxy instance for a given worker.
   */
  private proxyFactory: (worker: Worker) => TProxy;

  /**
   * Factory function to create a new worker instance.
   */
  private workerFactory: () => Worker;

  /**
   * Function to execute a task on a worker.
   */
  private executeTask: (proxy: TProxy, task: TTask) => Promise<TResult>;

  /**
   * Optional timeout (in milliseconds) after which idle workers are terminated.
   */
  private workerIdleTimeoutMs?: number;

  /**
   * Optional maximum number of tasks a worker can execute before being terminated.
   */
  private maxTasksPerWorker?: number;

  /**
   * Optional maximum lifetime (in milliseconds) for a worker.
   */
  private maxWorkerLifetimeMs?: number;

  /**
   * Maximum number of concurrent tasks per worker.
   */
  private maxConcurrentTasksPerWorker: number;

  /**
   * Map of idle timers for each worker.
   */
  private idleTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Counter for generating unique worker IDs.
   */
  private nextWorkerId = 0;

  /**
   * Creates a new worker instance with crash handling.
   *
   * @param id The worker ID.
   */
  private _createWorkerWithCrashHandler(id: number): WorkerMetadata<TProxy> {
    const worker = this.workerFactory();
    const proxy = this.proxyFactory(worker);
    const workerMetadata: WorkerMetadata<TProxy> = {
      id,
      proxy,
      worker,
      taskCount: 0,
      createdAt: Date.now(),
      runningTasks: 0,
      markedForTermination: false,
    };

    const handleCrash = (_event: Event | ErrorEvent) => {
      // Remove from idle if present
      this.idle = this.idle.filter((obj) => obj.id !== id);
      // Replace in workers array
      const idx = this.workers.findIndex((obj) => obj.id === id);
      if (idx !== -1) {
        const newWorkerId = this._getNextWorkerId();
        const newWorkerMetadata =
          this._createWorkerWithCrashHandler(newWorkerId);
        this.workers[idx] = newWorkerMetadata;
        this.idle.push(newWorkerMetadata);
        this._updateStats();
        this._next();
      }
    };
    worker.addEventListener("error", handleCrash);
    worker.addEventListener("close", handleCrash);
    return workerMetadata;
  }

  /**
   * Creates a new WorkerPool instance.
   *
   * @param options Options for the worker pool.
   */
  constructor(options: WorkerPoolOptions<TProxy>) {
    if (options.size < 1) {
      throw new Error("WorkerPool size must be at least 1");
    }
    this.size = options.size;
    this.onUpdate = options.onUpdateStats;
    this.proxyFactory = options.proxyFactory;
    this.workerFactory = options.workerFactory;
    this.workerIdleTimeoutMs = options.workerIdleTimeoutMs;
    this.maxTasksPerWorker = options.maxTasksPerWorker;
    this.maxWorkerLifetimeMs = options.maxWorkerLifetimeMs;
    this.maxConcurrentTasksPerWorker = options.maxConcurrentTasksPerWorker ?? 1;
    
    if (this.maxConcurrentTasksPerWorker < 1) {
      throw new Error("maxConcurrentTasksPerWorker must be at least 1");
    }
    
    this.executeTask = (proxy: TProxy, task: TTask) => {
      return proxy[task.method](...task.args) as Promise<TResult>;
    };
    // Do not create any workers initially; they are created lazily in _next()
    this._updateStats();
  }

  /**
   * Returns a proxy API instance for the worker pool.
   */
  public getApi(): TProxy {
    const handler: ProxyHandler<object> = {
      get: (_target, prop: string) => {
        // Return a function that, when called, schedules the call on the pool
        return (...args: unknown[]) => {
          return this._run({ method: prop, args } as TTask);
        };
      },
    };
    return new Proxy({}, handler) as TProxy;
  }

  /**
   * Runs a task on the worker pool.
   *
   * @param task The task to run.
   */
  private _run(task: TTask): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._next();
      this._updateStats();
    });
  }

  /**
   * Gets an available worker that can accept more tasks, creating a new one if necessary.
   */
  private _getAvailableWorker(): WorkerMetadata<TProxy> | null {
    // First, try to find an existing worker that can accept more concurrent tasks
    // and is not marked for termination
    for (const worker of this.workers) {
      if (worker.runningTasks < this.maxConcurrentTasksPerWorker && !worker.markedForTermination) {
        return worker;
      }
    }

    // If no existing worker can accept more tasks, create a new one if possible
    if (this.workers.length < this.size) {
      const id = this._getNextWorkerId();
      const workerObj = this._createWorkerWithCrashHandler(id);
      this.workers.push(workerObj);
      return workerObj;
    }

    return null;
  }

  /**
   * Executes the next task in the queue.
   */
  private _next() {
    while (this.queue.length > 0) {
      const workerObj = this._getAvailableWorker();
      if (!workerObj) break; // No available workers

      const queueItem = this.queue.shift();
      if (!queueItem) return;

      const { task, resolve, reject } = queueItem;
      
      // Increment running tasks count before starting
      workerObj.runningTasks++;
      
      // Remove from idle if this was the first task for this worker
      if (workerObj.runningTasks === 1) {
        const idleIndex = this.idle.findIndex(w => w.id === workerObj.id);
        if (idleIndex !== -1) {
          this.idle.splice(idleIndex, 1);
          this._clearIdleTimer(workerObj.id);
        }
      }

      this.executeTask(workerObj.proxy, task)
        .then((result: TResult) => resolve(result))
        .catch((err: unknown) => reject(err))
        .finally(() => {
          // Decrement running tasks count
          workerObj.runningTasks--;
          // Increment total task count
          workerObj.taskCount++;

          // Check if worker should be terminated due to lifecycle limits
          if (this._shouldTerminateWorker(workerObj)) {
            workerObj.markedForTermination = true;
            // Only terminate if no tasks are running
            if (workerObj.runningTasks === 0) {
              setTimeout(() => {
                this._terminateWorker(workerObj.id);
                this._updateStats();
              }, 10); // Small delay for Comlink cleanup
            }
          } else if (workerObj.runningTasks === 0) {
            // Worker is now idle, add to idle list
            this.idle.push(workerObj);
            this._startIdleTimer(workerObj.id);
          }

          this._updateStats();
          this._next();
        });
      
      this._updateStats();
    }
  }

  /**
   * Gets the next unique worker ID.
   *
   * @returns The next worker ID.
   */
  private _getNextWorkerId(): number {
    return this.nextWorkerId++;
  }

  /**
   * Checks if a worker should be terminated based on lifecycle limits.
   * Only terminates workers that have no running tasks.
   *
   * @param workerObj The worker metadata to check.
   * @returns True if the worker should be terminated.
   */
  private _shouldTerminateWorker(workerObj: WorkerMetadata<TProxy>): boolean {
    // Don't terminate workers with running tasks
    if (workerObj.runningTasks > 0) {
      return false;
    }

    // Check task count limit
    if (
      this.maxTasksPerWorker &&
      workerObj.taskCount >= this.maxTasksPerWorker
    ) {
      return true;
    }

    // Check lifetime limit
    if (this.maxWorkerLifetimeMs) {
      const age = Date.now() - workerObj.createdAt;
      if (age >= this.maxWorkerLifetimeMs) {
        return true;
      }
    }

    return false;
  }

  /**
   * Terminates a specific worker by ID.
   *
   * @param id The worker ID to terminate.
   */
  private _terminateWorker(id: number): void {
    // Find the worker
    const workerIndex = this.workers.findIndex((obj) => obj.id === id);
    if (workerIndex === -1) return;

    const workerObj = this.workers[workerIndex];
    
    // Don't terminate workers with running tasks
    if (workerObj.runningTasks > 0) {
      return;
    }

    // Remove from idle if present
    this.idle = this.idle.filter((obj) => obj.id !== id);

    // Terminate the worker immediately to prevent further use
    workerObj.worker.terminate();
    this.workers.splice(workerIndex, 1);

    // Clear idle timer if exists
    this._clearIdleTimer(id);
  }

  /**
   * Starts an idle timer for a worker.
   *
   * @param id The worker ID.
   */
  private _startIdleTimer(id: number) {
    if (!this.workerIdleTimeoutMs) return;
    this._clearIdleTimer(id);
    const timer = setTimeout(() => {
      this._terminateWorker(id);
      this._updateStats();
    }, this.workerIdleTimeoutMs);
    this.idleTimers.set(id, timer);
  }

  /**
   * Clears an idle timer for a worker.
   *
   * @param id The worker ID.
   */
  private _clearIdleTimer(id: number) {
    const timer = this.idleTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(id);
    }
  }

  /**
   * Returns the current statistics of the worker pool.
   */
  public getStats(): WorkerPoolStats {
    // Calculate total running tasks across all workers
    const runningTasks = this.workers.reduce((sum, worker) => sum + worker.runningTasks, 0);
    
    // Calculate workers that can accept additional concurrent tasks
    const availableForConcurrency = this.workers.filter(
      worker => worker.runningTasks < this.maxConcurrentTasksPerWorker
    ).length;
    
    // Available capacity includes workers that can accept more tasks + potential new workers
    const available = availableForConcurrency + (this.size - this.workers.length);
    
    return {
      size: this.size,
      available,
      queue: this.queue.length,
      workers: this.workers.length,
      idleWorkers: this.idle.length,
      runningTasks,
      availableForConcurrency,
    };
  }

  /**
   * Terminates all workers in the pool.
   */
  public terminateAll(): void {
    // Terminate all workers
    for (const { worker } of this.workers) {
      worker.terminate();
    }
    // Clear idle timers
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    // Clear all arrays
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this._updateStats();
  }

  /**
   * Updates the statistics of the worker pool.
   */
  private _updateStats(): void {
    if (this.onUpdate) {
      const stats = this.getStats();
      this.onUpdate(stats);
    }
  }
}
