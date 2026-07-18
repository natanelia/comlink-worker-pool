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
