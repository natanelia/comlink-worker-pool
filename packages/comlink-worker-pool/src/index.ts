import {
	WorkerPool as WorkerPoolImplementation,
	type WorkerPoolOptions,
} from "./WorkerPool";

type CallableProxy<TProxy> = {
	// biome-ignore lint/suspicious/noExplicitAny: worker APIs may have arbitrary signatures
	[K in keyof TProxy]: (...args: any[]) => unknown;
};

/** Promise-returning API exposed by WorkerPool.getApi(). */
export type PooledApi<TProxy extends CallableProxy<TProxy>> = {
	[K in keyof TProxy as K extends string
		? K extends "then"
			? never
			: K
		: never]: TProxy[K] extends (...args: infer TArgs) => infer TResult
		? (...args: TArgs) => Promise<Awaited<TResult>>
		: never;
};

/** Public WorkerPool instance with the scheduled API return type. */
export type WorkerPool<
	TProxy extends CallableProxy<TProxy>,
	TTask extends { method: keyof TProxy; args: unknown[] } = {
		method: keyof TProxy;
		args: unknown[];
	},
	TResult = Awaited<ReturnType<TProxy[TTask["method"]]>>,
> = Omit<WorkerPoolImplementation<TProxy, TTask, TResult>, "getApi"> & {
	getApi(): PooledApi<TProxy>;
};

interface WorkerPoolConstructor {
	new <
		TProxy extends CallableProxy<TProxy>,
		TTask extends { method: keyof TProxy; args: unknown[] } = {
			method: keyof TProxy;
			args: unknown[];
		},
		TResult = Awaited<ReturnType<TProxy[TTask["method"]]>>,
	>(options: WorkerPoolOptions<TProxy>): WorkerPool<TProxy, TTask, TResult>;
}

export const WorkerPool =
	WorkerPoolImplementation as unknown as WorkerPoolConstructor;

export type {
	QueueOverflowPolicy,
	Task,
	WorkerFactory,
	WorkerPoolEvent,
	WorkerPoolObserver,
	WorkerPoolOptions,
	WorkerPoolShutdownReport,
	WorkerPoolState,
	WorkerPoolStats,
	WorkerPoolTaskOutcome,
	WorkerPoolWorkerRemovalReason,
	WorkerTaskOptions,
	WorkerTerminator,
} from "./WorkerPool";
export * from "./errors";
