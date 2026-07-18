import { afterEach, describe, expect, jest, test } from "bun:test";
import {
	WorkerPool,
	WorkerQueueTimeoutError,
	WorkerTaskTimeoutError,
} from "./WorkerPool";

type ModelApi = {
	run(id: number): Promise<number>;
};

class ModelWorker extends EventTarget {
	terminated = false;

	terminate(): void {
		this.terminated = true;
	}
}

interface Invocation {
	id: number;
	worker: ModelWorker;
	active: boolean;
	resolve: (value: number) => void;
	reject: (reason: unknown) => void;
}

interface Submission {
	id: number;
	controller: AbortController;
	settlements: number;
	outcome?: "fulfilled" | "rejected";
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index++) await Promise.resolve();
}

function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state;
	};
}

afterEach(() => {
	jest.clearAllTimers();
	jest.useRealTimers();
});

describe("WorkerPool - deterministic lifecycle model", () => {
	test("enforces queue, task, and idle deadlines at exact fake-clock boundaries", async () => {
		jest.useFakeTimers({ now: 1_000 });
		const workers: ModelWorker[] = [];
		const invocations: Invocation[] = [];
		const pool = new WorkerPool<ModelApi>({
			size: 1,
			queueTimeoutMs: 20,
			taskTimeoutMs: 50,
			workerIdleTimeoutMs: 30,
			workerFactory: () => {
				const worker = new ModelWorker();
				workers.push(worker);
				return worker as unknown as Worker;
			},
			proxyFactory: (worker) => ({
				run: (id) =>
					new Promise((resolve, reject) => {
						invocations.push({
							id,
							worker: worker as unknown as ModelWorker,
							active: true,
							resolve,
							reject,
						});
					}),
			}),
		});

		const active = pool.run("run", [1]);
		const queued = pool.run("run", [2]);
		await flushMicrotasks();
		expect(pool.getStats()).toMatchObject({ queue: 1, runningTasks: 1 });

		jest.advanceTimersByTime(19);
		await flushMicrotasks();
		expect(pool.getStats().queue).toBe(1);
		jest.advanceTimersByTime(1);
		await expect(queued).rejects.toBeInstanceOf(WorkerQueueTimeoutError);

		jest.advanceTimersByTime(29);
		await flushMicrotasks();
		expect(workers[0].terminated).toBe(false);
		jest.advanceTimersByTime(1);
		await expect(active).rejects.toBeInstanceOf(WorkerTaskTimeoutError);
		expect(workers[0].terminated).toBe(true);
		expect(pool.getStats()).toMatchObject({ workers: 0, runningTasks: 0 });

		const completed = pool.run("run", [3]);
		await flushMicrotasks();
		invocations.at(-1)?.resolve(3);
		await expect(completed).resolves.toBe(3);
		await flushMicrotasks();
		expect(pool.getStats().workers).toBe(1);
		jest.advanceTimersByTime(29);
		expect(pool.getStats().workers).toBe(1);
		jest.advanceTimersByTime(1);
		expect(pool.getStats().workers).toBe(0);

		await pool.close();
	});

	test.each([1, 2, 3, 5, 8, 13, 21, 34, 55, 89])(
		"preserves scheduler invariants for seeded operation sequence %i",
		async (seed) => {
			jest.useFakeTimers({ now: seed * 10_000 });
			const random = createRandom(seed);
			const workers: ModelWorker[] = [];
			const invocations: Invocation[] = [];
			const submissions: Submission[] = [];
			let nextId = 0;
			const size = 3;
			const concurrency = 2;
			const maxQueueSize = 6;
			const pool = new WorkerPool<ModelApi>({
				size,
				maxConcurrentTasksPerWorker: concurrency,
				maxQueueSize,
				queueOverflowPolicy: seed % 2 === 0 ? "drop-oldest" : "reject",
				queueTimeoutMs: 30,
				taskTimeoutMs: 45,
				workerIdleTimeoutMs: 20,
				workerFactory: () => {
					const worker = new ModelWorker();
					workers.push(worker);
					return worker as unknown as Worker;
				},
				proxyFactory: (worker) => ({
					run: (id) =>
						new Promise((resolve, reject) => {
							invocations.push({
								id,
								worker: worker as unknown as ModelWorker,
								active: true,
								resolve,
								reject,
							});
						}),
				}),
			});

			const submit = () => {
				const submission: Submission = {
					id: nextId++,
					controller: new AbortController(),
					settlements: 0,
				};
				submissions.push(submission);
				void pool
					.run("run", [submission.id], {
						priority: (random() % 5) - 2,
						signal: submission.controller.signal,
					})
					.then(
						() => {
							submission.settlements++;
							submission.outcome = "fulfilled";
						},
						() => {
							submission.settlements++;
							submission.outcome = "rejected";
						},
					);
			};

			const reconcileRetiredWorkers = () => {
				for (const invocation of invocations) {
					if (invocation.worker.terminated) invocation.active = false;
				}
			};

			const assertModel = () => {
				reconcileRetiredWorkers();
				const stats = pool.getStats();
				const activeInvocations = invocations.filter(
					(invocation) => invocation.active,
				);
				const activeIds = new Set(
					activeInvocations.map((invocation) => invocation.id),
				);
				const modeledQueue = submissions.filter(
					(submission) =>
						submission.settlements === 0 && !activeIds.has(submission.id),
				).length;

				expect(stats.queue).toBe(modeledQueue);
				expect(stats.runningTasks).toBe(activeInvocations.length);
				expect(stats.queue).toBeLessThanOrEqual(maxQueueSize);
				expect(stats.runningTasks).toBeLessThanOrEqual(size * concurrency);
				expect(stats.healthyWorkers).toBeLessThanOrEqual(size);
				expect(stats.workers).toBe(
					stats.healthyWorkers + stats.quarantinedWorkers,
				);
				expect(stats.idleWorkers).toBeLessThanOrEqual(stats.healthyWorkers);
				expect(stats.availableForConcurrency).toBeLessThanOrEqual(
					stats.healthyWorkers,
				);
				expect(stats.available).toBeLessThanOrEqual(size);
				for (const submission of submissions) {
					expect(submission.settlements).toBeLessThanOrEqual(1);
				}
			};

			for (let step = 0; step < 100; step++) {
				const active = invocations.filter((invocation) => invocation.active);
				const unsettled = submissions.filter(
					(submission) => submission.settlements === 0,
				);
				const liveWorkers = workers.filter((worker) => !worker.terminated);
				switch (random() % 6) {
					case 0:
					case 1:
						submit();
						break;
					case 2: {
						const invocation = active[random() % active.length];
						if (!invocation) {
							submit();
							break;
						}
						invocation.active = false;
						invocation.resolve(invocation.id);
						break;
					}
					case 3: {
						const submission = unsettled[random() % unsettled.length];
						if (submission) submission.controller.abort(`seed-${seed}`);
						else submit();
						break;
					}
					case 4: {
						const worker = liveWorkers[random() % liveWorkers.length];
						if (worker) worker.dispatchEvent(new Event("error"));
						else submit();
						break;
					}
					case 5:
						jest.advanceTimersByTime((random() % 25) + 1);
						break;
				}
				await flushMicrotasks();
				assertModel();
			}

			await pool.close();
			await flushMicrotasks();
			reconcileRetiredWorkers();
			for (const submission of submissions) {
				expect(submission.settlements).toBe(1);
				expect(submission.outcome).toBeDefined();
			}
			expect(invocations.every((invocation) => !invocation.active)).toBe(true);
			expect(pool.getStats()).toMatchObject({
				queue: 0,
				runningTasks: 0,
				workers: 0,
			});
		},
	);
});
