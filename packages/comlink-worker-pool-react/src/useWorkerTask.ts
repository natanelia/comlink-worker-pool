import { useCallback, useEffect, useRef, useState } from "react";
import type { ProxyDefault } from "./useWorkerPool";

type MethodOf<TProxy, K extends keyof TProxy> = TProxy[K] extends (
	...args: infer TArgs
) => infer TResult
	? (...args: TArgs) => TResult
	: never;

/** Result type inferred from a selected worker method. */
export type WorkerTaskResult<
	TProxy extends ProxyDefault,
	K extends keyof TProxy,
> = Awaited<ReturnType<MethodOf<TProxy, K>>>;

/** State returned by useWorkerTask for one method-bound task. */
export interface UseWorkerTaskResult<
	TProxy extends ProxyDefault,
	K extends keyof TProxy,
> {
	status: "idle" | "running" | "error" | "completed";
	result: WorkerTaskResult<TProxy, K> | null;
	error: unknown;
	run(
		...args: Parameters<MethodOf<TProxy, K>>
	): Promise<WorkerTaskResult<TProxy, K>>;
	reset(): void;
}

/**
 * Binds task state and a typed run function to one method on a pool API.
 * Overlapping calls retain the state of the latest-started invocation.
 */
export function useWorkerTask<
	TProxy extends ProxyDefault,
	K extends keyof TProxy,
>(api: TProxy | null, method: K): UseWorkerTaskResult<TProxy, K> {
	const [status, setStatus] = useState<
		"idle" | "running" | "error" | "completed"
	>("idle");
	const [result, setResult] = useState<WorkerTaskResult<TProxy, K> | null>(
		null,
	);
	const [error, setError] = useState<unknown>(null);
	const latestCallIdRef = useRef(0);

	const reset = useCallback(() => {
		++latestCallIdRef.current;
		setStatus("idle");
		setResult(null);
		setError(null);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new API or method is a new task binding and must reset stale state.
	useEffect(() => {
		reset();
		return () => {
			++latestCallIdRef.current;
		};
	}, [api, method, reset]);

	const run = useCallback(
		async (
			...args: Parameters<MethodOf<TProxy, K>>
		): Promise<WorkerTaskResult<TProxy, K>> => {
			const callId = ++latestCallIdRef.current;
			const isCurrent = () => latestCallIdRef.current === callId;
			setStatus("running");
			setResult(null);
			setError(null);

			if (!api) {
				const notReady = new Error("Worker pool is not ready");
				if (isCurrent()) {
					setStatus("error");
					setError(notReady);
				}
				throw notReady;
			}

			try {
				const task = api[method] as unknown as MethodOf<TProxy, K>;
				const value = (await task(...args)) as WorkerTaskResult<TProxy, K>;
				if (isCurrent()) {
					setStatus("completed");
					setResult(value);
				}
				return value;
			} catch (taskError) {
				if (isCurrent()) {
					setStatus("error");
					setError(taskError);
				}
				throw taskError;
			}
		},
		[api, method],
	);

	return { status, result, error, run, reset };
}
