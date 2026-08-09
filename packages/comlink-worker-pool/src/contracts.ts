import type { WorkerTerminationError } from "./errors";
import type { WorkerFactory, WorkerHandle, WorkerTerminator } from "./worker";

/** Receives an observable value; returned thenables are consumed without being awaited. */
// biome-ignore lint/suspicious/noConfusingVoidType: synchronous observers naturally return void.
export type WorkerPoolObserver<T> = (value: T) => void | PromiseLike<unknown>;

export type CallableProxy<TProxy> = {
	// biome-ignore lint/suspicious/noExplicitAny: worker APIs may have arbitrary signatures
	[K in keyof TProxy]: (...args: any[]) => unknown;
};

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

/** Options shared by dedicated-worker and SharedWorker pools. */
interface WorkerPoolCommonOptions<TProxy extends CallableProxy<TProxy>> {
	/** Maximum number of scheduler-managed, non-quarantined workers. */
	size: number;
	/** Optional callback for pool statistics. Observer errors do not break the pool. */
	onUpdateStats?: WorkerPoolObserver<WorkerPoolStats>;
	/** Receives structured task and worker events. Observer errors are isolated. */
	onEvent?: WorkerPoolObserver<WorkerPoolEvent>;
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
	/** Absolute deadline for each asynchronous termination attempt. Defaults to 5 seconds. */
	terminationAttemptTimeoutMs?: number;
	/** Receives isolated termination-attempt failures. */
	onWorkerTerminationError?: WorkerPoolObserver<WorkerTerminationError>;
}

interface WorkerPoolEndpointOptions<
	TProxy extends CallableProxy<TProxy>,
	TWorker extends WorkerHandle,
> {
	/** Creates a fresh worker whose lifecycle is owned by the pool. */
	workerFactory: WorkerFactory<TWorker>;
	/** Creates the API proxy associated with the worker. */
	proxyFactory: (worker: TWorker) => TProxy;
	/** Optional host-specific termination implementation. */
	workerTerminator?: WorkerTerminator<TWorker>;
}

export type WorkerPoolConfiguration<
	TProxy extends CallableProxy<TProxy>,
	TWorker extends WorkerHandle,
> = WorkerPoolCommonOptions<TProxy> &
	WorkerPoolEndpointOptions<TProxy, TWorker>;

/** Options for a pool of dedicated workers. */
export interface WorkerPoolOptions<TProxy extends CallableProxy<TProxy>>
	extends WorkerPoolCommonOptions<TProxy>,
		WorkerPoolEndpointOptions<TProxy, Worker> {}

/** Options for a pool of SharedWorker connections. */
export interface SharedWorkerPoolOptions<TProxy extends CallableProxy<TProxy>>
	extends WorkerPoolCommonOptions<TProxy>,
		WorkerPoolEndpointOptions<TProxy, SharedWorker> {}
