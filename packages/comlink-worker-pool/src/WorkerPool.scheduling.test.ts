import { afterEach, describe, expect, test } from "bun:test";
import {
	WorkerPool,
	type WorkerPoolOptions,
	WorkerQueueTimeoutError,
	WorkerTaskAbortedError,
} from "./WorkerPool";

type TestApi = { run(value: string): Promise<string> };
type Options = Partial<
	Pick<
		WorkerPoolOptions<TestApi>,
		| "maxQueueSize"
		| "queueOverflowPolicy"
		| "queueTimeoutMs"
		| "maxConcurrentTasksPerWorker"
	>
> & { size?: number };
type Invocation = {
	workerId: number;
	value: string;
	resolve: (value: string) => void;
};

class TestWorker extends EventTarget {
	constructor(readonly id: number) {
		super();
	}
	terminate(): void {}
}

const pools: WorkerPool<TestApi>[] = [];
afterEach(() => {
	for (const pool of pools.splice(0)) pool.terminateAll();
});

function createHarness(options: Options = {}) {
	let nextWorkerId = 0;
	const invocations: Invocation[] = [];
	const pool = new WorkerPool<TestApi>({
		...options,
		size: options.size ?? 1,
		workerFactory: () => new TestWorker(nextWorkerId++) as unknown as Worker,
		proxyFactory: (worker) => ({
			run: (value) =>
				new Promise((resolve) => {
					invocations.push({
						workerId: (worker as unknown as TestWorker).id,
						value,
						resolve,
					});
				}),
		}),
	});
	pools.push(pool);
	return { invocations, pool };
}

async function flush(): Promise<void> {
	for (let index = 0; index < 5; index++) await Promise.resolve();
}

describe("WorkerPool - scheduling controls", () => {
	test("bounds the waiting queue and rejects overflow", async () => {
		const { invocations, pool } = createHarness({ maxQueueSize: 1 });
		const active = pool.run("run", ["active"]);
		await flush();
		const waiting = pool.run("run", ["waiting"]);
		await expect(pool.run("run", ["overflow"])).rejects.toMatchObject({
			name: "WorkerPoolQueueFullError",
			maxQueueSize: 1,
			dropped: false,
		});
		invocations[0].resolve("active");
		await flush();
		invocations[1].resolve("waiting");
		await expect(Promise.all([active, waiting])).resolves.toEqual([
			"active",
			"waiting",
		]);
	});

	test("drop-oldest evicts the oldest waiting task", async () => {
		const { invocations, pool } = createHarness({
			maxQueueSize: 1,
			queueOverflowPolicy: "drop-oldest",
		});
		const active = pool.run("run", ["active"]);
		await flush();
		const dropped = pool.run("run", ["dropped"]);
		const replacement = pool.run("run", ["replacement"]);
		await expect(dropped).rejects.toMatchObject({ dropped: true });
		invocations[0].resolve("active");
		await flush();
		invocations[1].resolve("replacement");
		await expect(Promise.all([active, replacement])).resolves.toEqual([
			"active",
			"replacement",
		]);
	});

	test("prioritizes queued work while preserving FIFO ties", async () => {
		const { invocations, pool } = createHarness();
		const calls = [
			pool.run("run", ["active"]),
			pool.run("run", ["low"], { priority: -1 }),
			pool.run("run", ["high-1"], { priority: 2 }),
			pool.run("run", ["high-2"], { priority: 2 }),
		];
		for (const [index, expected] of [
			"active",
			"high-1",
			"high-2",
			"low",
		].entries()) {
			await flush();
			expect(invocations[index].value).toBe(expected);
			invocations[index].resolve(expected);
		}
		await Promise.all(calls);
	});

	test("times out and aborts queued tasks without disturbing active work", async () => {
		const { invocations, pool } = createHarness();
		const active = pool.run("run", ["active"]);
		await flush();
		const controller = new AbortController();
		const aborted = pool.run("run", ["aborted"], { signal: controller.signal });
		const timedOut = pool.run("run", ["timed-out"], { queueTimeoutMs: 5 });
		controller.abort();
		await expect(aborted).rejects.toBeInstanceOf(WorkerTaskAbortedError);
		await expect(timedOut).rejects.toBeInstanceOf(WorkerQueueTimeoutError);
		expect(pool.getStats().queue).toBe(0);
		invocations[0].resolve("active");
		await active;
	});

	test("active abort rejects the caller but retains the worker slot", async () => {
		const { invocations, pool } = createHarness();
		const controller = new AbortController();
		const active = pool.run("run", ["active"], { signal: controller.signal });
		await flush();
		controller.abort();
		await expect(active).rejects.toBeInstanceOf(WorkerTaskAbortedError);
		expect(pool.getStats().runningTasks).toBe(1);
		invocations[0].resolve("ignored");
		await flush();
		expect(pool.getStats().runningTasks).toBe(0);
	});

	test("balances calls across the least-loaded workers", async () => {
		const { invocations, pool } = createHarness({
			size: 2,
			maxConcurrentTasksPerWorker: 2,
		});
		const calls = ["a", "b", "c", "d"].map((value) => pool.run("run", [value]));
		await flush();
		expect(invocations.map(({ workerId }) => workerId)).toEqual([0, 1, 0, 1]);
		for (const call of invocations) call.resolve(call.value);
		await Promise.all(calls);
	});
});
