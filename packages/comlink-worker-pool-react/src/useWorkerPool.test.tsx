import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type UseWorkerPoolOptions, useWorkerPool } from "./useWorkerPool";

// Mock worker implementation for test
class MockWorker {
	terminate() {}
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
			poolSize: 1,
		};
		const { result } = renderHook(() => useWorkerPool(options));
		// Intentionally do not wait for next update (api is null)
		let error: unknown;
		await act(async () => {
			try {
				await result.current.call("add", 1, 2);
			} catch (e) {
				error = e;
			}
		});
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/not initialized/i);
		expect(result.current.status).toBe("error");
	});
});
