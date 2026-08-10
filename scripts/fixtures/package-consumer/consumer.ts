import {
	type PooledApi,
	type SharedWorkerPoolOptions,
	WorkerPool,
	type WorkerPoolShutdownReport,
} from "comlink-worker-pool";
import {
	type UseSharedWorkerPoolOptions,
	useWorkerPool,
	useWorkerTask,
} from "comlink-worker-pool-react";

interface Api {
	add(a: number, b: number): Promise<number>;
}

interface SyncApi {
	sync(value: number): number;
	then(): Promise<void>;
	[Symbol.iterator](): Iterator<number>;
}

interface StringIndexedApi {
	[method: string]: () => number;
}

declare const workerFactory: () => Worker;
declare const proxyFactory: (worker: Worker) => Api;
declare const sharedWorkerFactory: () => SharedWorker;
declare const sharedProxyFactory: (worker: SharedWorker) => Api;
declare const syncProxyFactory: (worker: Worker) => SyncApi;
declare const stringIndexedProxyFactory: (worker: Worker) => StringIndexedApi;

const pool = new WorkerPool<Api>({
	size: 1,
	workerFactory,
	proxyFactory,
	maxQueueSize: 2,
});
const result: Promise<number> = pool.run("add", [1, 2], { priority: 1 });
const shutdown: Promise<WorkerPoolShutdownReport> = pool.drain();

const sharedOptions: SharedWorkerPoolOptions<Api> = {
	size: 1,
	workerFactory: sharedWorkerFactory,
	proxyFactory: sharedProxyFactory,
	maxConcurrentTasksPerWorker: 2,
	workerTerminator: (worker) => worker.port.close(),
};
const sharedPool = new WorkerPool<Api>(sharedOptions);

// Keep these callbacks inline: this verifies constructor contextual inference.
const inferredSharedPool = new WorkerPool<Api>({
	size: 1,
	workerFactory: sharedWorkerFactory,
	proxyFactory: (worker) => {
		const port: MessagePort = worker.port;
		void port;
		return sharedProxyFactory(worker);
	},
	workerTerminator: (worker) => worker.port.close(),
});

const syncPool = new WorkerPool<SyncApi>({
	size: 1,
	workerFactory,
	proxyFactory: syncProxyFactory,
});
const pooledApi: PooledApi<SyncApi> = syncPool.getApi();
const syncResult: Promise<number> = pooledApi.sync(1);
const reservedResult: Promise<void> = syncPool.run("then", []);
// @ts-expect-error Scheduled calls always return promises.
const incorrectSyncResult: number = pooledApi.sync(1);
// @ts-expect-error The then key is reserved on the scheduled proxy.
pooledApi.then();
// @ts-expect-error Symbol methods are not exposed by the scheduled proxy.
pooledApi[Symbol.iterator]();

const stringIndexedPool = new WorkerPool<StringIndexedApi>({
	size: 1,
	workerFactory,
	proxyFactory: stringIndexedProxyFactory,
});
const stringIndexedApi: PooledApi<StringIndexedApi> =
	stringIndexedPool.getApi();
const stringIndexedResult: Promise<number> = stringIndexedApi.work();
// @ts-expect-error The then key stays reserved for string-indexed scheduled APIs.
stringIndexedApi.then();

function useConsumerHooks() {
	const hook = useWorkerPool<Api>({
		workerFactory,
		proxyFactory,
		poolSize: 1,
	});
	const task = useWorkerTask(hook.api, "add");
	const taskResult: number | null = task.result;

	const sharedHookOptions: UseSharedWorkerPoolOptions<Api> = {
		workerFactory: sharedWorkerFactory,
		proxyFactory: sharedProxyFactory,
		maxConcurrentTasksPerWorker: 2,
		workerTerminator: (worker) => worker.port.close(),
	};
	const sharedHook = useWorkerPool<Api>(sharedHookOptions);

	// Keep these callbacks inline: this verifies hook contextual inference.
	const inferredSharedHook = useWorkerPool<Api>({
		workerFactory: sharedWorkerFactory,
		proxyFactory: (worker) => {
			const port: MessagePort = worker.port;
			void port;
			return sharedProxyFactory(worker);
		},
		workerTerminator: (worker) => worker.port.close(),
	});

	const syncHook = useWorkerPool<SyncApi>({
		workerFactory,
		proxyFactory: syncProxyFactory,
	});
	const hookSyncResult: Promise<number> | undefined = syncHook.api?.sync(1);
	const trackedSyncResult: Promise<number> = syncHook.call("sync", 1);
	// @ts-expect-error The then key is reserved on the scheduled hook API.
	syncHook.call("then");

	const stringIndexedHook = useWorkerPool<StringIndexedApi>({
		workerFactory,
		proxyFactory: stringIndexedProxyFactory,
	});
	const stringIndexedHookResult: Promise<number> | undefined =
		stringIndexedHook.api?.work();
	const stringIndexedTrackedResult: Promise<number> =
		stringIndexedHook.call("work");
	// @ts-expect-error Tracked calls also reserve then for string-indexed APIs.
	stringIndexedHook.call("then");

	void taskResult;
	void sharedHook;
	void inferredSharedHook;
	void hookSyncResult;
	void trackedSyncResult;
	void stringIndexedHookResult;
	void stringIndexedTrackedResult;
}

void result;
void shutdown;
void sharedPool;
void inferredSharedPool;
void syncResult;
void reservedResult;
void incorrectSyncResult;
void stringIndexedResult;
void useConsumerHooks;
