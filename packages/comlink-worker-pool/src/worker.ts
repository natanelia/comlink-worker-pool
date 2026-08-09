/** A worker object whose lifecycle is owned by the pool. */
export type WorkerHandle = Worker | SharedWorker;

/** Factory for creating a fresh worker handle. */
export type WorkerFactory<TWorker extends WorkerHandle = Worker> =
	() => TWorker;

/** Result of a synchronous or asynchronous worker termination. */
// biome-ignore lint/suspicious/noConfusingVoidType: sync terminators naturally return void.
export type WorkerTerminationResult = void | PromiseLike<unknown>;

/** Terminates a worker and resolves only when termination is confirmed. */
export type WorkerTerminator<TWorker extends WorkerHandle = Worker> = (
	worker: TWorker,
) => WorkerTerminationResult;

/** A bound termination operation for one worker instance. */
export type BoundWorkerTerminator = () => WorkerTerminationResult;

export interface WorkerFailureTarget {
	target: EventTarget;
	eventTypes: readonly string[];
}

const DEDICATED_WORKER_FAILURE_EVENT_TYPES = [
	"error",
	"messageerror",
	"close",
] as const;
const SHARED_WORKER_FAILURE_EVENT_TYPES = ["error"] as const;
const SHARED_WORKER_PORT_FAILURE_EVENT_TYPES = [
	"messageerror",
	"close",
] as const;

function isDedicatedWorker(worker: WorkerHandle): worker is Worker {
	return "terminate" in worker;
}

/** Returns every event source that can report failure for a worker. */
export function getWorkerFailureTargets(
	worker: WorkerHandle,
): WorkerFailureTarget[] {
	if (isDedicatedWorker(worker)) {
		return [
			{ target: worker, eventTypes: DEDICATED_WORKER_FAILURE_EVENT_TYPES },
		];
	}
	return [
		{ target: worker, eventTypes: SHARED_WORKER_FAILURE_EVENT_TYPES },
		{
			target: worker.port,
			eventTypes: SHARED_WORKER_PORT_FAILURE_EVENT_TYPES,
		},
	];
}

/** Applies the platform-default termination behavior for a worker. */
export function terminateWorker(worker: WorkerHandle): void {
	if (isDedicatedWorker(worker)) {
		worker.terminate();
		return;
	}
	worker.port.close();
}
