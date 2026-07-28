import { afterEach, describe, expect, jest, test } from "bun:test";
import { WorkerPool } from "./WorkerPool";

type ReentrantApi = {
	run(value: string): Promise<string>;
};

class ReentrantWorker extends EventTarget {
	terminate(): void {}
}

afterEach(() => {
	if (jest.isFakeTimers()) {
		jest.clearAllTimers();
		jest.useRealTimers();
	}
});

describe("WorkerPool - reentrant scheduling", () => {
	test("does not install a queue timer after reentrant cancellation", async () => {
		jest.useFakeTimers({ now: 4_000 });
		const controller = new AbortController();
		const pool = new WorkerPool<ReentrantApi>({
			size: 1,
			queueTimeoutMs: 1_000,
			taskTimeoutMs: false,
			workerFactory: () => new ReentrantWorker() as unknown as Worker,
			proxyFactory: () => ({ run: async (value) => value }),
			onEvent: (event) => {
				if (event.type === "task-queued") controller.abort();
			},
		});

		await expect(
			pool.run("run", ["cancelled"], { signal: controller.signal }),
		).rejects.toMatchObject({ name: "WorkerTaskAbortedError" });
		expect(jest.getTimerCount()).toBe(0);
		await pool.close();
	});
	test("does not execute a task aborted during listener registration", async () => {
		let invocations = 0;
		const signal = {
			aborted: false,
			reason: "synchronous registration abort",
			addEventListener: (
				_type: string,
				listener: EventListenerOrEventListenerObject,
			) => {
				if (typeof listener === "function") listener(new Event("abort"));
				else listener.handleEvent(new Event("abort"));
			},
			removeEventListener: () => {},
		} as unknown as AbortSignal;
		const pool = new WorkerPool<ReentrantApi>({
			size: 1,
			taskTimeoutMs: false,
			workerFactory: () => new ReentrantWorker() as unknown as Worker,
			proxyFactory: () => ({
				run: async (value) => {
					invocations++;
					return value;
				},
			}),
		});

		await expect(
			pool.run("run", ["cancelled"], { signal }),
		).rejects.toMatchObject({ name: "WorkerTaskAbortedError" });
		await Promise.resolve();
		expect(invocations).toBe(0);
		expect(pool.getStats()).toMatchObject({
			cancelledTasks: 1,
			startedTasks: 0,
			workers: 0,
		});
		await pool.close();
	});
});
