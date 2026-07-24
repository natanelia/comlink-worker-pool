import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CallableProxy<TProxy> = {
	// biome-ignore lint/suspicious/noExplicitAny: worker APIs may have arbitrary signatures
	[K in keyof TProxy]: (...args: any[]) => unknown;
};

type MethodOf<TProxy, K extends keyof TProxy> = TProxy[K] extends (
	...args: infer TArgs
) => infer TResult
	? (...args: TArgs) => TResult
	: never;

/** Result type inferred from a selected worker method. */
export type WorkerTaskResult<
	TProxy extends CallableProxy<TProxy>,
	K extends keyof TProxy,
> = Awaited<ReturnType<MethodOf<TProxy, K>>>;

/** State returned by useWorkerTask for one method-bound task. */
export interface UseWorkerTaskResult<
	TProxy extends CallableProxy<TProxy>,
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
	TProxy extends CallableProxy<TProxy>,
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
	const binding = useMemo(() => ({ api, method }), [api, method]);
	const activeBindingRef = useRef<object | null>(null);

	const reset = useCallback(() => {
		if (activeBindingRef.current !== binding) return;
		++latestCallIdRef.current;
		setStatus("idle");
		setResult(null);
		setError(null);
	}, [binding]);

	useEffect(() => {
		activeBindingRef.current = binding;
		reset();
		return () => {
			if (activeBindingRef.current !== binding) return;
			activeBindingRef.current = null;
			++latestCallIdRef.current;
		};
	}, [binding, reset]);

	const run = useCallback(
		async (
			...args: Parameters<MethodOf<TProxy, K>>
		): Promise<WorkerTaskResult<TProxy, K>> => {
			const bindingIsCurrent = () => activeBindingRef.current === binding;
			const callId = bindingIsCurrent() ? ++latestCallIdRef.current : undefined;
			const isCurrent = () =>
				callId !== undefined &&
				bindingIsCurrent() &&
				latestCallIdRef.current === callId;
			if (isCurrent()) {
				setStatus("running");
				setResult(null);
				setError(null);
			}

			if (!api) {
				const notReady = new Error("Worker pool is not ready");
				if (isCurrent()) {
					setStatus("error");
					setError(() => notReady);
				}
				throw notReady;
			}

			try {
				const task = api[method] as unknown as MethodOf<TProxy, K>;
				const value = (await Reflect.apply(
					task,
					api,
					args,
				)) as WorkerTaskResult<TProxy, K>;
				if (isCurrent()) {
					setStatus("completed");
					setResult(() => value);
				}
				return value;
			} catch (taskError) {
				if (isCurrent()) {
					setStatus("error");
					setError(() => taskError);
				}
				throw taskError;
			}
		},
		[api, binding, method],
	);

	return { status, result, error, run, reset };
}
