import { describe, expect, test } from "bun:test";
import {
	WorkerCrashedError,
	WorkerPool,
	WorkerPoolCapacityError,
	WorkerPoolTerminatedError,
	WorkerTaskTimeoutError,
	type WorkerTerminationError,
} from "./WorkerPool";

class ControlledWorker extends EventTarget {
	terminateCalls = 0;

	terminate(): void {
		this.terminateCalls++;
	}
}

class PartialListenerWorker extends ControlledWorker {
	readonly activeListenerTypes = new Set<string>();

	override addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		if (type === "messageerror") throw new Error("listener setup failed");
		super.addEventListener(type, callback, options);
		this.activeListenerTypes.add(type);
	}

	override removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	): void {
		super.removeEventListener(type, callback, options);
		this.activeListenerTypes.delete(type);
	}
}

class ThrowingTerminationWorker extends ControlledWorker {
	terminationSucceeded = false;
	private readonly succeedOnCall: number | undefined;
	private readonly callWaiters = new Map<number, () => void>();

	constructor(succeedOnCall?: number) {
		super();
		this.succeedOnCall = succeedOnCall;
	}

	override terminate(): void {
		super.terminate();
		this.callWaiters.get(this.terminateCalls)?.();
		if (
			this.succeedOnCall === undefined ||
			this.terminateCalls < this.succeedOnCall
		) {
			throw new Error("termination unconfirmed");
		}
		this.terminationSucceeded = true;
	}

	waitForCalls(count: number): Promise<void> {
		if (this.terminateCalls >= count) return Promise.resolve();
		return new Promise((resolve) => this.callWaiters.set(count, resolve));
	}
}

class ReentrantListenerWorker extends ThrowingTerminationWorker {
	onFirstListenerRemoval?: () => void;
	private didReenter = false;

	override removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	): void {
		super.removeEventListener(type, callback, options);
		if (this.didReenter) return;
		this.didReenter = true;
		this.onFirstListenerRemoval?.();
	}
}

