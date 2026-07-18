import { releaseProxy } from "comlink";
import {
	WorkerCrashedError,
	WorkerPoolCapacityError,
	WorkerPoolQueueFullError,
	WorkerPoolTerminatedError,
	WorkerQueueTimeoutError,
	WorkerTaskAbortedError,
	WorkerTaskTimeoutError,
	type WorkerTerminationError,
} from "./errors";
import {
	DEFAULT_TASK_TIMEOUT_MS,
	MAX_TIMER_DELAY_MS,
	type WorkerMetadata,
	assertNonNegativeInteger,
	assertPositiveDuration,
	assertPositiveInteger,
	monotonicNow,
} from "./internal/lifecycle";
import { type ScheduledTask, SchedulerQueue } from "./internal/scheduler";
import {
	DEFAULT_TERMINATION_ATTEMPT_TIMEOUT_MS,
	DEFAULT_TERMINATION_RETRY_ATTEMPTS,
	DEFAULT_TERMINATION_RETRY_DELAY_MS,
	TerminationController,
} from "./internal/termination";

export * from "./errors";

/** Factory for creating a new Web Worker. */
export type WorkerFactory = () => Worker;

/** Terminates a Worker and resolves only when termination is confirmed. */
// biome-ignore lint/suspicious/noConfusingVoidType: sync terminators naturally return void.
export type WorkerTerminator = (worker: Worker) => void | PromiseLike<unknown>;

/** Policy applied when a submitted task would exceed maxQueueSize. */
export type QueueOverflowPolicy = "reject" | "drop-oldest";

/** Per-call scheduling controls for WorkerPool.run(). */
export interface WorkerTaskOptions {
	/** Cancels the caller's wait without forcibly interrupting worker code. */
	signal?: AbortSignal;
	/** Higher values run before lower values; equal priorities remain FIFO. */
	priority?: number;
	/** Maximum time spent waiting in the queue; false disables the pool default. */
	queueTimeoutMs?: number | false;
}

/** Observable lifecycle state of a worker pool. */
export type WorkerPoolState = "running" | "draining" | "closed";

/** Final caller-visible outcome emitted for a scheduled task. */
export type WorkerPoolTaskOutcome =
	| "fulfilled"
	| "rejected"
	| "aborted"
	| "queue-timeout"
	| "task-timeout"
	| "queue-rejected"
	| "dropped"
	| "worker-failure"
	| "pool-closed";

/** Reason a worker left the scheduler-managed set. */
export type WorkerPoolWorkerRemovalReason =
	| "shutdown"
	| "idle"
	| "lifetime"
	| "max-tasks"
	| "failure"
	| "task-timeout";

/** A structured, argument-free event emitted by WorkerPool. */
export type WorkerPoolEvent =
	| {
			type: "task-queued";
			timestamp: number;
			taskId: number;
			method: string;
			priority: number;
	  }
	| {
			type: "task-started";
			timestamp: number;
			taskId: number;
			method: string;
			workerId: number;
			queueWaitMs: number;
	  }
	| {
			type: "task-settled";
			timestamp: number;
			taskId: number;
			method: string;
			workerId?: number;
			outcome: WorkerPoolTaskOutcome;
			durationMs: number;
	  }
	| {
			type: "worker-created";
			timestamp: number;
			workerId: number;
	  }
	| {
			type: "worker-removed";
			timestamp: number;
			workerId: number;
			reason: WorkerPoolWorkerRemovalReason;
	  }
	| {
			type: "worker-termination-failed";
			timestamp: number;
			workerId?: number;
			attempt: number;
			exhausted: boolean;
	  };

/** Statistics describing the current state of a worker pool. */
export interface WorkerPoolStats {
	/** Current acceptance and shutdown state. */
	state: WorkerPoolState;
	/** Configured maximum number of scheduler-managed, non-quarantined workers. */
	size: number;
	/** Configured maximum number of simultaneously running tasks. */
	maxConcurrentTasks: number;
	/** Number of existing or not-yet-created workers that can accept work. */
	available: number;
	/** Number of tasks waiting for a worker. */
	queue: number;
	/** Configured queue limit, or null when the queue is unbounded. */
	queueCapacity: number | null;
	/** Remaining bounded queue slots, or null when the queue is unbounded. */
	queueCapacityRemaining: number | null;
	/** Age of the oldest waiting task, or null when the queue is empty. */
	oldestQueuedTaskAgeMs: number | null;
	/** Number of currently instantiated workers. */
	workers: number;
	/** Scheduler-managed workers, including busy workers finishing before retirement. */
	healthyWorkers: number;
	/** Number of removed workers whose termination is not yet confirmed. */
	quarantinedWorkers: number;
	/** Configured extra physical-worker allowance for quarantined workers. */
	terminationFailureWorkerBuffer: number;
	/** Cumulative number of failed or timed-out termination attempts. */
	terminationFailures: number;
	/** Number of workers with no running tasks. */
	idleWorkers: number;
	/** Number of tasks currently running across all workers. */
	runningTasks: number;
	/** Number of existing workers that can accept another concurrent task. */
	availableForConcurrency: number;
	/** Cumulative valid calls received by the scheduler. */
	submittedTasks: number;
	/** Cumulative calls assigned to workers. */
	startedTasks: number;
	/** Cumulative successfully settled calls. */
	completedTasks: number;
	/** Cumulative failed calls not counted as cancellation, timeout, or drop. */
	failedTasks: number;
	/** Cumulative AbortSignal cancellations. */
	cancelledTasks: number;
	/** Cumulative queue and execution timeouts. */
	timedOutTasks: number;
	/** Cumulative calls evicted by the drop-oldest policy. */
	droppedTasks: number;
}

