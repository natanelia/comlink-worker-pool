import { afterEach, describe, expect, jest, test } from "bun:test";
import {
	WorkerCrashedError,
	WorkerPool,
	type WorkerPoolEvent,
	WorkerPoolQueueFullError,
	WorkerPoolTerminatedError,
	WorkerQueueTimeoutError,
	WorkerTaskAbortedError,
	WorkerTaskTimeoutError,
} from "./WorkerPool";

class RegressionWorker extends EventTarget {
	terminateCalls = 0;

	terminate(): void {
		this.terminateCalls++;
	}
}

function asWorker(worker: RegressionWorker): Worker {
	return worker as unknown as Worker;
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index++) await Promise.resolve();
}

afterEach(() => {
	if (jest.isFakeTimers()) {
		jest.clearAllTimers();
		jest.useRealTimers();
	}
});

describe("WorkerPool - regression coverage", () => {
	test("worker-returned lifecycle errors remain ordinary task rejections", async () => {
		const errors = [
			new WorkerTaskAbortedError(),
			new WorkerQueueTimeoutError(1),
			new WorkerTaskTimeoutError(1),
			new WorkerPoolQueueFullError(1),
			new WorkerPoolQueueFullError(1, true),
			new WorkerCrashedError(99),
			new WorkerPoolTerminatedError(),
		];
		const outcomes: string[] = [];
		let errorIndex = 0;
		const pool = new WorkerPool<{ run(): Promise<never> }>({
			size: 1,
			workerFactory: () => asWorker(new RegressionWorker()),
			proxyFactory: () => ({
				run: async () => {
					throw errors[errorIndex++];
				},
			}),
			onEvent: (event) => {
				if (event.type === "task-settled") outcomes.push(event.outcome);
			},
		});

		for (const error of errors) {
			await expect(pool.run("run", [])).rejects.toBe(error);
		}
		expect(outcomes).toEqual(errors.map(() => "rejected"));
		expect(pool.getStats()).toMatchObject({
			failedTasks: errors.length,
			cancelledTasks: 0,
			timedOutTasks: 0,
			droppedTasks: 0,
		});
		await pool.close();
	});

	test("task-started observers can close without a late proxy invocation", async () => {
		let invocations = 0;
		const pool = new WorkerPool<{ run(): Promise<string> }>({
			size: 1,
			workerFactory: () => asWorker(new RegressionWorker()),
			proxyFactory: () => ({
				run: async () => {
					invocations++;
					return "late";
				},
			}),
			onEvent: (event) => {
				if (event.type === "task-started") pool.terminateAll();
			},
		});

		await expect(pool.run("run", [])).rejects.toBeInstanceOf(
			WorkerPoolTerminatedError,
		);
		await flushMicrotasks();
		expect(invocations).toBe(0);
		await pool.terminated;
	});

	test("never dispatches a worker removed during worker-created and resumes scheduling", async () => {
		const workers: RegressionWorker[] = [];
		const invokedOn: RegressionWorker[] = [];
		let crashed = false;
		const pool = new WorkerPool<{ run(value: string): Promise<string> }>({
			size: 1,
			workerFactory: () => {
				const worker = new RegressionWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: (worker) => ({
				run: async (value) => {
					invokedOn.push(worker as unknown as RegressionWorker);
					return value;
				},
			}),
			onEvent: (event) => {
				if (event.type === "worker-created" && !crashed) {
					crashed = true;
					workers[0].dispatchEvent(new Event("error"));
				}
			},
		});

		await expect(pool.run("run", ["replacement"])).resolves.toBe("replacement");
		expect(workers).toHaveLength(2);
		expect(invokedOn).toEqual([workers[1]]);
		await pool.close();
	});

	test("retires a never-used worker after reentrant task cancellation", async () => {
		jest.useFakeTimers({ now: 4_000 });
		const controller = new AbortController();
		const workers: RegressionWorker[] = [];
		const pool = new WorkerPool<{ run(): Promise<string> }>({
			size: 1,
			workerIdleTimeoutMs: 10,
			workerFactory: () => {
				const worker = new RegressionWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => ({ run: async () => "unused" }),
			onEvent: (event) => {
				if (event.type === "worker-created") controller.abort("cancelled");
			},
		});

		await expect(
			pool.run("run", [], { signal: controller.signal }),
		).rejects.toBeInstanceOf(WorkerTaskAbortedError);
		expect(pool.getStats().workers).toBe(1);
		jest.advanceTimersByTime(10);
		await flushMicrotasks();
		expect(pool.getStats().workers).toBe(0);
		expect(workers[0].terminateCalls).toBe(1);
		await pool.close();
	});

	test("includes synchronous task-queued observer time in queue deadlines", async () => {
		jest.useFakeTimers({ now: 5_000 });
		let queuedEvents = 0;
		const pool = new WorkerPool<{ run(): Promise<void> }>({
			size: 1,
			taskTimeoutMs: false,
			workerFactory: () => asWorker(new RegressionWorker()),
			proxyFactory: () => ({ run: () => new Promise<void>(() => {}) }),
			onEvent: (event) => {
				if (event.type === "task-queued" && ++queuedEvents === 2) {
					jest.advanceTimersByTime(10);
				}
			},
		});
		const active = pool.run("run", []).catch((error: unknown) => error);
		await flushMicrotasks();

		const expired = pool.run("run", [], { queueTimeoutMs: 5 });
		expect(pool.getStats().queue).toBe(0);
		await expect(expired).rejects.toBeInstanceOf(WorkerQueueTimeoutError);
		pool.terminateAll();
		await active;
	});

	test("failure settlement events observe already-decremented running counts", async () => {
		const worker = new RegressionWorker();
		const observedCounts: number[] = [];
		const pool = new WorkerPool<{ run(): Promise<void> }>({
			size: 1,
			maxConcurrentTasksPerWorker: 2,
			taskTimeoutMs: false,
			workerFactory: () => asWorker(worker),
			proxyFactory: () => ({ run: () => new Promise<void>(() => {}) }),
			onEvent: (event: WorkerPoolEvent) => {
				if (
					event.type === "task-settled" &&
					event.outcome === "worker-failure"
				) {
					observedCounts.push(pool.getStats().runningTasks);
				}
			},
		});
		const first = pool.run("run", []);
		const second = pool.run("run", []);
		await flushMicrotasks();

		worker.dispatchEvent(new Event("error"));
		await Promise.allSettled([first, second]);
		expect(observedCounts).toEqual([1, 0]);
		await pool.close();
	});

	test("reentrant failure observers cannot dispatch onto the failing worker", async () => {
		const workers: RegressionWorker[] = [];
		let replacement: Promise<string> | undefined;
		const pool = new WorkerPool<{ run(value: string): Promise<string> }>({
			size: 1,
			maxConcurrentTasksPerWorker: 2,
			taskTimeoutMs: false,
			workerFactory: () => {
				const worker = new RegressionWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: (worker) => ({
				run: (value) =>
					worker === asWorker(workers[0])
						? new Promise<string>(() => {})
						: Promise.resolve(value),
			}),
			onEvent: (event) => {
				if (
					!replacement &&
					event.type === "task-settled" &&
					event.outcome === "worker-failure"
				) {
					replacement = pool.run("run", ["replacement"]);
				}
			},
		});
		const failed = pool.run("run", ["failed"]);
		await flushMicrotasks();

		workers[0].dispatchEvent(new Event("error"));
		await expect(failed).rejects.toBeInstanceOf(WorkerCrashedError);
		expect(replacement).toBeDefined();
		await expect(replacement as Promise<string>).resolves.toBe("replacement");
		expect(workers).toHaveLength(2);
		await pool.close();
	});
});
