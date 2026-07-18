import {
	type WorkerFactory,
	WorkerPool,
	type WorkerPoolOptions,
	type WorkerPoolStats,
} from "comlink-worker-pool";
import { useCallback, useEffect, useRef, useState } from "react";

interface ProxyDefault {
	// biome-ignore lint/suspicious/noExplicitAny: worker APIs may have arbitrary signatures
	[key: string]: (...args: any[]) => unknown;
}

/** Options for configuring useWorkerPool. */
export interface UseWorkerPoolOptions<TProxy extends ProxyDefault> {
	/** Creates a fresh Worker instance. */
	workerFactory: WorkerFactory;
	/** Creates the proxy API for a Worker. */
	proxyFactory: (worker: Worker) => TProxy;
	/** Number of workers (defaults to navigator.hardwareConcurrency, then 4). */
	poolSize?: number;
	/** Receives live pool statistics without causing pool reconfiguration. */
	onUpdateStats?: WorkerPoolOptions<TProxy>["onUpdateStats"];
	/** Terminates an idle worker after this duration. */
	workerIdleTimeoutMs?: number;
	/** Retires a worker after this many assigned tasks. */
	maxTasksPerWorker?: number;
	/** Retires a worker after this lifetime once active tasks finish. */
	maxWorkerLifetimeMs?: number;
	/** Maximum number of concurrent tasks assigned to one worker. */
	maxConcurrentTasksPerWorker?: number;
	/** Maximum number of tasks waiting for a worker. */
	maxQueueSize?: WorkerPoolOptions<TProxy>["maxQueueSize"];
	/** Behavior when the waiting queue is full. */
	queueOverflowPolicy?: WorkerPoolOptions<TProxy>["queueOverflowPolicy"];
	/** Default maximum time a task may wait in the queue. */
	queueTimeoutMs?: WorkerPoolOptions<TProxy>["queueTimeoutMs"];
	/** Rejects overlong tasks and recycles their worker (five-minute default). */
	taskTimeoutMs?: WorkerPoolOptions<TProxy>["taskTimeoutMs"];
	/** Cleans up resources owned by a worker proxy. */
	proxyCleanup?: (proxy: TProxy) => void;
	/** Extra worker slots that preserve capacity after termination failure. */
	terminationFailureWorkerBuffer?: WorkerPoolOptions<TProxy>["terminationFailureWorkerBuffer"];
	/** Additional termination attempts after the initial attempt. */
	terminationRetryAttempts?: WorkerPoolOptions<TProxy>["terminationRetryAttempts"];
	/** Initial exponential-backoff delay for termination retries. */
	terminationRetryDelayMs?: WorkerPoolOptions<TProxy>["terminationRetryDelayMs"];
	/** Deadline for an asynchronous termination attempt. */
	terminationAttemptTimeoutMs?: WorkerPoolOptions<TProxy>["terminationAttemptTimeoutMs"];
	/** Optional host-specific worker terminator. */
	workerTerminator?: WorkerPoolOptions<TProxy>["workerTerminator"];
	/** Receives termination-attempt failures without reconfiguring the pool. */
	onWorkerTerminationError?: WorkerPoolOptions<TProxy>["onWorkerTerminationError"];
	/**
	 * Explicitly recreates the pool when this value changes.
	 *
	 * Factory identities are intentionally not effect dependencies, so inline
	 * callbacks cannot create an initialization loop. Change this key when a
	 * new workerFactory, proxyFactory, proxyCleanup, or workerTerminator must take effect.
	 */
	reconfigureKey?: unknown;
}

/** State returned from useWorkerPool. */
export interface UseWorkerPoolResult<TProxy extends ProxyDefault> {
	/** Proxy API for direct calls, or null if initialization failed. */
	api: TProxy | null;
	/** State of the latest call started through call(). */
	status: "idle" | "running" | "error" | "completed";
	/** Result of the latest call started through call(). */
	result: unknown;
	/** Error from the latest call or pool initialization. */
	error: unknown;
	/** Invokes a method and tracks it as the latest call. */
	call<K extends keyof TProxy>(
		method: K,
		...args: Parameters<TProxy[K]>
	): Promise<Awaited<ReturnType<TProxy[K]>>>;
}

/**
 * Creates and owns a WorkerPool for the lifetime of a React component.
 *
 * The pool is created only in an effect, so server rendering and abandoned
 * renders do not create workers. If calls overlap, only the latest-started
 * call is allowed to update status, result, and error.
 */
