import { describe, expect, test } from "bun:test";
import {
	WorkerPool,
	type WorkerPoolShutdownReport,
	WorkerPoolTerminatedError,
} from "./WorkerPool";

type TestApi = { run(value: string): Promise<string> };
type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

class TestWorker extends EventTarget {
	terminateCalls = 0;
	terminate(): void {
		this.terminateCalls++;
	}
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function flush(): Promise<void> {
	for (let index = 0; index < 5; index++) await Promise.resolve();
}

describe("WorkerPool - awaitable shutdown", () => {
	test("drain finishes accepted work, rejects new work, and terminates", async () => {
		const worker = new TestWorker();
		const invocations: Array<{ value: string; task: Deferred<string> }> = [];
		const pool = new WorkerPool<TestApi>({
			size: 1,
			workerFactory: () => worker as unknown as Worker,
			proxyFactory: () => ({
				run: (value) => {
					const task = deferred<string>();
					invocations.push({ value, task });
					return task.promise;
				},
			}),
		});
		const first = pool.run("run", ["first"]);
		const second = pool.run("run", ["second"]);
		await flush();
		const drained = pool.drain();

		await expect(pool.run("run", ["late"])).rejects.toBeInstanceOf(
			WorkerPoolTerminatedError,
		);
		expect(invocations.map(({ value }) => value)).toEqual(["first"]);
		invocations[0].task.resolve("first");
		await flush();
		expect(invocations.map(({ value }) => value)).toEqual(["first", "second"]);
		invocations[1].task.resolve("second");
		await expect(Promise.all([first, second])).resolves.toEqual([
			"first",
			"second",
		]);
		await expect(drained).resolves.toEqual({
			confirmed: true,
			unconfirmedWorkers: 0,
			terminationFailures: 0,
		});
		expect(worker.terminateCalls).toBe(1);
	});

	test("drain resumes work after a bounded no-progress scheduling pass", async () => {
		const workers: TestWorker[] = [];
		let failuresRemaining = 3;
		const pool = new WorkerPool<TestApi>({
			size: 1,
			workerFactory: () => {
				const worker = new TestWorker();
				workers.push(worker);
				return worker as unknown as Worker;
			},
			proxyFactory: () => ({ run: async (value) => value }),
			onEvent: (event) => {
				if (event.type === "worker-created" && failuresRemaining > 0) {
					failuresRemaining--;
					workers.at(-1)?.dispatchEvent(new Event("error"));
				}
			},
		});
		const accepted = pool.run("run", ["accepted"]);
		expect(pool.getStats()).toMatchObject({ queue: 1, startedTasks: 0 });
		expect(workers).toHaveLength(2);

		failuresRemaining = 0;
		const drained = pool.drain();
		await expect(accepted).resolves.toBe("accepted");
		await expect(drained).resolves.toMatchObject({ confirmed: true });
		expect(workers).toHaveLength(3);
	});

	test("drain closes instead of hanging when no worker can make progress", async () => {
		const workers: TestWorker[] = [];
		const pool = new WorkerPool<TestApi>({
			size: 1,
			workerFactory: () => {
				const worker = new TestWorker();
				workers.push(worker);
				return worker as unknown as Worker;
			},
			proxyFactory: () => ({ run: async (value) => value }),
			onEvent: (event) => {
				if (event.type === "worker-created") {
					workers.at(-1)?.dispatchEvent(new Event("error"));
				}
			},
		});
		const accepted = pool.run("run", ["unrunnable"]);
		expect(pool.getStats()).toMatchObject({ queue: 1, startedTasks: 0 });

		const drained = pool.drain();
		await expect(accepted).rejects.toBeInstanceOf(WorkerPoolTerminatedError);
		await expect(drained).resolves.toMatchObject({ confirmed: true });
		expect(pool.getStats()).toMatchObject({ state: "closed", queue: 0 });
	});

	test("close rejects work immediately and waits for async termination", async () => {
		const worker = new TestWorker();
		const call = deferred<string>();
		const termination = deferred<void>();
		const pool = new WorkerPool<TestApi>({
			size: 1,
			workerFactory: () => worker as unknown as Worker,
			proxyFactory: () => ({ run: () => call.promise }),
			workerTerminator: () => termination.promise,
		});
		const active = pool.run("run", ["active"]);
		await flush();
		const closed = pool.close();
		let report: WorkerPoolShutdownReport | undefined;
		void closed.then((value) => {
			report = value;
		});

		await expect(active).rejects.toBeInstanceOf(WorkerPoolTerminatedError);
		await flush();
		expect(report).toBeUndefined();
		termination.resolve();
		await expect(closed).resolves.toMatchObject({ confirmed: true });
		expect(pool.terminated).toBe(closed);
	});

	test("waits for a worker created during reentrant shutdown", async () => {
		const worker = new TestWorker();
		const termination = deferred<void>();
		const holder: { pool?: WorkerPool<TestApi> } = {};
		const pool = new WorkerPool<TestApi>({
			size: 1,
			terminationRetryAttempts: 0,
			workerFactory: () => {
				holder.pool?.terminateAll();
				return worker as unknown as Worker;
			},
			proxyFactory: () => ({ run: async (value) => value }),
			workerTerminator: () => termination.promise,
		});
		holder.pool = pool;
		let report: WorkerPoolShutdownReport | undefined;
		void pool.terminated.then((value) => {
			report = value;
		});

		await expect(pool.run("run", ["closed"])).rejects.toBeInstanceOf(
			WorkerPoolTerminatedError,
		);
		await flush();
		expect(report).toBeUndefined();
		expect(pool.getStats()).toMatchObject({
			healthyWorkers: 0,
			quarantinedWorkers: 1,
		});

		termination.resolve();
		await expect(pool.terminated).resolves.toEqual({
			confirmed: true,
			unconfirmedWorkers: 0,
			terminationFailures: 0,
		});
	});

	test("reports exhausted termination attempts without hanging", async () => {
		const worker = new TestWorker();
		const pool = new WorkerPool<TestApi>({
			size: 1,
			terminationRetryAttempts: 0,
			workerFactory: () => worker as unknown as Worker,
			proxyFactory: () => ({ run: async (value) => value }),
			workerTerminator: () => {
				throw new Error("termination unavailable");
			},
		});
		await pool.run("run", ["create worker"]);

		await expect(pool.close()).resolves.toEqual({
			confirmed: false,
			unconfirmedWorkers: 1,
			terminationFailures: 1,
		});
	});
});