function asWorker(worker: ControlledWorker): Worker {
	return worker as unknown as Worker;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("WorkerPool - lifecycle robustness", () => {
	test("recovers capacity after synchronous throws and supports raw values", async () => {
		const worker = new ControlledWorker();
		const pool = new WorkerPool({
			size: 1,
			workerFactory: () => asWorker(worker),
			proxyFactory: () => ({
				throwSync: () => {
					throw new Error("sync failure");
				},
				rawValue: () => 42,
				echo: async (value: string) => value,
			}),
		});
		const api = pool.getApi();

		await expect(api.throwSync()).rejects.toThrow("sync failure");
		expect(pool.getStats()).toMatchObject({ queue: 0, runningTasks: 0 });
		await expect(api.rawValue()).resolves.toBe(42);
		await expect(api.echo("still usable")).resolves.toBe("still usable");
		pool.terminateAll();
	});

	test("termination rejects active and queued work and ignores late completion", async () => {
		const held = deferred<string>();
		const workers: ControlledWorker[] = [];
		const pool = new WorkerPool({
			size: 1,
			workerFactory: () => {
				const worker = new ControlledWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => ({
				run: (value: string) =>
					value === "held" ? held.promise : Promise.resolve(value),
			}),
		});
		const api = pool.getApi();
		const active = api.run("held");
		const queued = api.run("queued");
		await flushMicrotasks();
		expect(pool.getStats()).toMatchObject({ queue: 1, runningTasks: 1 });

		pool.terminateAll();
		const results = await Promise.allSettled([active, queued]);
		expect(results.every((result) => result.status === "rejected")).toBe(true);
		for (const result of results) {
			if (result.status === "rejected") {
				expect(result.reason).toBeInstanceOf(WorkerPoolTerminatedError);
			}
		}

		held.resolve("late");
		await flushMicrotasks();
		expect(pool.getStats()).toEqual({
			state: "closed",
			size: 1,
			maxConcurrentTasks: 1,
			available: 0,
			queue: 0,
			queueCapacity: null,
			queueCapacityRemaining: null,
			oldestQueuedTaskAgeMs: null,
			workers: 0,
			healthyWorkers: 0,
			quarantinedWorkers: 0,
			terminationFailureWorkerBuffer: 2,
			terminationFailures: 0,
			idleWorkers: 0,
			runningTasks: 0,
			availableForConcurrency: 0,
			submittedTasks: 2,
			startedTasks: 1,
			completedTasks: 0,
			failedTasks: 2,
			cancelledTasks: 0,
			timedOutTasks: 0,
			droppedTasks: 0,
		});
		await expect(api.run("after close")).rejects.toBeInstanceOf(
			WorkerPoolTerminatedError,
		);
		expect(workers).toHaveLength(1);
		expect(workers[0].terminateCalls).toBe(1);
	});

	test("a crash rejects owned tasks, terminates the worker, and drains on a replacement", async () => {
		const oldFirst = deferred<string>();
		const oldSecond = deferred<string>();
		const workers: ControlledWorker[] = [];
		const pool = new WorkerPool({
			size: 1,
			maxConcurrentTasksPerWorker: 2,
			workerFactory: () => {
				const worker = new ControlledWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: (worker) => {
				const index = workers.findIndex(
					(candidate) => asWorker(candidate) === worker,
				);
				return {
					run: (value: string) => {
						if (index > 0) return Promise.resolve(value);
						return value === "old-1" ? oldFirst.promise : oldSecond.promise;
					},
				};
			},
		});
		const api = pool.getApi();
		const first = api.run("old-1");
		const second = api.run("old-2");
		const queued = api.run("replacement");
		await flushMicrotasks();
		expect(pool.getStats()).toMatchObject({ queue: 1, runningTasks: 2 });

		workers[0].dispatchEvent(new Event("error"));
		const [firstResult, secondResult, queuedResult] = await Promise.allSettled([
			first,
			second,
			queued,
		]);
		expect(firstResult.status).toBe("rejected");
		expect(secondResult.status).toBe("rejected");
		if (firstResult.status === "rejected") {
			expect(firstResult.reason).toBeInstanceOf(WorkerCrashedError);
		}
		expect(queuedResult).toEqual({
			status: "fulfilled",
			value: "replacement",
		});
		expect(workers).toHaveLength(2);
		expect(workers[0].terminateCalls).toBe(1);

		oldFirst.resolve("late-1");
		oldSecond.resolve("late-2");
		await flushMicrotasks();
		expect(pool.getStats()).toMatchObject({
			workers: 1,
			idleWorkers: 1,
			runningTasks: 0,
			queue: 0,
		});
		pool.terminateAll();
	});

	test("factory failures reject without ghost execution and clean partial workers", async () => {
		let attempts = 0;
		const executed: string[] = [];
		const pool = new WorkerPool({
			size: 1,
			workerFactory: () => {
				attempts++;
				if (attempts === 1) throw new Error("factory failed");
				return asWorker(new ControlledWorker());
			},
			proxyFactory: () => ({
				run: async (value: string) => {
					executed.push(value);
					return value;
				},
			}),
		});
		const api = pool.getApi();
		await expect(api.run("first")).rejects.toThrow("factory failed");
		await expect(api.run("second")).resolves.toBe("second");
		expect(executed).toEqual(["second"]);
		pool.terminateAll();

		const partialWorker = new ControlledWorker();
		const proxyFailurePool = new WorkerPool({
			size: 1,
			workerFactory: () => asWorker(partialWorker),
			proxyFactory: () => {
				throw new Error("proxy failed");
			},
		});
		const failedApi = proxyFailurePool.getApi() as {
			run(): Promise<unknown>;
		};
		await expect(failedApi.run()).rejects.toThrow("proxy failed");
		expect(partialWorker.terminateCalls).toBe(1);
		expect(proxyFailurePool.getStats()).toMatchObject({
			workers: 0,
			queue: 0,
		});
		proxyFailurePool.terminateAll();
	});

	test("partial listener setup unwinds every listener already registered", async () => {
		const worker = new PartialListenerWorker();
		const pool = new WorkerPool({
			size: 1,
			workerFactory: () => asWorker(worker),
			proxyFactory: () => ({ run: async () => undefined }),
		});

		await expect(pool.getApi().run()).rejects.toThrow("listener setup failed");
		expect(worker.activeListenerTypes.size).toBe(0);
		expect(worker.terminateCalls).toBe(1);
		expect(pool.getStats()).toMatchObject({ workers: 0, queue: 0 });
		pool.terminateAll();
	});

	test("termination reentered from worker construction cannot leak a worker", async () => {
		const worker = new ControlledWorker();
		const holder: {
			pool?: WorkerPool<{ run(): Promise<void> }>;
		} = {};
		const pool = new WorkerPool({
			size: 1,
			workerFactory: () => {
				holder.pool?.terminateAll();
				return asWorker(worker);
			},
			proxyFactory: () => ({
				run: async (): Promise<void> => undefined,
			}),
		});
		holder.pool = pool;

		await expect(pool.getApi().run()).rejects.toBeInstanceOf(
			WorkerPoolTerminatedError,
		);
		expect(worker.terminateCalls).toBe(1);
		expect(pool.getStats()).toMatchObject({
			available: 0,
			workers: 0,
			queue: 0,
			runningTasks: 0,
		});
	});

	test("task timeout recycles a silently wedged worker", async () => {
		const workers: ControlledWorker[] = [];
		const never = new Promise<string>(() => {});
		const pool = new WorkerPool({
			size: 1,
			taskTimeoutMs: 20,
			workerFactory: () => {
				const worker = new ControlledWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: (worker) => {
				const isFirst = worker === asWorker(workers[0]);
				return {
					run: (value: string) => (isFirst ? never : Promise.resolve(value)),
				};
			},
		});
		const api = pool.getApi();
		const timedOut = api.run("stuck");
		const queued = api.run("recovered");

		await expect(timedOut).rejects.toBeInstanceOf(WorkerTaskTimeoutError);
		await expect(queued).resolves.toBe("recovered");
		expect(workers).toHaveLength(2);
		expect(workers[0].terminateCalls).toBe(1);
		pool.terminateAll();
	});

	test("task retirement is strict and never exceeds the physical size cap", async () => {
		const firstTask = deferred<string>();
		const workers: ControlledWorker[] = [];
		let liveWorkers = 0;
		let peakLiveWorkers = 0;
		const pool = new WorkerPool({
			size: 1,
			maxTasksPerWorker: 1,
			maxConcurrentTasksPerWorker: 3,
			workerFactory: () => {
				const worker = new ControlledWorker();
				const terminate = worker.terminate.bind(worker);
				worker.terminate = () => {
					liveWorkers--;
					terminate();
				};
				workers.push(worker);
				liveWorkers++;
				peakLiveWorkers = Math.max(peakLiveWorkers, liveWorkers);
				return asWorker(worker);
			},
			proxyFactory: (worker) => ({
				run: (value: string) =>
					worker === asWorker(workers[0])
						? firstTask.promise
						: Promise.resolve(value),
			}),
		});
		const api = pool.getApi();
		const first = api.run("first");
		const second = api.run("second");
		await flushMicrotasks();
		expect(pool.getStats()).toMatchObject({
			workers: 1,
			runningTasks: 1,
			queue: 1,
		});

		firstTask.resolve("first");
		await expect(first).resolves.toBe("first");
		await expect(second).resolves.toBe("second");
		expect(peakLiveWorkers).toBe(1);
		expect(workers).toHaveLength(2);
		pool.terminateAll();
	});

	test("retires an expired idle worker without waiting for another task", async () => {
		const workers: ControlledWorker[] = [];
		const pool = new WorkerPool({
			size: 1,
			maxWorkerLifetimeMs: 15,
			workerFactory: () => {
				const worker = new ControlledWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => ({
				echo: async (value: string) => value,
			}),
		});
		const api = pool.getApi();
		await expect(api.echo("first")).resolves.toBe("first");
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(pool.getStats().workers).toBe(0);
		await expect(api.echo("second")).resolves.toBe("second");
		expect(workers).toHaveLength(2);
		pool.terminateAll();
	});

	test("observer failures cannot reject work and the API is not thenable", async () => {
		let workerCreations = 0;
		const pool = new WorkerPool({
			size: 1,
			onUpdateStats: () => {
				throw new Error("observer failed");
			},
			workerFactory: () => {
				workerCreations++;
				return asWorker(new ControlledWorker());
			},
			proxyFactory: () => ({ echo: async (value: string) => value }),
		});
		const api = pool.getApi();
		expect(await Promise.resolve(api)).toBe(api);
		expect(workerCreations).toBe(0);
		await expect(api.echo("ok")).resolves.toBe("ok");
		pool.terminateAll();
	});

	test("default termination failure buffer is max(2, floor(size / 2))", async () => {
		for (const { size, buffer } of [
			{ size: 1, buffer: 2 },
			{ size: 6, buffer: 3 },
		]) {
			const workers: ThrowingTerminationWorker[] = [];
			const pool = new WorkerPool({
				size,
				maxTasksPerWorker: 1,
				taskTimeoutMs: false,
				terminationRetryAttempts: 0,
				workerFactory: () => {
					const worker = new ThrowingTerminationWorker();
					workers.push(worker);
					return asWorker(worker);
				},
				proxyFactory: () => ({
					run: async (value: number) => value,
				}),
			});
			const api = pool.getApi();
			const physicalLimit = size + buffer;

			for (let value = 0; value < physicalLimit; value++) {
				await expect(api.run(value)).resolves.toBe(value);
			}
			await expect(api.run(physicalLimit)).rejects.toBeInstanceOf(
				WorkerPoolCapacityError,
			);
			expect(workers).toHaveLength(physicalLimit);
			expect(pool.getStats()).toMatchObject({
				workers: physicalLimit,
				healthyWorkers: 0,
				quarantinedWorkers: physicalLimit,
				terminationFailureWorkerBuffer: buffer,
				terminationFailures: physicalLimit,
			});
			pool.terminateAll();
			await expect(api.run(-1)).rejects.toBeInstanceOf(
				WorkerPoolTerminatedError,
			);
		}
	});

	test("failed termination preserves capacity through the buffer, then degrades without overshoot", async () => {
		const controls = new Map([
			["first", deferred<string>()],
			["second", deferred<string>()],
			["third", deferred<string>()],
		]);
		const workers: ThrowingTerminationWorker[] = [];
		const pool = new WorkerPool({
			size: 2,
			terminationFailureWorkerBuffer: 1,
			maxTasksPerWorker: 1,
			taskTimeoutMs: false,
			terminationRetryAttempts: 0,
			workerFactory: () => {
				const worker = new ThrowingTerminationWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => ({
				run: (value: string) =>
					controls.get(value)?.promise ?? Promise.resolve(value),
			}),
		});
		const api = pool.getApi();
		const first = api.run("first");
		const second = api.run("second");
		const third = api.run("third");
		const fourth = api.run("fourth");
		const fourthResult = fourth.catch((error: unknown) => error);
		await flushMicrotasks();
		expect(workers).toHaveLength(2);

		controls.get("first")?.resolve("first");
		await expect(first).resolves.toBe("first");
		await flushMicrotasks();
		expect(workers).toHaveLength(3);
		expect(pool.getStats()).toMatchObject({
			workers: 3,
			healthyWorkers: 2,
			quarantinedWorkers: 1,
			queue: 1,
		});

		controls.get("second")?.resolve("second");
		await expect(second).resolves.toBe("second");
		await flushMicrotasks();
		expect(workers).toHaveLength(3);
		expect(pool.getStats()).toMatchObject({
			workers: 3,
			healthyWorkers: 1,
			quarantinedWorkers: 2,
			queue: 1,
		});

		controls.get("third")?.resolve("third");
		await expect(third).resolves.toBe("third");
		expect(await fourthResult).toBeInstanceOf(WorkerPoolCapacityError);
		expect(workers).toHaveLength(3);
		expect(pool.getStats()).toMatchObject({
			workers: 3,
			healthyWorkers: 0,
			quarantinedWorkers: 3,
			queue: 0,
		});
		pool.terminateAll();
	});

	test("listener cleanup reentrancy cannot create beyond the physical cap", async () => {
		const workers: ControlledWorker[] = [];
		let reentrantResult: Promise<unknown> | undefined;
		const holder: { api?: { run(value: string): Promise<string> } } = {};
		const pool = new WorkerPool({
			size: 1,
			terminationFailureWorkerBuffer: 0,
			maxTasksPerWorker: 1,
			taskTimeoutMs: false,
			terminationRetryAttempts: 0,
			workerFactory: () => {
				const worker = new ReentrantListenerWorker();
				worker.onFirstListenerRemoval = () => {
					reentrantResult = holder.api
						?.run("reentrant")
						.catch((error) => error);
				};
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => ({
				run: async (value: string) => value,
			}),
		});
		const api = pool.getApi();
		holder.api = api;

		await expect(api.run("first")).resolves.toBe("first");
		expect(reentrantResult).toBeDefined();
		expect(await reentrantResult).toBeInstanceOf(WorkerPoolCapacityError);
		expect(workers).toHaveLength(1);
		expect(pool.getStats()).toMatchObject({
			workers: 1,
			healthyWorkers: 0,
			quarantinedWorkers: 1,
		});
		pool.terminateAll();
	});

	test("a successful termination retry frees buffer capacity and restores service", async () => {
		const firstControl = deferred<string>();
		const secondControl = deferred<string>();
		const workers: ControlledWorker[] = [];
		const pool = new WorkerPool({
			size: 1,
			terminationFailureWorkerBuffer: 1,
			maxTasksPerWorker: 1,
			taskTimeoutMs: false,
			terminationRetryAttempts: 1,
			terminationRetryDelayMs: 1,
			workerFactory: () => {
				const worker =
					workers.length < 2
						? new ThrowingTerminationWorker(2)
						: new ControlledWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => ({
				run: (value: string) => {
					if (value === "first") return firstControl.promise;
					if (value === "second") return secondControl.promise;
					return Promise.resolve(value);
				},
			}),
		});
		const api = pool.getApi();
		const first = api.run("first");
		const second = api.run("second");
		const third = api.run("third");
		await flushMicrotasks();

		firstControl.resolve("first");
		await expect(first).resolves.toBe("first");
		expect(workers).toHaveLength(2);
		await (workers[0] as ThrowingTerminationWorker).waitForCalls(2);
		expect(pool.getStats().quarantinedWorkers).toBe(0);
		expect(workers).toHaveLength(2);

		secondControl.resolve("second");
		await expect(second).resolves.toBe("second");
		await expect(third).resolves.toBe("third");
		await (workers[1] as ThrowingTerminationWorker).waitForCalls(2);
		expect(workers).toHaveLength(3);
		expect(pool.getStats()).toMatchObject({
			healthyWorkers: 0,
			quarantinedWorkers: 0,
		});
		pool.terminateAll();
	});

	test("a stateful PromiseLike cannot falsely confirm termination", async () => {
		let thenReads = 0;
		let thenCalls = 0;
		const statefulThenable = Object.create(null) as Record<string, unknown>;
		// biome-ignore lint/suspicious/noThenProperty: deliberately adversarial thenable regression.
		Object.defineProperty(statefulThenable, "then", {
			get: () => {
				thenReads++;
				if (thenReads > 1) return undefined;
				return () => {
					thenCalls++;
				};
			},
		});
		const workers: ControlledWorker[] = [];
		const pool = new WorkerPool({
			size: 1,
			terminationFailureWorkerBuffer: 0,
			maxTasksPerWorker: 1,
			taskTimeoutMs: false,
			terminationRetryAttempts: 0,
			terminationAttemptTimeoutMs: 10,
			workerFactory: () => {
				const worker = new ControlledWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => ({
				run: async (value: string) => value,
			}),
			workerTerminator: () =>
				statefulThenable as unknown as PromiseLike<unknown>,
		});
		const api = pool.getApi();
		const first = api.run("first");
		const blocked = api.run("blocked");

		await expect(first).resolves.toBe("first");
		await expect(blocked).rejects.toBeInstanceOf(WorkerPoolCapacityError);
		expect(thenReads).toBe(1);
		expect(thenCalls).toBe(1);
		expect(workers).toHaveLength(1);
		expect(pool.getStats()).toMatchObject({
			workers: 1,
			healthyWorkers: 0,
			quarantinedWorkers: 1,
		});
		pool.terminateAll();
	});

	test("an asynchronous terminator deadline exhausts capacity instead of hanging the queue", async () => {
		const errors: WorkerTerminationError[] = [];
		const never = new Promise<void>(() => {});
		const pool = new WorkerPool({
			size: 1,
			terminationFailureWorkerBuffer: 0,
			maxTasksPerWorker: 1,
			taskTimeoutMs: false,
			terminationRetryAttempts: 0,
			terminationAttemptTimeoutMs: 10,
			workerFactory: () => asWorker(new ControlledWorker()),
			proxyFactory: () => ({
				run: async (value: string) => value,
			}),
			workerTerminator: () => never,
			onWorkerTerminationError: (error) => errors.push(error),
		});
		const api = pool.getApi();
		const first = api.run("first");
		const blocked = api.run("blocked");

		await expect(first).resolves.toBe("first");
		await expect(blocked).rejects.toBeInstanceOf(WorkerPoolCapacityError);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ attempt: 1, exhausted: true });
		expect(pool.getStats()).toMatchObject({
			workers: 1,
			healthyWorkers: 0,
			quarantinedWorkers: 1,
			terminationFailures: 1,
		});
		pool.terminateAll();
	});

	test("an asynchronous terminator frees capacity only after confirmation", async () => {
		const confirmations: ReturnType<typeof deferred<void>>[] = [];
		const workers: ControlledWorker[] = [];
		const pool = new WorkerPool({
			size: 1,
			terminationFailureWorkerBuffer: 0,
			maxTasksPerWorker: 1,
			taskTimeoutMs: false,
			workerFactory: () => {
				const worker = new ControlledWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => ({
				run: async (value: string) => value,
			}),
			workerTerminator: () => {
				const confirmation = deferred<void>();
				confirmations.push(confirmation);
				return confirmation.promise;
			},
		});
		const api = pool.getApi();
		const first = api.run("first");
		const second = api.run("second");

		await expect(first).resolves.toBe("first");
		await flushMicrotasks();
		expect(workers).toHaveLength(1);
		expect(pool.getStats()).toMatchObject({
			workers: 1,
			healthyWorkers: 0,
			quarantinedWorkers: 1,
			queue: 1,
		});

		confirmations[0].resolve();
		await expect(second).resolves.toBe("second");
		expect(workers).toHaveLength(2);
		confirmations[1].resolve();
		await flushMicrotasks();
		expect(pool.getStats()).toMatchObject({
			workers: 0,
			healthyWorkers: 0,
			quarantinedWorkers: 0,
		});
		pool.terminateAll();
	});

	test("partial construction failures consume the bounded termination budget", async () => {
		const workers: ThrowingTerminationWorker[] = [];
		const pool = new WorkerPool({
			size: 1,
			terminationFailureWorkerBuffer: 0,
			terminationRetryAttempts: 0,
			workerFactory: () => {
				const worker = new ThrowingTerminationWorker();
				workers.push(worker);
				return asWorker(worker);
			},
			proxyFactory: () => {
				throw new Error("proxy failed");
			},
		});
		const api = pool.getApi() as { run(): Promise<unknown> };

		await expect(api.run()).rejects.toThrow("proxy failed");
		expect(pool.getStats()).toMatchObject({
			workers: 1,
			healthyWorkers: 0,
			quarantinedWorkers: 1,
		});
		await expect(api.run()).rejects.toBeInstanceOf(WorkerPoolCapacityError);
		expect(workers).toHaveLength(1);
		pool.terminateAll();
	});

	test("rejects invalid numeric configuration", () => {
		const makeOptions = () => ({
			size: 1,
			workerFactory: () => asWorker(new ControlledWorker()),
			proxyFactory: () => ({ run: async () => undefined }),
		});

		for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => new WorkerPool({ ...makeOptions(), size })).toThrow();
		}
		for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				() =>
					new WorkerPool({
						...makeOptions(),
						maxConcurrentTasksPerWorker: value,
					}),
			).toThrow();
			expect(
				() => new WorkerPool({ ...makeOptions(), maxTasksPerWorker: value }),
			).toThrow();
		}
		expect(
			() =>
				new WorkerPool({
					...makeOptions(),
					size: Number.MAX_SAFE_INTEGER,
					maxConcurrentTasksPerWorker: 2,
				}),
		).toThrow(/safe integer/);
		for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				() => new WorkerPool({ ...makeOptions(), workerIdleTimeoutMs: value }),
			).toThrow();
			expect(
				() => new WorkerPool({ ...makeOptions(), maxWorkerLifetimeMs: value }),
			).toThrow();
			expect(
				() => new WorkerPool({ ...makeOptions(), taskTimeoutMs: value }),
			).toThrow();
		}
		for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				() =>
					new WorkerPool({
						...makeOptions(),
						terminationFailureWorkerBuffer: value,
					}),
			).toThrow();
			expect(
				() =>
					new WorkerPool({
						...makeOptions(),
						terminationRetryAttempts: value,
					}),
			).toThrow();
		}
		for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				() =>
					new WorkerPool({
						...makeOptions(),
						terminationRetryDelayMs: value,
					}),
			).toThrow();
			expect(
				() =>
					new WorkerPool({
						...makeOptions(),
						terminationAttemptTimeoutMs: value,
					}),
			).toThrow();
		}
		expect(
			() =>
				new WorkerPool({
					...makeOptions(),
					terminationFailureWorkerBuffer: 0,
					terminationRetryAttempts: 0,
				}),
		).not.toThrow();
		expect(
			() => new WorkerPool({ ...makeOptions(), taskTimeoutMs: false }),
		).not.toThrow();
	});
});
