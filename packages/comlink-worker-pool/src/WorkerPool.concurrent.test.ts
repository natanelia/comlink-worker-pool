import { afterEach, describe, expect, test } from "bun:test";
import * as Comlink from "comlink";
import { WorkerPool, type WorkerPoolOptions } from "./WorkerPool";

type WorkerApi = {
	echo(value: string): Promise<string>;
	fail(): Promise<never>;
	delayAndReturn(delayMs: number, value: string): Promise<string>;
};

const pools = new Set<WorkerPool<WorkerApi>>();

function createTestWorker(): Worker {
	return new Worker(new URL("./__mocks__/comlinkWorker.ts", import.meta.url), {
		type: "module",
	});
}

function createPool(
	options: Partial<WorkerPoolOptions<WorkerApi>> = {},
): WorkerPool<WorkerApi> {
	const pool = new WorkerPool<WorkerApi>({
		...options,
		size: options.size ?? 1,
		workerFactory: options.workerFactory ?? createTestWorker,
		proxyFactory:
			options.proxyFactory ?? ((worker) => Comlink.wrap<WorkerApi>(worker)),
	});
	pools.add(pool);
	return pool;
}

afterEach(async () => {
	await Promise.allSettled([...pools].map((pool) => pool.close()));
	pools.clear();
});

describe("WorkerPool - real Comlink integration", () => {
	test("runs work concurrently up to the configured capacity", async () => {
		const pool = createPool({
			size: 2,
			maxConcurrentTasksPerWorker: 2,
		});
		const api = pool.getApi();
		const tasks = [
			api.delayAndReturn(20, "one"),
			api.delayAndReturn(20, "two"),
			api.delayAndReturn(20, "three"),
			api.delayAndReturn(20, "four"),
			api.delayAndReturn(20, "queued"),
		];

		expect(pool.getStats()).toMatchObject({
			workers: 2,
			runningTasks: 4,
			queue: 1,
		});
		await expect(Promise.all(tasks)).resolves.toEqual([
			"one",
			"two",
			"three",
			"four",
			"queued",
		]);
		expect(pool.getStats()).toMatchObject({ runningTasks: 0, queue: 0 });
	});

	test("propagates remote errors without poisoning the worker", async () => {
		const pool = createPool({ maxConcurrentTasksPerWorker: 2 });
		const api = pool.getApi();

		await expect(api.fail()).rejects.toThrow("fail");
		await expect(api.echo("still usable")).resolves.toBe("still usable");
	});

	test("recycles real workers at the strict task limit", async () => {
		let workersCreated = 0;
		const pool = createPool({
			maxTasksPerWorker: 2,
			workerFactory: () => {
				workersCreated++;
				return createTestWorker();
			},
		});
		const api = pool.getApi();

		await expect(api.echo("first")).resolves.toBe("first");
		await expect(api.echo("second")).resolves.toBe("second");
		await expect(api.echo("third")).resolves.toBe("third");
		expect(workersCreated).toBe(2);
	});

	test("handles a high-volume batch without dropping calls", async () => {
		const pool = createPool({ size: 4 });
		const api = pool.getApi();
		const values = Array.from(
			{ length: 100 },
			(_, index) => `message-${index}`,
		);

		await expect(
			Promise.all(values.map((value) => api.echo(value))),
		).resolves.toEqual(values);
		expect(pool.getStats()).toMatchObject({
			completedTasks: values.length,
			failedTasks: 0,
			queue: 0,
		});
	});

	test("rejects invalid per-worker concurrency", () => {
		expect(() => createPool({ maxConcurrentTasksPerWorker: 0 })).toThrow(
			"maxConcurrentTasksPerWorker must be at least 1",
		);
		expect(() => createPool({ maxConcurrentTasksPerWorker: -1 })).toThrow(
			"maxConcurrentTasksPerWorker must be at least 1",
		);
	});
});