/** Final outcome of an awaitable WorkerPool shutdown. */
export interface WorkerPoolShutdownReport {
	/** True when termination was confirmed for every worker. */
	confirmed: boolean;
	/** Workers whose termination could not be confirmed after all retries. */
	unconfirmedWorkers: number;
	/** Cumulative failed or timed-out termination attempts. */
	terminationFailures: number;
}

/** Internal representation of a scheduled task. */
export interface Task<TTask, TResult> {
	task: TTask;
	resolve: (value: TResult) => void;
	reject: (reason?: unknown) => void;
}

/** Options for creating a WorkerPool. */
export interface WorkerPoolOptions<
	// biome-ignore lint/suspicious/noExplicitAny: worker APIs may have arbitrary signatures
	TProxy extends Record<string, (...args: any[]) => unknown>,
> {
	/** Maximum number of scheduler-managed, non-quarantined workers. */
	size: number;
	/** Optional callback for pool statistics. Observer errors do not break the pool. */
	onUpdateStats?: (stats: WorkerPoolStats) => void;
	/** Receives structured task and worker events. Observer errors are isolated. */
	onEvent?: (event: WorkerPoolEvent) => void;
	/** Creates a fresh worker instance. */
	workerFactory: WorkerFactory;
	/** Creates the API proxy associated with a worker. */
	proxyFactory: (worker: Worker) => TProxy;
	/** Terminates an idle worker after this many milliseconds. */
	workerIdleTimeoutMs?: number;
	/** Retires a worker after this many assigned tasks. */
	maxTasksPerWorker?: number;
	/** Retires a worker after this lifetime, once its active tasks finish. */
	maxWorkerLifetimeMs?: number;
	/** Maximum concurrent tasks per worker. Defaults to 1. */
	maxConcurrentTasksPerWorker?: number;
	/** Maximum waiting tasks; running tasks do not count. Defaults to unlimited. */
	maxQueueSize?: number;
	/** Behavior when maxQueueSize would be exceeded. Defaults to reject. */
	queueOverflowPolicy?: QueueOverflowPolicy;
	/** Default maximum queue wait; false or undefined disables it. */
	queueTimeoutMs?: number | false;
	/**
	 * Rejects a task that runs longer than this duration and recycles its worker.
	 * Defaults to five minutes because this is the only portable way to recover
	 * from a worker that silently closes. Set to false for intentionally unbounded
	 * jobs, accepting that a silent worker exit can then leave work pending.
	 */
	taskTimeoutMs?: number | false;
	/** Optional cleanup for resources owned by a proxy (for example Comlink.releaseProxy). */
	proxyCleanup?: (proxy: TProxy) => void;
	/**
	 * Extra physical-worker allowance used to preserve healthy capacity while
	 * removed workers have unconfirmed termination. Defaults to
	 * max(2, floor(size / 2)).
	 */
	terminationFailureWorkerBuffer?: number;
	/** Additional termination attempts after the initial attempt. Defaults to 3. */
	terminationRetryAttempts?: number;
	/** Initial retry delay; subsequent delays use exponential backoff. Defaults to 100ms. */
	terminationRetryDelayMs?: number;
	/** Deadline for each asynchronous termination attempt. Defaults to 5 seconds. */
	terminationAttemptTimeoutMs?: number;
	/** Optional host-specific termination implementation. */
	workerTerminator?: WorkerTerminator;
	/** Receives isolated termination-attempt failures. */
	onWorkerTerminationError?: (error: WorkerTerminationError) => void;
}

/** A lazy, bounded pool for proxying calls to Web Workers. */
export class WorkerPool<
	// biome-ignore lint/suspicious/noExplicitAny: worker APIs may have arbitrary signatures
	TProxy extends Record<string, (...args: any[]) => unknown>,
	TTask extends { method: keyof TProxy; args: unknown[] } = {
		method: keyof TProxy;
		args: unknown[];
	},
	TResult = Awaited<ReturnType<TProxy[TTask["method"]]>>,
