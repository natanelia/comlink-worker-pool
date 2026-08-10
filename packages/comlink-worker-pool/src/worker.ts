/** A dedicated worker or SharedWorker connection handle owned by the pool. */
export type WorkerHandle = Worker | SharedWorker;

/** Factory for creating a fresh worker handle. */
export type WorkerFactory<TWorker extends WorkerHandle = Worker> =
	() => TWorker;

/** Result of synchronous or asynchronous cleanup for a worker handle. */
// biome-ignore lint/suspicious/noConfusingVoidType: synchronous cleanup naturally returns void.
export type WorkerTerminationResult = void | PromiseLike<unknown>;

/**
 * Releases a pool-owned worker handle.
 *
 * Completion confirms the cleanup operation. For a SharedWorker, it does not
 * imply that the shared process ended; the default cleanup closes only this
 * handle's connection port.
 */
export type WorkerTerminator<TWorker extends WorkerHandle = Worker> = (
	worker: TWorker,
) => WorkerTerminationResult;

/** A bound cleanup operation for one pool-owned worker handle. */
export type BoundWorkerDisposer = () => WorkerTerminationResult;

/** Removes every failure listener registered for a worker handle. */
export type WorkerFailureUnsubscribe = () => void;

/** Platform-neutral lifecycle boundary consumed by the scheduler. */
export interface WorkerLease<TProxy> {
	/** Stable identity used for freshness checks and cleanup quarantine. */
	identity: object;
	/** Creates the API proxy after failure observation is active. */
	createProxy: () => TProxy;
	/** Observes all failure sources and returns idempotent cleanup. */
	subscribeToFailures: (
		listener: (event: Event) => void,
	) => WorkerFailureUnsubscribe;
	/** Releases the resources owned through this handle. */
	dispose: BoundWorkerDisposer;
}

const DEDICATED_WORKER_FAILURE_EVENT_TYPES = ["error", "messageerror"] as const;
const SHARED_WORKER_FAILURE_EVENT_TYPES = ["error"] as const;
const SHARED_WORKER_PORT_FAILURE_EVENT_TYPES = [
	"messageerror",
	"close",
] as const;

function isDedicatedWorker(worker: WorkerHandle): worker is Worker {
	return "terminate" in worker;
}

function getWorkerFailureTargets(
	worker: WorkerHandle,
): Array<readonly [EventTarget, readonly string[]]> {
	if (isDedicatedWorker(worker)) {
		return [[worker, DEDICATED_WORKER_FAILURE_EVENT_TYPES]];
	}
	return [
		[worker, SHARED_WORKER_FAILURE_EVENT_TYPES],
		[worker.port, SHARED_WORKER_PORT_FAILURE_EVENT_TYPES],
	];
}

function subscribeToWorkerFailures(
	worker: WorkerHandle,
	listener: (event: Event) => void,
): WorkerFailureUnsubscribe {
	const registrations: Array<readonly [EventTarget, string]> = [];
	let active = true;
	let subscribing = true;
	let synchronousFailureObserved = false;
	const forwardingListener = (event: Event) => {
		if (subscribing) synchronousFailureObserved = true;
		listener(event);
	};
	const unsubscribe = () => {
		if (!active) return;
		active = false;
		for (const [target, type] of registrations.splice(0)) {
			try {
				target.removeEventListener(type, forwardingListener);
			} catch {
				// Continue removing the remaining listeners independently.
			}
		}
	};

	try {
		registration: for (const [target, eventTypes] of getWorkerFailureTargets(
			worker,
		)) {
			for (const type of eventTypes) {
				registrations.push([target, type]);
				target.addEventListener(type, forwardingListener);
				if (synchronousFailureObserved) break registration;
			}
		}
	} catch (error) {
		unsubscribe();
		throw error;
	} finally {
		subscribing = false;
	}

	return unsubscribe;
}

function disposeWorkerHandle(worker: WorkerHandle): void {
	if (isDedicatedWorker(worker)) {
		worker.terminate();
		return;
	}
	worker.port.close();
}

function assertWorkerHandle(worker: WorkerHandle): void {
	if ((typeof worker !== "object" && typeof worker !== "function") || !worker) {
		throw new TypeError(
			"workerFactory must return a Worker or SharedWorker object",
		);
	}
}

/** Normalizes a concrete worker configuration into scheduler-owned leases. */
export function createWorkerLeaseFactory<TProxy, TWorker extends WorkerHandle>(
	workerFactory: WorkerFactory<TWorker>,
	proxyFactory: (worker: TWorker) => TProxy,
	workerTerminator?: WorkerTerminator<TWorker>,
): () => WorkerLease<TProxy> {
	return () => {
		const worker = workerFactory();
		assertWorkerHandle(worker);
		return {
			identity: worker,
			createProxy: () => proxyFactory(worker),
			subscribeToFailures: (listener) =>
				subscribeToWorkerFailures(worker, listener),
			dispose: () =>
				workerTerminator
					? workerTerminator(worker)
					: disposeWorkerHandle(worker),
		};
	};
}
