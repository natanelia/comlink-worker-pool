import { releaseProxy } from "comlink";

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

/** Statistics describing the current state of a worker pool. */
export interface WorkerPoolStats {
	/** Configured maximum number of scheduler-managed, non-quarantined workers. */
	size: number;
	/** Number of existing or not-yet-created workers that can accept work. */
	available: number;
	/** Number of tasks waiting for a worker. */
	queue: number;
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

/** Error returned when work is submitted to, or interrupted by, a closed pool. */
export class WorkerPoolTerminatedError extends Error {
	constructor(message = "Worker pool has been terminated") {
		super(message);
		this.name = "WorkerPoolTerminatedError";
	}
}

/** Error returned for tasks interrupted by a worker failure. */
export class WorkerCrashedError extends Error {
	readonly workerId: number;

	constructor(workerId: number, cause?: unknown) {
		const detail =
			cause instanceof Error && cause.message ? `: ${cause.message}` : "";
		super(`Worker ${workerId} failed${detail}`, { cause });
		this.name = "WorkerCrashedError";
		this.workerId = workerId;
	}
}

/** Error returned when a task exceeds taskTimeoutMs. */
export class WorkerTaskTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`Worker task timed out after ${timeoutMs}ms`);
		this.name = "WorkerTaskTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

/** Error reported when a worker termination attempt fails or times out. */
export class WorkerTerminationError extends Error {
	readonly workerId: number | undefined;
	readonly attempt: number;
	readonly exhausted: boolean;

	constructor(
		workerId: number | undefined,
		attempt: number,
		exhausted: boolean,
		cause?: unknown,
	) {
		const workerLabel =
			workerId === undefined ? "unregistered worker" : `worker ${workerId}`;
		const detail =
			cause instanceof Error && cause.message ? `: ${cause.message}` : "";
		super(`Failed to terminate ${workerLabel} on attempt ${attempt}${detail}`, {
			cause,
		});
		this.name = "WorkerTerminationError";
		this.workerId = workerId;
		this.attempt = attempt;
		this.exhausted = exhausted;
	}
}

/** Error returned when quarantined workers consume all physical capacity. */
export class WorkerPoolCapacityError extends Error {
	readonly physicalWorkerLimit: number;
	readonly quarantinedWorkers: number;

	constructor(physicalWorkerLimit: number, quarantinedWorkers: number) {
		super(
			`Worker pool cannot create a healthy worker: all ${physicalWorkerLimit} physical slots are occupied, including ${quarantinedWorkers} workers with unconfirmed termination`,
		);
		this.name = "WorkerPoolCapacityError";
		this.physicalWorkerLimit = physicalWorkerLimit;
		this.quarantinedWorkers = quarantinedWorkers;
	}
}

/** Error returned when a task cannot enter a full queue or is evicted from it. */
export class WorkerPoolQueueFullError extends Error {
	readonly maxQueueSize: number;
	readonly dropped: boolean;

	constructor(maxQueueSize: number, dropped = false) {
		super(
			dropped
				? `Worker task was dropped because the queue limit of ${maxQueueSize} was reached`
				: `Worker pool queue limit of ${maxQueueSize} was reached`,
		);
		this.name = "WorkerPoolQueueFullError";
		this.maxQueueSize = maxQueueSize;
		this.dropped = dropped;
	}
}

/** Error returned when a task waits in the queue beyond its deadline. */
export class WorkerQueueTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`Worker task queue wait timed out after ${timeoutMs}ms`);
		this.name = "WorkerQueueTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

/** Error returned when an AbortSignal cancels a scheduled task. */
export class WorkerTaskAbortedError extends Error {
	constructor(cause?: unknown) {
		super("Worker task was aborted", { cause });
		this.name = "WorkerTaskAbortedError";
	}
}

interface ScheduledTask<TTask, TResult> extends Task<TTask, TResult> {
	settled: boolean;
	priority: number;
	sequence: number;
	signal?: AbortSignal;
	abortHandler?: () => void;
	queueTimeout?: ReturnType<typeof setTimeout>;
	timeout?: ReturnType<typeof setTimeout>;
}

