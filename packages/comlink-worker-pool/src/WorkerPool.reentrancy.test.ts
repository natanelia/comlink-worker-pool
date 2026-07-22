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
});