export function useWorkerPool<TProxy extends ProxyDefault>(
	options: UseWorkerPoolOptions<TProxy>,
): UseWorkerPoolResult<TProxy> {
	const [status, setStatus] = useState<
		"idle" | "running" | "error" | "completed"
	>("idle");
	const [result, setResult] = useState<unknown>(null);
	const [error, setError] = useState<unknown>(null);
	const [api, setApi] = useState<TProxy | null>(null);
	const generationRef = useRef(0);
	const latestCallIdRef = useRef(0);
	const statsCallbackRef = useRef(options.onUpdateStats);
	const workerFactoryRef = useRef(options.workerFactory);
	const proxyFactoryRef = useRef(options.proxyFactory);
	const proxyCleanupRef = useRef(options.proxyCleanup);
	const workerTerminatorRef = useRef(options.workerTerminator);
	const terminationErrorCallbackRef = useRef(options.onWorkerTerminationError);
	statsCallbackRef.current = options.onUpdateStats;
	workerFactoryRef.current = options.workerFactory;
	proxyFactoryRef.current = options.proxyFactory;
	proxyCleanupRef.current = options.proxyCleanup;
	workerTerminatorRef.current = options.workerTerminator;
	terminationErrorCallbackRef.current = options.onWorkerTerminationError;

	const {
		poolSize,
		workerIdleTimeoutMs,
		maxTasksPerWorker,
		maxWorkerLifetimeMs,
		maxConcurrentTasksPerWorker,
		maxQueueSize,
		queueOverflowPolicy,
		queueTimeoutMs,
		taskTimeoutMs,
		terminationFailureWorkerBuffer,
		terminationRetryAttempts,
		terminationRetryDelayMs,
		terminationAttemptTimeoutMs,
		reconfigureKey,
	} = options;

	useEffect(() => {
		void reconfigureKey;
		const generation = ++generationRef.current;
		++latestCallIdRef.current;
		let pool: WorkerPool<TProxy> | null = null;

		try {
			const hardwareConcurrency =
				typeof navigator !== "undefined" &&
				Number.isSafeInteger(navigator.hardwareConcurrency) &&
				navigator.hardwareConcurrency > 0
					? navigator.hardwareConcurrency
					: 4;

			// Capture factories for this generation. reconfigureKey is the explicit
			// signal for replacing them; callback identity churn alone is ignored.
			pool = new WorkerPool<TProxy>({
				size: poolSize ?? hardwareConcurrency,
				workerFactory: workerFactoryRef.current,
				proxyFactory: proxyFactoryRef.current,
				onUpdateStats: (stats: WorkerPoolStats) => {
					if (generationRef.current === generation) {
						statsCallbackRef.current?.(stats);
					}
				},
				workerIdleTimeoutMs,
				maxTasksPerWorker,
				maxWorkerLifetimeMs,
				maxConcurrentTasksPerWorker,
				maxQueueSize,
				queueOverflowPolicy,
				queueTimeoutMs,
				taskTimeoutMs,
				proxyCleanup: proxyCleanupRef.current,
				terminationFailureWorkerBuffer,
				terminationRetryAttempts,
				terminationRetryDelayMs,
				terminationAttemptTimeoutMs,
				workerTerminator: workerTerminatorRef.current,
				onWorkerTerminationError: (terminationError) => {
					if (generationRef.current === generation) {
						terminationErrorCallbackRef.current?.(terminationError);
					}
				},
			});
			setApi(pool.getApi());
			setStatus("idle");
			setResult(null);
			setError(null);
		} catch (initializationError) {
			if (generationRef.current === generation) {
				setApi(null);
				setStatus("error");
				setResult(null);
				setError(initializationError);
			}
		}

		return () => {
			if (generationRef.current === generation) {
				++generationRef.current;
				++latestCallIdRef.current;
			}
			pool?.terminateAll();
		};
		// Factory changes are applied only when reconfigureKey changes. This makes
		// inline factory callbacks safe and gives reconfiguration explicit timing.
	}, [
		poolSize,
		workerIdleTimeoutMs,
		maxTasksPerWorker,
		maxWorkerLifetimeMs,
		maxConcurrentTasksPerWorker,
		maxQueueSize,
		queueOverflowPolicy,
		queueTimeoutMs,
		taskTimeoutMs,
		terminationFailureWorkerBuffer,
		terminationRetryAttempts,
		terminationRetryDelayMs,
		terminationAttemptTimeoutMs,
		reconfigureKey,
	]);

	const call = useCallback(
		async <K extends keyof TProxy>(
			method: K,
			...args: Parameters<TProxy[K]>
		): Promise<Awaited<ReturnType<TProxy[K]>>> => {
			const callId = ++latestCallIdRef.current;
			const generation = generationRef.current;
			const isCurrent = () =>
				generationRef.current === generation &&
				latestCallIdRef.current === callId;

			if (isCurrent()) {
				setStatus("running");
				setResult(null);
				setError(null);
			}
			if (!api) {
				const notInitialized = new Error("Worker pool not initialized");
				if (isCurrent()) {
					setStatus("error");
					setError(notInitialized);
				}
				throw notInitialized;
			}

			try {
				const value = await api[method](...args);
				if (isCurrent()) {
					setResult(value);
					setStatus("completed");
				}
				return value as Awaited<ReturnType<TProxy[K]>>;
			} catch (callError) {
				if (isCurrent()) {
					setError(callError);
					setStatus("error");
				}
				throw callError;
			}
		},
		[api],
	);

	return { api, status, result, error, call };
}
