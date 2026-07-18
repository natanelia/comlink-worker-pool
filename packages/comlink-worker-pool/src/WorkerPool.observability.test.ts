import { afterEach, describe, expect, jest, test } from "bun:test";
import {
	WorkerPool,
	type WorkerPoolEvent,
	WorkerPoolQueueFullError,
	WorkerQueueTimeoutError,
} from "./WorkerPool";

type ObservedApi = {
	run(value: string): Promise<string>;
};

class ObservedWorker extends EventTarget {
	terminated = false;

	terminate(): void {
		this.terminated = true;
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 6; index++) await Promise.resolve();
}

afterEach(() => {
	if (jest.isFakeTimers()) {
		jest.clearAllTimers();
		jest.useRealTimers();
	}
});

describe("WorkerPool - observability", () => {
	test("emits ordered task/worker events and cumulative scheduling stats", async () => {
		jest.useFakeTimers({ now: 1_000 });
		const held = deferred<string>();
		const events: WorkerPoolEvent[] = [];
		const worker = new ObservedWorker();
		const pool = new WorkerPool<ObservedApi>({
			size: 1,
			maxConcurrentTasksPerWorker: 1,
			maxQueueSize: 2,
			taskTimeoutMs: false,
			workerFactory: () => worker as unknown as Worker,
			proxyFactory: () => ({
				run: (value) =>
					value === "active" ? held.promise : Promise.resolve(value),
			}),
			onEvent: (event) => events.push(event),
		});

		const active = pool.run("run", ["active"]);
		const controller = new AbortController();
		const waiting = pool.run("run", ["waiting"], {
			priority: 3,
			signal: controller.signal,
		});
		await flushMicrotasks();
		expect(pool.getStats()).toMatchObject({
			state: "running",
			maxConcurrentTasks: 1,
			queue: 1,
			queueCapacity: 2,
			queueCapacityRemaining: 1,
			oldestQueuedTaskAgeMs: 0,
			submittedTasks: 2,
			startedTasks: 1,
		});

		jest.advanceTimersByTime(7);
		controller.abort("no longer needed");
		await expect(waiting).rejects.toMatchObject({
			name: "WorkerTaskAbortedError",
		});
		held.resolve("active");
		await expect(active).resolves.toBe("active");
		await flushMicrotasks();

		expect(
			events.map((event) =>
				event.type === "task-settled"
					? `${event.type}:${event.outcome}`
					: event.type,
			),
		).toEqual([
			"task-queued",
			"worker-created",
			"task-started",
			"task-queued",
			"task-settled:aborted",
			"task-settled:fulfilled",
		]);
		const settledEvents = events.filter(
			(event) => event.type === "task-settled",
		);
		expect(settledEvents.map((event) => event.durationMs)).toEqual([7, 7]);
		expect(pool.getStats()).toMatchObject({
			queue: 0,
			oldestQueuedTaskAgeMs: null,
			completedTasks: 1,
			failedTasks: 0,
			cancelledTasks: 1,
			timedOutTasks: 0,
			droppedTasks: 0,
		});

		await pool.close();
		expect(events.at(-1)).toMatchObject({
			type: "worker-removed",
			reason: "shutdown",
		});
		expect(pool.getStats()).toMatchObject({ state: "closed", workers: 0 });
	});

	test("classifies drops, queue timeouts, worker failures, and termination failures", async () => {
		jest.useFakeTimers({ now: 2_000 });
		const held = deferred<string>();
		const events: WorkerPoolEvent[] = [];
		const worker = new ObservedWorker();
		const pool = new WorkerPool<ObservedApi>({
			size: 1,
			maxQueueSize: 1,
			queueOverflowPolicy: "drop-oldest",
			queueTimeoutMs: 10,
			taskTimeoutMs: false,
			terminationRetryAttempts: 0,
			workerFactory: () => worker as unknown as Worker,
			proxyFactory: () => ({ run: () => held.promise }),
			workerTerminator: () => {
				throw new Error("host did not confirm termination");
			},
			onEvent: (event) => events.push(event),
		});

		const active = pool.run("run", ["active"]);
		await flushMicrotasks();
		const dropped = pool.run("run", ["dropped"]);
		const timedOut = pool.run("run", ["timed-out"]);
		await expect(dropped).rejects.toBeInstanceOf(WorkerPoolQueueFullError);
		jest.advanceTimersByTime(10);
		await expect(timedOut).rejects.toBeInstanceOf(WorkerQueueTimeoutError);
		worker.dispatchEvent(new Event("error"));
		await expect(active).rejects.toMatchObject({ name: "WorkerCrashedError" });
		await flushMicrotasks();

		expect(
			events
				.filter((event) => event.type === "task-settled")
				.map((event) => event.outcome),
		).toEqual(["dropped", "queue-timeout", "worker-failure"]);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "worker-removed",
				reason: "failure",
			}),
		);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "worker-termination-failed",
				attempt: 1,
				exhausted: true,
			}),
		);
		expect(pool.getStats()).toMatchObject({
			submittedTasks: 3,
			startedTasks: 1,
			completedTasks: 0,
			failedTasks: 1,
			cancelledTasks: 0,
			timedOutTasks: 1,
			droppedTasks: 1,
			terminationFailures: 1,
		});

		await pool.close();
	});

	test("isolates event observer failures from scheduled work", async () => {
		const pool = new WorkerPool<ObservedApi>({
			size: 1,
			workerFactory: () => new ObservedWorker() as unknown as Worker,
			proxyFactory: () => ({ run: async (value) => value }),
			onEvent: () => {
				throw new Error("observer failed");
			},
		});

		await expect(pool.run("run", ["still works"])).resolves.toBe("still works");
		await pool.close();
	});

	test("remains balanced when an event observer closes the pool reentrantly", async () => {
		jest.useFakeTimers({ now: 3_000 });
		const poolRef: { current?: WorkerPool<ObservedApi> } = {};
		let timersAfterClose = -1;
		const worker = new ObservedWorker();
		const pool = new WorkerPool<ObservedApi>({
			size: 1,
			taskTimeoutMs: 25,
			workerFactory: () => worker as unknown as Worker,
			proxyFactory: () => ({ run: () => new Promise(() => {}) }),
			onEvent: (event) => {
				if (event.type === "task-started") {
					poolRef.current?.terminateAll();
					timersAfterClose = jest.getTimerCount();
				}
			},
		});
		poolRef.current = pool;

		await expect(pool.run("run", ["held"])).rejects.toMatchObject({
			name: "WorkerPoolTerminatedError",
		});
		await pool.terminated;
		expect(worker.terminated).toBe(true);
		expect(pool.getStats()).toMatchObject({
			state: "closed",
			workers: 0,
			runningTasks: 0,
		});
		expect(timersAfterClose).toBe(0);
	});
});