interface WorkerMetadata<TProxy, TTask, TResult> {
	id: number;
	proxy: TProxy;
	worker: Worker;
	taskCount: number;
	createdAt: number;
	activeTasks: Set<ScheduledTask<TTask, TResult>>;
	markedForTermination: boolean;
	idleTimer?: ReturnType<typeof setTimeout>;
	idleDeadline?: number;
	lifetimeTimer?: ReturnType<typeof setTimeout>;
	failureHandler: (event: Event) => void;
	failureEventTypes: string[];
}

interface TerminationRecord {
	worker: Worker;
	workerId: number | undefined;
	attempts: number;
	exhausted: boolean;
	retryTimer?: ReturnType<typeof setTimeout>;
	attemptTimers: Set<ReturnType<typeof setTimeout>>;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TERMINATION_RETRY_ATTEMPTS = 3;
const DEFAULT_TERMINATION_RETRY_DELAY_MS = 100;
const DEFAULT_TERMINATION_ATTEMPT_TIMEOUT_MS = 5_000;

function monotonicNow(): number {
	return typeof globalThis.performance?.now === "function"
		? globalThis.performance.now()
		: Date.now();
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be at least 1 and a safe integer`);
	}
}

function assertNonNegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer`);
	}
}

function assertPositiveDuration(value: number | undefined, name: string): void {
	if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
		throw new RangeError(`${name} must be a positive finite number`);
	}
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
	private readonly terminationRetryAttempts: number;
	private readonly terminationRetryDelayMs: number;
	private readonly terminationAttemptTimeoutMs: number;
	private readonly workerTerminator?: WorkerTerminator;
	private readonly onWorkerTerminationError?: (
		error: WorkerTerminationError,
	) => void;

	private workers: WorkerMetadata<TProxy, TTask, TResult>[] = [];
	private queue: ScheduledTask<TTask, TResult>[] = [];
	private readonly quarantinedWorkers = new Map<Worker, TerminationRecord>();
	private nextWorkerId = 0;
	private nextTaskSequence = 0;
	private accepting = true;
	private drainRequested = false;
	private terminationStarted = false;
	private scheduling = false;
	private shutdownResolved = false;
	private terminationFailures = 0;
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
		this.terminationRetryAttempts = terminationRetryAttempts;
		this.terminationRetryDelayMs =
			options.terminationRetryDelayMs ?? DEFAULT_TERMINATION_RETRY_DELAY_MS;
		this.terminationAttemptTimeoutMs =
			options.terminationAttemptTimeoutMs ??
			DEFAULT_TERMINATION_ATTEMPT_TIMEOUT_MS;
		this.workerTerminator = options.workerTerminator;
		this.onWorkerTerminationError = options.onWorkerTerminationError;
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

		for (const item of this.queue.splice(0)) {
			this._settleTask(item, false, reason);
		}
		for (const worker of [...this.workers]) {
			for (const item of [...worker.activeTasks]) {
				this._settleTask(item, false, reason);
			}
			worker.activeTasks.clear();
			this._removeWorker(worker, true);
		}
		this._updateStats();
	}

	/** Returns a consistent snapshot of pool statistics. */
	public getStats(): WorkerPoolStats {
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
		const physicalWorkerCount =
			this.workers.length + this.quarantinedWorkers.size;
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
			size: this.size,
			available: availableForConcurrency + uncreatedCapacity,
			queue: this.queue.length,
			workers: physicalWorkerCount,
			healthyWorkers: this.workers.length,
			quarantinedWorkers: this.quarantinedWorkers.size,
			terminationFailureWorkerBuffer: this.terminationFailureWorkerBuffer,
			terminationFailures: this.terminationFailures,
			idleWorkers: this.workers.filter(
				(worker) => worker.activeTasks.size === 0,
			).length,
			runningTasks,
			availableForConcurrency,
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
			const item: ScheduledTask<TTask, TResult> = {
				task,
				resolve,
				reject,
				settled: false,
				priority,
				sequence: this.nextTaskSequence++,
				signal: options.signal,
			};
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
			this._startQueueTimer(item, queueTimeoutMs);
			this._next();
			this._enforceQueueLimit(item);
			this._updateStats();
		});
	}

	private _insertQueuedTask(item: ScheduledTask<TTask, TResult>): void {
		const index = this.queue.findIndex(
			(candidate) => candidate.priority < item.priority,
		);
		if (index === -1) this.queue.push(item);
		else this.queue.splice(index, 0, item);
	}

	private _enforceQueueLimit(submitted: ScheduledTask<TTask, TResult>): void {
		while (this.queue.length > this.maxQueueSize) {
			let rejected = submitted;
			let dropped = false;
			if (
				this.queue.indexOf(submitted) === -1 ||
				this.queueOverflowPolicy === "drop-oldest"
			) {
				rejected = this.queue.reduce((oldest, candidate) =>
					candidate.sequence < oldest.sequence ? candidate : oldest,
				);
				dropped = this.queueOverflowPolicy === "drop-oldest";
			}
			const index = this.queue.indexOf(rejected);
			if (index === -1) break;
			this.queue.splice(index, 1);
			this._settleTask(
				rejected,
				false,
				new WorkerPoolQueueFullError(this.maxQueueSize, dropped),
			);
		}
	}

	private _abortTask(item: ScheduledTask<TTask, TResult>): void {
		if (item.settled) return;
		const index = this.queue.indexOf(item);
		if (index !== -1) this.queue.splice(index, 1);
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
			const index = this.queue.indexOf(item);
			if (index === -1) return;
			const remaining = deadline - monotonicNow();
			if (remaining > 0) {
				item.queueTimeout = setTimeout(
					schedule,
					Math.min(remaining, MAX_TIMER_DELAY_MS),
				);
				return;
			}
			item.queueTimeout = undefined;
			this.queue.splice(index, 1);
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
					for (const item of this.queue.splice(0)) {
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
				if (worker.activeTasks.size === 0) this._removeWorker(worker, false);
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

		const physicalWorkerCount =
			this.workers.length + this.quarantinedWorkers.size;
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
		if (this.terminationStarted) {
			this._removeWorker(worker, true);
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
			const termination = this._quarantineWorker(worker);
			this._attemptTermination(termination);
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
			const termination = this._quarantineWorker(worker, id);
			this._removeFailureListeners(metadata);
			this._cleanupProxy(proxy);
			this._attemptTermination(termination);
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
		if (
			this.maxTasksPerWorker !== undefined &&
			worker.taskCount >= this.maxTasksPerWorker
		) {
			worker.markedForTermination = true;
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
				this._removeWorker(worker, false);
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
		this._removeWorker(worker, true);
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
		if (succeeded) item.resolve(value as TResult);
		else item.reject(value);
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
			if (worker.activeTasks.size === 0) this._removeWorker(worker, false);
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
			this._removeWorker(worker, false);
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
	): void {
		const index = this.workers.findIndex((candidate) => candidate === worker);
		if (index === -1 || (!force && worker.activeTasks.size > 0)) return;

		this.workers.splice(index, 1);
		const termination = this._quarantineWorker(worker.worker, worker.id);
		this._clearIdleTimer(worker);
		if (worker.lifetimeTimer !== undefined) clearTimeout(worker.lifetimeTimer);
		worker.lifetimeTimer = undefined;
		this._removeFailureListeners(worker);
		this._cleanupProxy(worker.proxy);
		this._attemptTermination(termination);
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

	private _quarantineWorker(
		worker: Worker,
		workerId?: number,
	): TerminationRecord {
		const existing = this.quarantinedWorkers.get(worker);
		if (existing) return existing;

		const record: TerminationRecord = {
			worker,
			workerId,
			attempts: 0,
			exhausted: false,
			attemptTimers: new Set(),
		};
		this.quarantinedWorkers.set(worker, record);
		return record;
	}

	private _attemptTermination(record: TerminationRecord): void {
		if (this.quarantinedWorkers.get(record.worker) !== record) return;
		record.retryTimer = undefined;
		record.exhausted = false;
		record.attempts++;

		let result: ReturnType<WorkerTerminator>;
		try {
			result = this.workerTerminator
				? this.workerTerminator(record.worker)
				: record.worker.terminate();
		} catch (error) {
			this._recordTerminationFailure(record, error);
			return;
		}

		let then: unknown;
		try {
			then =
				result !== null &&
				(typeof result === "object" || typeof result === "function")
					? (result as PromiseLike<unknown>).then
					: undefined;
		} catch (error) {
			this._recordTerminationFailure(record, error);
			return;
		}

		if (typeof then !== "function") {
			this._confirmTermination(record);
			return;
		}

		let attemptFinished = false;
		const deadline = monotonicNow() + this.terminationAttemptTimeoutMs;
		let timeout!: ReturnType<typeof setTimeout>;
		const handleTimeout = () => {
			record.attemptTimers.delete(timeout);
			if (attemptFinished) return;
			const remaining = deadline - monotonicNow();
			if (remaining > 0) {
				timeout = setTimeout(
					handleTimeout,
					Math.min(remaining, MAX_TIMER_DELAY_MS),
				);
				record.attemptTimers.add(timeout);
				return;
			}
			attemptFinished = true;
			this._recordTerminationFailure(
				record,
				new Error(
					`Termination attempt timed out after ${this.terminationAttemptTimeoutMs}ms`,
				),
			);
		};
		timeout = setTimeout(
			handleTimeout,
			Math.min(this.terminationAttemptTimeoutMs, MAX_TIMER_DELAY_MS),
		);
		record.attemptTimers.add(timeout);

		const terminationPromise = new Promise<unknown>((resolve, reject) => {
			Reflect.apply(then, result, [resolve, reject]);
		});
		void terminationPromise.then(
			() => {
				clearTimeout(timeout);
				record.attemptTimers.delete(timeout);
				if (attemptFinished) {
					// A late success is still valid confirmation that the worker is gone.
					this._confirmTermination(record);
					return;
				}
				attemptFinished = true;
				this._confirmTermination(record);
			},
			(error) => {
				clearTimeout(timeout);
				record.attemptTimers.delete(timeout);
				if (attemptFinished) return;
				attemptFinished = true;
				this._recordTerminationFailure(record, error);
			},
		);
	}

	private _confirmTermination(record: TerminationRecord): void {
		if (this.quarantinedWorkers.get(record.worker) !== record) return;
		if (record.retryTimer !== undefined) clearTimeout(record.retryTimer);
		for (const timer of record.attemptTimers) clearTimeout(timer);
		record.attemptTimers.clear();
		this.quarantinedWorkers.delete(record.worker);
		this._next();
		this._updateStats();
	}

	private _recordTerminationFailure(
		record: TerminationRecord,
		cause: unknown,
	): void {
		if (this.quarantinedWorkers.get(record.worker) !== record) return;
		this.terminationFailures++;
		const exhausted = record.attempts > this.terminationRetryAttempts;
		record.exhausted = exhausted;
		const error = new WorkerTerminationError(
			record.workerId,
			record.attempts,
			exhausted,
			cause,
		);
		try {
			this.onWorkerTerminationError?.(error);
		} catch {
			// Failure observers are isolated from scheduler control flow.
		}

		if (!exhausted) {
			const exponent = Math.min(record.attempts - 1, 30);
			const retryDelay = Math.min(
				this.terminationRetryDelayMs * 2 ** exponent,
				MAX_TIMER_DELAY_MS,
			);
			record.retryTimer = setTimeout(
				() => this._attemptTermination(record),
				retryDelay,
			);
		}

		this._next();
		this._updateStats();
	}

	private _rejectQueueIfPermanentlyExhausted(): void {
		if (
			this.terminationStarted ||
			this.queue.length === 0 ||
			this.workers.length > 0 ||
			this.workers.length + this.quarantinedWorkers.size <
				this.physicalWorkerLimit ||
			[...this.quarantinedWorkers.values()].some((record) => !record.exhausted)
		) {
			return;
		}

		const error = new WorkerPoolCapacityError(
			this.physicalWorkerLimit,
			this.quarantinedWorkers.size,
		);
		for (const item of this.queue.splice(0)) {
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
			[...this.quarantinedWorkers.values()].every((record) => record.exhausted)
		) {
			this.shutdownResolved = true;
			this.resolveTerminated({
				confirmed: this.quarantinedWorkers.size === 0,
				unconfirmedWorkers: this.quarantinedWorkers.size,
				terminationFailures: this.terminationFailures,
			});
		}
		if (!this.onUpdate) return;
		try {
			this.onUpdate(this.getStats());
		} catch {
			// Observers are isolated from scheduler control flow by design.
		}
	}
}
