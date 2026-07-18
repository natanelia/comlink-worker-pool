import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
	WorkerPoolCapacityError,
	type WorkerTerminationError,
} from "comlink-worker-pool";
import { type ReactNode, StrictMode } from "react";
import { type UseWorkerPoolOptions, useWorkerPool } from "./useWorkerPool";

// Mock worker implementation for test
class MockWorker {
	terminateCalls = 0;
	terminate() {
		this.terminateCalls++;
	}
	addEventListener() {}
	removeEventListener() {}
}

type TestApi = {
	add: (a: number, b: number) => Promise<number>;
	fail: () => Promise<never>;
};

const testApiImpl: TestApi = {
	add: async (a, b) => a + b,
	fail: async () => {
		throw new Error("fail");
	},
};

describe("useWorkerPool", () => {
	it("initializes and returns API", async () => {
		const workerFactory = () => new MockWorker() as unknown as Worker;
		const proxyFactory = () => testApiImpl;
		const options: UseWorkerPoolOptions<TestApi> = {
			workerFactory,
			proxyFactory,
			poolSize: 1,
		};
		const { result } = renderHook(() => useWorkerPool(options));
		// Wait for the hook to reach the desired state
		await waitFor(() => {
			expect(result.current.api).not.toBeNull();
			expect(result.current.status).toBe("idle");
		});
	});

	it("calls worker method and sets result", async () => {
		const workerFactory = () => new MockWorker() as unknown as Worker;
		const proxyFactory = () => testApiImpl;
		const options: UseWorkerPoolOptions<TestApi> = {
			workerFactory,
			proxyFactory,
			poolSize: 1,
		};
		const { result } = renderHook(() => useWorkerPool(options));
		// Wait for the hook to reach the desired state
		await waitFor(() => {
			expect(result.current.api).not.toBeNull();
		});
		let value: number | undefined;
		await act(async () => {
			value = await result.current.call("add", 2, 3);
		});
		expect(value).toBe(5);
		expect(result.current.result).toBe(5);
		expect(result.current.status).toBe("completed");
	});

	it("handles worker errors", async () => {
		const workerFactory = () => new MockWorker() as unknown as Worker;
		const proxyFactory = () => testApiImpl;
		const options: UseWorkerPoolOptions<TestApi> = {
			workerFactory,
			proxyFactory,
			poolSize: 1,
		};
		const { result } = renderHook(() => useWorkerPool(options));
		// Wait for the hook to reach the desired state
		await waitFor(() => {
			expect(result.current.api).not.toBeNull();
		});
		let error: unknown;
		await act(async () => {
			try {
				await result.current.call("fail");
			} catch (e) {
				error = e;
			}
		});
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("fail");
		expect(result.current.status).toBe("error");
		expect(result.current.error).toBeInstanceOf(Error);
	});

	it("returns error if pool is not initialized", async () => {
		const workerFactory = () => new MockWorker() as unknown as Worker;
		const proxyFactory = () => testApiImpl;
		const options: UseWorkerPoolOptions<TestApi> = {
			workerFactory,
			proxyFactory,
			poolSize: 0,
		};
		const { result } = renderHook(() => useWorkerPool(options));
		await waitFor(() => {
			expect(result.current.status).toBe("error");
			expect(result.current.api).toBeNull();
		});
		expect(result.current.error).toBeInstanceOf(RangeError);
		let callError: unknown;
		await act(async () => {
			try {
				await result.current.call("add", 1, 2);
			} catch (error) {
				callError = error;
			}
		});
		expect(callError).toBeInstanceOf(Error);
		expect((callError as Error).message).toMatch(/not initialized/i);
	});

	it("does not recreate the pool when inline factory identities change", async () => {
		const workers: MockWorker[] = [];
		const { result, rerender, unmount } = renderHook(() =>
			useWorkerPool<TestApi>({
				poolSize: 1,
				workerFactory: () => {
					const worker = new MockWorker();
					workers.push(worker);
					return worker as unknown as Worker;
				},
				proxyFactory: () => testApiImpl,
			}),
		);
		await waitFor(() => expect(result.current.api).not.toBeNull());
		const firstApi = result.current.api;

		rerender();
		rerender();
		expect(result.current.api).toBe(firstApi);
		await act(async () => {
			await result.current.call("add", 1, 2);
		});
		expect(workers).toHaveLength(1);
		unmount();
		expect(workers[0].terminateCalls).toBe(1);
	});

	it("rejects retained calls after unmount without creating zombie workers", async () => {
		let workerCreations = 0;
		const { result, unmount } = renderHook(() =>
			useWorkerPool<TestApi>({
				poolSize: 1,
				workerFactory: () => {
					workerCreations++;
					return new MockWorker() as unknown as Worker;
				},
				proxyFactory: () => testApiImpl,
			}),
		);
		await waitFor(() => expect(result.current.api).not.toBeNull());
		const retainedApi = result.current.api as TestApi;
		const retainedCall = result.current.call;
		unmount();

		await expect(retainedApi.add(1, 2)).rejects.toThrow(/terminated/i);
		await expect(retainedCall("add", 1, 2)).rejects.toThrow(/terminated/i);
		expect(workerCreations).toBe(0);
	});

	it("keeps state owned by the latest-started overlapping call", async () => {
		let resolveFirst!: (value: number) => void;
		let resolveSecond!: (value: number) => void;
		const first = new Promise<number>((resolve) => {
			resolveFirst = resolve;
		});
		const second = new Promise<number>((resolve) => {
			resolveSecond = resolve;
		});
		let invocation = 0;
		const { result } = renderHook(() =>
			useWorkerPool<{
				run(): Promise<number>;
			}>({
				poolSize: 1,
				maxConcurrentTasksPerWorker: 2,
				workerFactory: () => new MockWorker() as unknown as Worker,
				proxyFactory: () => ({
					run: () => (++invocation === 1 ? first : second),
				}),
			}),
		);
		await waitFor(() => expect(result.current.api).not.toBeNull());
		let firstCall!: Promise<number>;
		let secondCall!: Promise<number>;
		act(() => {
			firstCall = result.current.call("run");
			secondCall = result.current.call("run");
		});

		await act(async () => {
			resolveSecond(2);
			await secondCall;
		});
		expect(result.current.result).toBe(2);
		await act(async () => {
			resolveFirst(1);
			await firstCall;
		});
		expect(result.current.result).toBe(2);
		expect(result.current.status).toBe("completed");
	});

	it("is balanced under React StrictMode", async () => {
		const workers: MockWorker[] = [];
		const wrapper = ({ children }: { children: ReactNode }) => (
			<StrictMode>{children}</StrictMode>
		);
		const { result, unmount } = renderHook(
			() =>
				useWorkerPool<TestApi>({
					poolSize: 1,
					workerFactory: () => {
						const worker = new MockWorker();
						workers.push(worker);
						return worker as unknown as Worker;
					},
					proxyFactory: () => testApiImpl,
				}),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.api).not.toBeNull());
		await act(async () => {
			await result.current.call("add", 2, 2);
		});
		expect(workers).toHaveLength(1);
		unmount();
		expect(workers[0].terminateCalls).toBe(1);
	});

	it("forwards bounded termination controls and failure callbacks", async () => {
		const workers: MockWorker[] = [];
		const terminationErrors: WorkerTerminationError[] = [];
		const { result, unmount } = renderHook(() =>
			useWorkerPool<TestApi>({
				poolSize: 1,
				maxTasksPerWorker: 1,
				terminationFailureWorkerBuffer: 0,
				terminationRetryAttempts: 0,
				workerFactory: () => {
					const worker = new MockWorker();
					workers.push(worker);
					return worker as unknown as Worker;
				},
				proxyFactory: () => testApiImpl,
				workerTerminator: () => {
					throw new Error("host termination failed");
				},
				onWorkerTerminationError: (error) => terminationErrors.push(error),
			}),
		);
		await waitFor(() => expect(result.current.api).not.toBeNull());

		await act(async () => {
			await expect(result.current.call("add", 1, 2)).resolves.toBe(3);
		});
		let capacityError: unknown;
		await act(async () => {
			try {
				await result.current.call("add", 3, 4);
			} catch (error) {
				capacityError = error;
			}
		});

		expect(capacityError).toBeInstanceOf(WorkerPoolCapacityError);
		expect(workers).toHaveLength(1);
		expect(terminationErrors).toHaveLength(1);
		expect(terminationErrors[0]).toMatchObject({
			attempt: 1,
			exhausted: true,
		});
		unmount();
	});
});