> {
	private readonly size: number;
	private readonly onUpdate?: (stats: WorkerPoolStats) => void;
	private readonly onEvent?: (event: WorkerPoolEvent) => void;
	private readonly proxyFactory: (worker: Worker) => TProxy;
	private readonly workerFactory: WorkerFactory;
	private readonly workerIdleTimeoutMs?: number;
	private readonly maxTasksPerWorker?: number;
	private readonly maxWorkerLifetimeMs?: number;
	private readonly maxConcurrentTasksPerWorker: number;
	private readonly maxQueueSize: number;
	private readonly queueOverflowPolicy: QueueOverflowPolicy;
	private readonly queueTimeoutMs?: number;
	private readonly taskTimeoutMs?: number;
	private readonly proxyCleanup?: (proxy: TProxy) => void;
	private readonly terminationFailureWorkerBuffer: number;
	private readonly physicalWorkerLimit: number;
	private readonly termination: TerminationController;

	private workers: WorkerMetadata<TProxy, TTask, TResult>[] = [];
	private readonly queue = new SchedulerQueue<TTask, TResult>();
	private nextWorkerId = 0;
	private nextTaskSequence = 0;
	private accepting = true;
	private drainRequested = false;
	private terminationStarted = false;
	private scheduling = false;
	private shutdownResolved = false;
	private submittedTasks = 0;
	private startedTasks = 0;
	private completedTasks = 0;
	private failedTasks = 0;
	private cancelledTasks = 0;
	private timedOutTasks = 0;
	private droppedTasks = 0;
	private readonly knownWorkers = new WeakSet<object>();
	private resolveTerminated!: (report: WorkerPoolShutdownReport) => void;
	/** Resolves once every worker is confirmed terminated or cleanup is exhausted. */
	public readonly terminated: Promise<WorkerPoolShutdownReport>;

	constructor(options: WorkerPoolOptions<TProxy>) {
		this.terminated = new Promise((resolve) => {
			this.resolveTerminated = resolve;
		});
		assertPositiveInteger(options.size, "WorkerPool size");
		assertPositiveInteger(
			options.maxConcurrentTasksPerWorker ?? 1,
			"maxConcurrentTasksPerWorker",
		);
		if (
			!Number.isSafeInteger(
				options.size * (options.maxConcurrentTasksPerWorker ?? 1),
			)
		) {
			throw new RangeError(
				"size * maxConcurrentTasksPerWorker must be a safe integer",
			);
		}
		if (options.maxTasksPerWorker !== undefined) {
			assertPositiveInteger(options.maxTasksPerWorker, "maxTasksPerWorker");
		}
		if (options.maxQueueSize !== undefined) {
			assertNonNegativeInteger(options.maxQueueSize, "maxQueueSize");
		}
		if (
			options.queueOverflowPolicy !== undefined &&
			options.queueOverflowPolicy !== "reject" &&
			options.queueOverflowPolicy !== "drop-oldest"
		) {
			throw new RangeError(
				'queueOverflowPolicy must be "reject" or "drop-oldest"',
			);
		}
		assertPositiveDuration(options.workerIdleTimeoutMs, "workerIdleTimeoutMs");
		assertPositiveDuration(options.maxWorkerLifetimeMs, "maxWorkerLifetimeMs");
		assertPositiveDuration(
			options.queueTimeoutMs === false ? undefined : options.queueTimeoutMs,
			"queueTimeoutMs",
		);
		assertPositiveDuration(
			options.taskTimeoutMs === false ? undefined : options.taskTimeoutMs,
			"taskTimeoutMs",
		);
		const terminationFailureWorkerBuffer =
			options.terminationFailureWorkerBuffer ??
			Math.max(2, Math.floor(options.size / 2));
		assertNonNegativeInteger(
			terminationFailureWorkerBuffer,
			"terminationFailureWorkerBuffer",
		);
		const terminationRetryAttempts =
			options.terminationRetryAttempts ?? DEFAULT_TERMINATION_RETRY_ATTEMPTS;
		assertNonNegativeInteger(
			terminationRetryAttempts,
			"terminationRetryAttempts",
		);
		assertPositiveDuration(
			options.terminationRetryDelayMs,
			"terminationRetryDelayMs",
		);
		assertPositiveDuration(
			options.terminationAttemptTimeoutMs,
			"terminationAttemptTimeoutMs",
		);
		if (!Number.isSafeInteger(options.size + terminationFailureWorkerBuffer)) {
			throw new RangeError(
				"size + terminationFailureWorkerBuffer must be a safe integer",
			);
		}

		this.size = options.size;
		this.onUpdate = options.onUpdateStats;
		this.onEvent = options.onEvent;
		this.proxyFactory = options.proxyFactory;
		this.workerFactory = options.workerFactory;
		this.workerIdleTimeoutMs = options.workerIdleTimeoutMs;
		this.maxTasksPerWorker = options.maxTasksPerWorker;
		this.maxWorkerLifetimeMs = options.maxWorkerLifetimeMs;
		this.maxConcurrentTasksPerWorker = options.maxConcurrentTasksPerWorker ?? 1;
		this.maxQueueSize = options.maxQueueSize ?? Number.POSITIVE_INFINITY;
		this.queueOverflowPolicy = options.queueOverflowPolicy ?? "reject";
		this.queueTimeoutMs =
			options.queueTimeoutMs === false ? undefined : options.queueTimeoutMs;
		this.taskTimeoutMs =
			options.taskTimeoutMs === false
				? undefined
				: (options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS);
		this.proxyCleanup = options.proxyCleanup;
		this.terminationFailureWorkerBuffer = terminationFailureWorkerBuffer;
		this.physicalWorkerLimit = options.size + terminationFailureWorkerBuffer;
		this.termination = new TerminationController({
			retryAttempts: terminationRetryAttempts,
			retryDelayMs:
				options.terminationRetryDelayMs ?? DEFAULT_TERMINATION_RETRY_DELAY_MS,
			attemptTimeoutMs:
				options.terminationAttemptTimeoutMs ??
				DEFAULT_TERMINATION_ATTEMPT_TIMEOUT_MS,
			workerTerminator: options.workerTerminator,
			onFailure: (error) => {
				this._emit({
					type: "worker-termination-failed",
					timestamp: Date.now(),
					workerId: error.workerId,
					attempt: error.attempt,
					exhausted: error.exhausted,
				});
				try {
					options.onWorkerTerminationError?.(error);
				} catch {
					// Failure observers are isolated from scheduler control flow.
				}
			},
			onStateChange: () => {
				this._next();
				this._updateStats();
			},
		});
		this._updateStats();
	}

	/** Returns a proxy API that schedules method calls on this pool. */
	public getApi(): TProxy {
		const handler: ProxyHandler<object> = {
			get: (_target, prop) => {
				// Prevent Promise/React thenable assimilation of the API proxy.
				if (prop === "then" || typeof prop !== "string") return undefined;
				return (...args: unknown[]) =>
					this._run({ method: prop, args } as TTask);
			},
		};
		return new Proxy(Object.create(null), handler) as TProxy;
	}

	/** Schedules one method call with explicit queueing and cancellation controls. */
	public run<K extends keyof TProxy>(
		method: K,
		args: Parameters<TProxy[K]>,
		options?: WorkerTaskOptions,
	): Promise<Awaited<ReturnType<TProxy[K]>>> {
		return this._run({ method, args } as unknown as TTask, options) as Promise<
			Awaited<ReturnType<TProxy[K]>>
		>;
	}

	/** Stops accepting work, finishes accepted calls, then shuts down all workers. */
	public drain(): Promise<WorkerPoolShutdownReport> {
		if (this.terminationStarted) return this.terminated;
		this.accepting = false;
		this.drainRequested = true;
		this._updateStats();
		return this.terminated;
	}

	/** Immediately closes the pool and awaits confirmed or exhausted cleanup. */
	public close(): Promise<WorkerPoolShutdownReport> {
		this.terminateAll();
		return this.terminated;
	}

	/** Permanently closes the pool, rejects work, and starts bounded worker termination. */
	public terminateAll(): void {
		if (this.terminationStarted) return;
		this.accepting = false;
		this.drainRequested = false;
		this.terminationStarted = true;
		const reason = new WorkerPoolTerminatedError();

		for (const item of this.queue.drain()) {
			this._settleTask(item, false, reason);
		}
		for (const worker of [...this.workers]) {
			for (const item of [...worker.activeTasks]) {
				this._settleTask(item, false, reason);
			}
			worker.activeTasks.clear();
			this._removeWorker(worker, true, "shutdown");
		}
		this._updateStats();
	}

	/** Returns a consistent snapshot of pool statistics. */
	public getStats(): WorkerPoolStats {
		const now = monotonicNow();
		const oldestQueuedAt = this.queue.oldestEnqueuedAt();
		const runningTasks = this.workers.reduce(
			(sum, worker) => sum + worker.activeTasks.size,
			0,
		);
		const availableForConcurrency = this.workers.filter(
			(worker) =>
				!worker.markedForTermination &&
				worker.activeTasks.size < this.maxConcurrentTasksPerWorker &&
				!this._hasExpired(worker),
		).length;
		const physicalWorkerCount = this.workers.length + this.termination.count;
		const uncreatedCapacity = this.terminationStarted
			? 0
			: Math.max(
					0,
					Math.min(
						this.size - this.workers.length,
						this.physicalWorkerLimit - physicalWorkerCount,
					),
				);

		return {
			state: this.terminationStarted
				? "closed"
				: this.drainRequested
					? "draining"
					: "running",
			size: this.size,
			maxConcurrentTasks: this.size * this.maxConcurrentTasksPerWorker,
			available: availableForConcurrency + uncreatedCapacity,
			queue: this.queue.length,
			queueCapacity: Number.isFinite(this.maxQueueSize)
				? this.maxQueueSize
				: null,
			queueCapacityRemaining: Number.isFinite(this.maxQueueSize)
				? Math.max(0, this.maxQueueSize - this.queue.length)
				: null,
			oldestQueuedTaskAgeMs:
				oldestQueuedAt === null ? null : Math.max(0, now - oldestQueuedAt),
			workers: physicalWorkerCount,
			healthyWorkers: this.workers.length,
			quarantinedWorkers: this.termination.count,
			terminationFailureWorkerBuffer: this.terminationFailureWorkerBuffer,
			terminationFailures: this.termination.failures,
			idleWorkers: this.workers.filter(
				(worker) => worker.activeTasks.size === 0,
			).length,
			runningTasks,
			availableForConcurrency,
			submittedTasks: this.submittedTasks,
			startedTasks: this.startedTasks,
			completedTasks: this.completedTasks,
			failedTasks: this.failedTasks,
			cancelledTasks: this.cancelledTasks,
			timedOutTasks: this.timedOutTasks,
			droppedTasks: this.droppedTasks,
		};
	}

	private _run(task: TTask, options: WorkerTaskOptions = {}): Promise<TResult> {
		if (!this.accepting) {
			return Promise.reject(
				new WorkerPoolTerminatedError(
					this.drainRequested
						? "Worker pool is draining"
						: "Worker pool has been terminated",
				),
			);
		}
		const priority = options.priority ?? 0;
		if (!Number.isFinite(priority)) {
			return Promise.reject(new RangeError("priority must be a finite number"));
		}
		const queueTimeoutMs =
			options.queueTimeoutMs === false
				? undefined
				: (options.queueTimeoutMs ?? this.queueTimeoutMs);
		try {
			assertPositiveDuration(queueTimeoutMs, "queueTimeoutMs");
		} catch (error) {
			return Promise.reject(error);
		}
		if (options.signal?.aborted) {
			return Promise.reject(new WorkerTaskAbortedError(options.signal.reason));
		}

		return new Promise<TResult>((resolve, reject) => {
			const enqueuedAt = monotonicNow();
			const item: ScheduledTask<TTask, TResult> = {
				task,
				resolve,
				reject,
				settled: false,
				priority,
				sequence: this.nextTaskSequence++,
				enqueuedAt,
				signal: options.signal,
			};
			this.submittedTasks++;
			if (item.signal) {
				item.abortHandler = () => this._abortTask(item);
				item.signal.addEventListener("abort", item.abortHandler, {
					once: true,
				});
				if (item.signal.aborted) {
					this._abortTask(item);
					return;
				}
			}
			this._insertQueuedTask(item);
			this._emit({
				type: "task-queued",
				timestamp: Date.now(),
				taskId: item.sequence,
				method: String(item.task.method),
				priority: item.priority,
			});
			this._startQueueTimer(item, queueTimeoutMs);
			this._next();
			this._enforceQueueLimit(item);
			this._updateStats();
		});
	}

	private _insertQueuedTask(item: ScheduledTask<TTask, TResult>): void {
		this.queue.insert(item);
	}

	private _enforceQueueLimit(submitted: ScheduledTask<TTask, TResult>): void {
		for (const { task: rejected, dropped } of this.queue.enforceLimit(
			submitted,
			this.maxQueueSize,
			this.queueOverflowPolicy,
		)) {
			this._settleTask(
				rejected,
				false,
				new WorkerPoolQueueFullError(this.maxQueueSize, dropped),
			);
		}
	}

	private _abortTask(item: ScheduledTask<TTask, TResult>): void {
		if (item.settled) return;
		this.queue.remove(item);
		const isRunning = this.workers.some((worker) =>
			worker.activeTasks.has(item),
		);
		this._settleTask(
			item,
			false,
			new WorkerTaskAbortedError(item.signal?.reason),
			isRunning,
		);
		this._updateStats();
	}

	private _startQueueTimer(
		item: ScheduledTask<TTask, TResult>,
		timeoutMs: number | undefined,
	): void {
		if (timeoutMs === undefined) return;
		const deadline = monotonicNow() + timeoutMs;
		const schedule = () => {
			if (!this.queue.contains(item)) return;
			const remaining = deadline - monotonicNow();
			if (remaining > 0) {
				item.queueTimeout = setTimeout(
					schedule,
					Math.min(remaining, MAX_TIMER_DELAY_MS),
				);
				return;
			}
			item.queueTimeout = undefined;
			this.queue.remove(item);
			this._settleTask(item, false, new WorkerQueueTimeoutError(timeoutMs));
			this._updateStats();
		};
		item.queueTimeout = setTimeout(
			schedule,
			Math.min(timeoutMs, MAX_TIMER_DELAY_MS),
		);
	}

	private _next(): void {
		if (this.scheduling || this.terminationStarted) return;
		this.scheduling = true;

		try {
			while (this.queue.length > 0 && !this.terminationStarted) {
				let worker: WorkerMetadata<TProxy, TTask, TResult> | null;
				try {
					worker = this._getAvailableWorker();
				} catch (error) {
					// A broken factory affects the current backlog, but later submissions
					// may retry after the client fixes a transient resource problem.
					for (const item of this.queue.drain()) {
						this._settleTask(item, false, error);
					}
					break;
				}
				if (!worker) break;

				const item = this.queue.shift();
				if (!item) break;
				this._dispatch(worker, item);
			}
			this._rejectQueueIfPermanentlyExhausted();
		} finally {
			this.scheduling = false;
		}
	}

	private _getAvailableWorker(): WorkerMetadata<TProxy, TTask, TResult> | null {
		let leastLoaded: WorkerMetadata<TProxy, TTask, TResult> | null = null;
		for (const worker of [...this.workers]) {
			if (this._hasExpired(worker)) {
				worker.markedForTermination = true;
				worker.retirementReason = "lifetime";
				if (worker.activeTasks.size === 0) {
					this._removeWorker(worker, false, "lifetime");
				}
				continue;
			}
			if (
				!worker.markedForTermination &&
				worker.activeTasks.size < this.maxConcurrentTasksPerWorker &&
				(leastLoaded === null ||
					worker.activeTasks.size < leastLoaded.activeTasks.size)
			) {
				leastLoaded = worker;
			}
		}

		const physicalWorkerCount = this.workers.length + this.termination.count;
		const canCreate =
			this.workers.length < this.size &&
			physicalWorkerCount < this.physicalWorkerLimit;
		if (!canCreate || leastLoaded?.activeTasks.size === 0) {
			return leastLoaded;
		}

		let worker: WorkerMetadata<TProxy, TTask, TResult>;
		try {
			worker = this._createWorker();
		} catch (error) {
			if (
				leastLoaded &&
				this._containsWorker(leastLoaded) &&
				!leastLoaded.markedForTermination &&
				leastLoaded.activeTasks.size < this.maxConcurrentTasksPerWorker
			) {
				return leastLoaded;
			}
			throw error;
		}
		this.workers.push(worker);
		this._emit({
			type: "worker-created",
			timestamp: Date.now(),
			workerId: worker.id,
		});
		if (this.terminationStarted) {
			this._removeWorker(worker, true, "shutdown");
			return null;
		}
		this._startLifetimeTimer(worker);
		return worker;
	}

	private _createWorker(): WorkerMetadata<TProxy, TTask, TResult> {
		const worker = this.workerFactory();
		if (
			(typeof worker !== "object" && typeof worker !== "function") ||
			!worker
		) {
			throw new TypeError("workerFactory must return a Worker object");
		}
		if (this.knownWorkers.has(worker)) {
			throw new Error("workerFactory must return a fresh Worker instance");
		}
		this.knownWorkers.add(worker);

		let proxy: TProxy;
		try {
			proxy = this.proxyFactory(worker);
		} catch (error) {
			const termination = this.termination.quarantine(worker);
			this.termination.attempt(termination);
			throw error;
		}

		const id = this.nextWorkerId++;
		const metadata = {
			id,
			proxy,
			worker,
			taskCount: 0,
			createdAt: monotonicNow(),
			activeTasks: new Set<ScheduledTask<TTask, TResult>>(),
			markedForTermination: false,
			failureHandler: (event: Event) => {
				const cause =
					typeof ErrorEvent !== "undefined" &&
					event instanceof ErrorEvent &&
					event.error !== undefined
						? event.error
						: event;
				this._handleWorkerFailure(
					metadata,
					new WorkerCrashedError(metadata.id, cause),
				);
			},
			failureEventTypes: [] as string[],
		} satisfies WorkerMetadata<TProxy, TTask, TResult>;

		try {
			for (const type of ["error", "messageerror", "close"]) {
				worker.addEventListener(type, metadata.failureHandler);
				metadata.failureEventTypes.push(type);
			}
		} catch (error) {
			const termination = this.termination.quarantine(worker, id);
			this._removeFailureListeners(metadata);
			this._cleanupProxy(proxy);
			this.termination.attempt(termination);
			throw error;
		}
		return metadata;
	}

	private _dispatch(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
		item: ScheduledTask<TTask, TResult>,
	): void {
		if (item.queueTimeout !== undefined) clearTimeout(item.queueTimeout);
		item.queueTimeout = undefined;
		this._clearIdleTimer(worker);
		worker.activeTasks.add(item);
		worker.taskCount++;
		item.startedAt = monotonicNow();
		item.workerId = worker.id;
		this.startedTasks++;
		if (
			this.maxTasksPerWorker !== undefined &&
			worker.taskCount >= this.maxTasksPerWorker
		) {
			worker.markedForTermination = true;
			worker.retirementReason = "max-tasks";
		}

		if (this.taskTimeoutMs !== undefined) {
			this._startTaskTimer(worker, item);
		}

		void Promise.resolve()
			.then(() => {
				const method = worker.proxy[item.task.method];
				if (typeof method !== "function") {
					throw new TypeError(
						`Worker proxy method ${String(item.task.method)} is not a function`,
					);
				}
				return method(...item.task.args);
			})
			.then(
				(result) => this._completeTask(worker, item, true, result as TResult),
				(error) => this._completeTask(worker, item, false, error),
			);
		this._emit({
			type: "task-started",
			timestamp: Date.now(),
			taskId: item.sequence,
			method: String(item.task.method),
			workerId: worker.id,
			queueWaitMs: Math.max(0, item.startedAt - item.enqueuedAt),
		});
	}

	private _completeTask(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
		item: ScheduledTask<TTask, TResult>,
		succeeded: boolean,
		value: unknown,
	): void {
		if (!worker.activeTasks.delete(item)) return;
		this._settleTask(item, succeeded, value);

		if (!this._containsWorker(worker) || this.terminationStarted) return;
		if (worker.activeTasks.size === 0) {
			if (worker.markedForTermination || this._hasExpired(worker)) {
				this._removeWorker(
					worker,
					false,
					worker.retirementReason ?? "lifetime",
				);
			} else {
				this._startIdleTimer(worker);
			}
		}
		this._next();
		this._updateStats();
	}

	private _handleWorkerFailure(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
		reason: unknown,
	): void {
		if (!this._containsWorker(worker)) return;
		for (const item of [...worker.activeTasks]) {
			this._settleTask(item, false, reason);
		}
		worker.activeTasks.clear();
		this._removeWorker(
			worker,
			true,
			reason instanceof WorkerTaskTimeoutError ? "task-timeout" : "failure",
		);
		this._next();
		this._updateStats();
	}

	private _settleTask(
		item: ScheduledTask<TTask, TResult>,
		succeeded: boolean,
		value: unknown,
		preserveTaskTimer = false,
	): void {
		if (item.queueTimeout !== undefined) clearTimeout(item.queueTimeout);
		item.queueTimeout = undefined;
		if (!preserveTaskTimer) {
			if (item.timeout !== undefined) clearTimeout(item.timeout);
			item.timeout = undefined;
		}
		if (item.abortHandler && item.signal) {
			item.signal.removeEventListener("abort", item.abortHandler);
			item.abortHandler = undefined;
		}
		if (item.settled) return;
		item.settled = true;
		const outcome = this._classifyTaskOutcome(succeeded, value);
		switch (outcome) {
			case "fulfilled":
				this.completedTasks++;
				break;
			case "aborted":
				this.cancelledTasks++;
				break;
			case "queue-timeout":
			case "task-timeout":
				this.timedOutTasks++;
				break;
			case "dropped":
				this.droppedTasks++;
				break;
			default:
				this.failedTasks++;
		}
		if (succeeded) item.resolve(value as TResult);
		else item.reject(value);
		this._emit({
			type: "task-settled",
			timestamp: Date.now(),
			taskId: item.sequence,
			method: String(item.task.method),
			workerId: item.workerId,
			outcome,
			durationMs: Math.max(
				0,
				monotonicNow() - (item.startedAt ?? item.enqueuedAt),
			),
		});
	}

	private _classifyTaskOutcome(
		succeeded: boolean,
		value: unknown,
	): WorkerPoolTaskOutcome {
		if (succeeded) return "fulfilled";
		if (value instanceof WorkerTaskAbortedError) return "aborted";
		if (value instanceof WorkerQueueTimeoutError) return "queue-timeout";
		if (value instanceof WorkerTaskTimeoutError) return "task-timeout";
		if (value instanceof WorkerPoolQueueFullError) {
			return value.dropped ? "dropped" : "queue-rejected";
		}
		if (value instanceof WorkerCrashedError) return "worker-failure";
		if (value instanceof WorkerPoolTerminatedError) return "pool-closed";
		return "rejected";
	}

	private _startTaskTimer(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
		item: ScheduledTask<TTask, TResult>,
	): void {
		const timeoutMs = this.taskTimeoutMs;
		if (timeoutMs === undefined) return;
		const deadline = monotonicNow() + timeoutMs;
		const schedule = () => {
			if (!worker.activeTasks.has(item)) return;
			const remaining = deadline - monotonicNow();
			if (remaining > 0) {
				item.timeout = setTimeout(
					schedule,
					Math.min(remaining, MAX_TIMER_DELAY_MS),
				);
				return;
			}
			item.timeout = undefined;
			this._handleWorkerFailure(worker, new WorkerTaskTimeoutError(timeoutMs));
		};
		item.timeout = setTimeout(
			schedule,
			Math.min(timeoutMs, MAX_TIMER_DELAY_MS),
		);
	}

	private _hasExpired(worker: WorkerMetadata<TProxy, TTask, TResult>): boolean {
		return (
			this.maxWorkerLifetimeMs !== undefined &&
			monotonicNow() - worker.createdAt >= this.maxWorkerLifetimeMs
		);
	}

	private _startLifetimeTimer(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
	): void {
		if (this.maxWorkerLifetimeMs === undefined) return;
		const schedule = () => {
			if (!this._containsWorker(worker) || this.terminationStarted) return;
			const remaining =
				(this.maxWorkerLifetimeMs as number) -
				(monotonicNow() - worker.createdAt);
			if (remaining > 0) {
				worker.lifetimeTimer = setTimeout(
					schedule,
					Math.min(remaining, MAX_TIMER_DELAY_MS),
				);
				return;
			}
			worker.lifetimeTimer = undefined;
			worker.markedForTermination = true;
			worker.retirementReason = "lifetime";
			if (worker.activeTasks.size === 0) {
				this._removeWorker(worker, false, "lifetime");
			}
			this._next();
			this._updateStats();
		};
		worker.lifetimeTimer = setTimeout(
			schedule,
			Math.min(this.maxWorkerLifetimeMs, MAX_TIMER_DELAY_MS),
		);
	}

	private _startIdleTimer(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
	): void {
		if (this.workerIdleTimeoutMs === undefined) return;
		this._clearIdleTimer(worker);
		worker.idleDeadline = monotonicNow() + this.workerIdleTimeoutMs;

		const schedule = () => {
			if (
				!this._containsWorker(worker) ||
				worker.activeTasks.size > 0 ||
				this.terminationStarted
			) {
				return;
			}
			const remaining = (worker.idleDeadline as number) - monotonicNow();
			if (remaining > 0) {
				worker.idleTimer = setTimeout(
					schedule,
					Math.min(remaining, MAX_TIMER_DELAY_MS),
				);
				return;
			}
			worker.idleTimer = undefined;
			worker.idleDeadline = undefined;
			this._removeWorker(worker, false, "idle");
			this._next();
			this._updateStats();
		};
		worker.idleTimer = setTimeout(
			schedule,
			Math.min(this.workerIdleTimeoutMs, MAX_TIMER_DELAY_MS),
		);
	}

	private _clearIdleTimer(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
	): void {
		if (worker.idleTimer !== undefined) clearTimeout(worker.idleTimer);
		worker.idleTimer = undefined;
		worker.idleDeadline = undefined;
	}

	private _removeWorker(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
		force: boolean,
		reason: WorkerPoolWorkerRemovalReason,
	): void {
		const index = this.workers.findIndex((candidate) => candidate === worker);
		if (index === -1 || (!force && worker.activeTasks.size > 0)) return;

		this.workers.splice(index, 1);
		const termination = this.termination.quarantine(worker.worker, worker.id);
		this._clearIdleTimer(worker);
		if (worker.lifetimeTimer !== undefined) clearTimeout(worker.lifetimeTimer);
		worker.lifetimeTimer = undefined;
		this._removeFailureListeners(worker);
		this._cleanupProxy(worker.proxy);
		this._emit({
			type: "worker-removed",
			timestamp: Date.now(),
			workerId: worker.id,
			reason,
		});
		this.termination.attempt(termination);
	}

	private _containsWorker(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
	): boolean {
		return this.workers.some((candidate) => candidate === worker);
	}

	private _removeFailureListeners(
		worker: WorkerMetadata<TProxy, TTask, TResult>,
	): void {
		for (const type of worker.failureEventTypes.splice(0)) {
			try {
				worker.worker.removeEventListener(type, worker.failureHandler);
			} catch {
				// Continue removing the remaining listeners independently.
			}
		}
	}

	private _cleanupProxy(proxy: TProxy): void {
		try {
			if (this.proxyCleanup) {
				this.proxyCleanup(proxy);
				return;
			}
			const releasable = proxy as TProxy & {
				[releaseProxy]?: () => void;
			};
			releasable[releaseProxy]?.();
		} catch {
			// Cleanup must not strand queued work or other workers.
		}
	}

	private _rejectQueueIfPermanentlyExhausted(): void {
		if (
			this.terminationStarted ||
			this.queue.length === 0 ||
			this.workers.length > 0 ||
			this.workers.length + this.termination.count < this.physicalWorkerLimit ||
			this.termination.hasRetryableWorker()
		) {
			return;
		}

		const error = new WorkerPoolCapacityError(
			this.physicalWorkerLimit,
			this.termination.count,
		);
		for (const item of this.queue.drain()) {
			this._settleTask(item, false, error);
		}
	}

	private _updateStats(): void {
		if (
			this.drainRequested &&
			!this.terminationStarted &&
			this.queue.length === 0 &&
			this.workers.every((worker) => worker.activeTasks.size === 0)
		) {
			this.terminateAll();
			return;
		}
		if (
			this.terminationStarted &&
			!this.shutdownResolved &&
			this.workers.length === 0 &&
			this.termination.allExhausted()
		) {
			this.shutdownResolved = true;
			this.resolveTerminated({
				confirmed: this.termination.count === 0,
				unconfirmedWorkers: this.termination.count,
				terminationFailures: this.termination.failures,
			});
		}
		if (!this.onUpdate) return;
		try {
			this.onUpdate(this.getStats());
		} catch {
			// Observers are isolated from scheduler control flow by design.
		}
	}

	private _emit(event: WorkerPoolEvent): void {
		try {
			this.onEvent?.(event);
		} catch {
			// Event observers are isolated from scheduler control flow by design.
		}
	}
}
