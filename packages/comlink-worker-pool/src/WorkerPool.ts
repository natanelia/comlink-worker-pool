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
	 * Number of workers currently idle.
	 */
	idleWorkers: number;
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
	TProxy extends Record<string, (...args: any[]) => Promise<unknown>>,
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
	TResult = TProxy[TTask["method"]],
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
	private workers: { id: number; proxy: TProxy; worker: Worker }[] = [];

	/**
	 * Array of idle worker objects.
	 */
	private idle: { id: number; proxy: TProxy; worker: Worker }[] = [];

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
	 * Map of idle timers for each worker.
	 */
	private idleTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

	/**
	 * Creates a new worker instance with crash handling.
	 *
	 * @param id The worker ID.
	 */
	private _createWorkerWithCrashHandler(id: number) {
		const worker = this.workerFactory();
		const proxy = this.proxyFactory(worker);
		const handleCrash = (_event: Event | ErrorEvent) => {
			// Remove from idle if present
			this.idle = this.idle.filter((obj) => obj.id !== id);
			// Replace in workers array
			const idx = this.workers.findIndex((obj) => obj.id === id);
			if (idx !== -1) {
				const newWorker = this.workerFactory();
				const newProxy = this.proxyFactory(newWorker);
				// Attach listeners recursively
				newWorker.addEventListener("error", handleCrash);
				newWorker.addEventListener("close", handleCrash);
				this.workers[idx] = { id, proxy: newProxy, worker: newWorker };
				this.idle.push({ id, proxy: newProxy, worker: newWorker });
				this._updateStats();
				this._next();
			}
		};
		worker.addEventListener("error", handleCrash);
		worker.addEventListener("close", handleCrash);
		return { id, proxy, worker };
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
	 * Executes the next task in the queue.
	 */
	private _next() {
		while (
			this.queue.length > 0 &&
			(this.idle.length > 0 || this.workers.length < this.size)
		) {
			let workerObj: { id: number; proxy: TProxy; worker: Worker };
			if (this.idle.length > 0) {
				const maybeWorker = this.idle.shift();
				if (!maybeWorker) continue; // Defensive: should never happen, but avoids non-null assertion
				workerObj = maybeWorker;
				this._clearIdleTimer(workerObj.id); // Cancel idle termination if reused
			} else {
				// Lazily create a new worker
				const id = this.workers.length;
				workerObj = this._createWorkerWithCrashHandler(id);
				this.workers.push(workerObj);
			}
			const queueItem = this.queue.shift();
			if (!workerObj || !queueItem) return;
			const { task, resolve, reject } = queueItem;
			this.executeTask(workerObj.proxy, task)
				.then((result: TResult) => resolve(result))
				.catch((err: unknown) => reject(err))
				.finally(() => {
					this.idle.push(workerObj);
					this._startIdleTimer(workerObj.id);
					this._updateStats();
					this._next();
				});
			this._updateStats();
		}
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
			// Remove from idle and workers
			const workerObj = this.idle.find((obj) => obj.id === id);
			if (workerObj) {
				this.idle = this.idle.filter((obj) => obj.id !== id);
				this.workers = this.workers.filter((obj) => obj.id !== id);
				workerObj.worker.terminate();
				this.idleTimers.delete(id);
				this._updateStats();
			}
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
		// available: how many workers could take work, even if not all are created yet
		const available = this.idle.length + (this.size - this.workers.length);
		return {
			size: this.size,
			available,
			queue: this.queue.length,
			workers: this.workers.length,
			idleWorkers: this.idle.length,
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
