import type {
	WorkerFactory,
	WorkerPool,
	WorkerPoolOptions,
} from "comlink-worker-pool";
import { useCallback, useEffect, useRef, useState } from "react";

interface ProxyDefault {
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	[key: string]: (...args: any[]) => Promise<unknown>;
}

/**
 * Options for configuring the useWorkerPool hook.
 *
 * @template TProxy The type of the proxy API exposed by the worker.
 */
export interface UseWorkerPoolOptions<TProxy extends ProxyDefault> {
	/** A function that creates a new Worker instance. */
	workerFactory: WorkerFactory;
	/** A function that creates a proxy API for the worker. */
	proxyFactory: (worker: Worker) => TProxy;
	/** The number of workers in the pool (default: navigator.hardwareConcurrency || 4). */
	poolSize?: number;
	/** Optional callback for worker pool statistics updates. */
	onUpdateStats?: WorkerPoolOptions<TProxy>["onUpdateStats"];
	/** Optional timeout (ms) for idle workers before they are terminated. */
	workerIdleTimeoutMs?: number;
}

/**
 * Result of useWorkerPool.
 */
/**
 * Result object returned from the useWorkerPool hook.
 *
 * @template TProxy The type of the proxy API exposed by the worker.
 */
export interface UseWorkerPoolResult<TProxy extends ProxyDefault> {
	/** The proxy API for calling worker methods, or null if not initialized. */
	api: TProxy | null;
	/** The status of the last call ("idle", "running", "error", "completed"). */
	status: "idle" | "running" | "error" | "completed";
	/** The result of the last call. */
	result: unknown;
	/** The error from the last call, if any. */
	error: unknown;
	/**
	 * Function to call a method on the worker pool. Returns a promise of the result.
	 *
	 * @param method - The method name to call on the proxy API.
	 * @param args - Arguments to pass to the method.
	 * @returns Promise resolving to the method's result.
	 */
	call<K extends keyof TProxy>(
		method: K,
		...args: Parameters<TProxy[K]>
	): Promise<Awaited<ReturnType<TProxy[K]>>>;
}

/**
 * React hook for managing a pool of web workers using comlink-worker-pool.
 *
 * This hook initializes a pool of workers and provides a type-safe proxy API for calling worker methods.
 * It manages worker lifecycle, error handling, and result state for each call.
 *
 * @template TProxy The type of the proxy API exposed by the worker.
 * @param options - Configuration options for the worker pool.
 * @returns An object containing the proxy API, call status, result, error, and a function to call worker methods.
 *
 * @example
 * ```tsx
 * const { api, call, status, result, error } = useWorkerPool<MyWorkerApi>({
 *   workerFactory: () => new Worker(new URL("./worker.ts", import.meta.url)),
 *   proxyFactory: (worker) => Comlink.wrap<MyWorkerApi>(worker),
 *   poolSize: 2,
 * });
 *
 * // Call a worker method:
 * useEffect(() => {
 *   if (api) {
 *     call("myMethod", arg1, arg2)
 *       .then(res => ...)
 *       .catch(err => ...);
 *   }
 * }, [api]);
 * ```
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
	const poolRef = useRef<WorkerPool<TProxy> | null>(null);

	useEffect(() => {
		let cancelled = false;
		import("comlink-worker-pool").then(({ WorkerPool }) => {
			if (cancelled) return;
			poolRef.current = new WorkerPool<TProxy>({
				size: options.poolSize || navigator.hardwareConcurrency || 4,
				workerFactory: options.workerFactory,
				proxyFactory: options.proxyFactory,
				onUpdateStats: options.onUpdateStats,
				workerIdleTimeoutMs: options.workerIdleTimeoutMs,
			});
			setApi(poolRef.current.getApi());
		});
		return () => {
			cancelled = true;
			poolRef.current?.terminateAll?.();
			poolRef.current = null;
			setApi(null);
		};
	}, [
		options.workerFactory,
		options.proxyFactory,
		options.poolSize,
		options.onUpdateStats,
		options.workerIdleTimeoutMs,
	]);

	const call = useCallback(
		async <K extends keyof TProxy>(
			method: K,
			...args: Parameters<TProxy[K]>
		): Promise<Awaited<ReturnType<TProxy[K]>>> => {
			setStatus("running");
			setResult(null);
			setError(null);
			if (!api) {
				setStatus("error");
				setError(new Error("Worker pool not initialized"));
				throw new Error("Worker pool not initialized");
			}
			try {
				const res = await api[method](...args);
				setResult(res);
				setStatus("completed");
				return res as Awaited<ReturnType<TProxy[K]>>;
			} catch (err) {
				setError(err);
				setStatus("error");
				throw err;
			}
		},
		[api],
	);

	return {
		api,
		status,
		result,
		error,
		call,
	};
}
