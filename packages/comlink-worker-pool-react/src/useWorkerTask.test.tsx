import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWorkerPool } from "./useWorkerPool";
import { useWorkerTask } from "./useWorkerTask";

class TaskWorker extends EventTarget {
	terminate(): void {}
}

describe("useWorkerTask", () => {
	it("infers method arguments and result state", async () => {
		type Api = {
			add(left: number, right: number): Promise<number>;
			label(value: number): Promise<string>;
		};
		const { result } = renderHook(() => {
			const pool = useWorkerPool<Api>({
				poolSize: 1,
				workerFactory: () => new TaskWorker() as unknown as Worker,
				proxyFactory: () => ({
					add: async (left, right) => left + right,
					label: async (value) => `value-${value}`,
				}),
			});
			const task = useWorkerTask(pool.api, "add");
			return { pool, task };
		});
		await waitFor(() => expect(result.current.pool.poolStatus).toBe("ready"));

		let value: number | undefined;
		await act(async () => {
			value = await result.current.task.run(2, 5);
		});
		const typedResult: number | null = result.current.task.result;
		expect(value).toBe(7);
		expect(typedResult).toBe(7);
		expect(result.current.task.status).toBe("completed");

		act(() => result.current.task.reset());
		expect(result.current.task).toMatchObject({
			status: "idle",
			result: null,
			error: null,
		});
	});

	it("keeps state from the latest-started overlapping invocation", async () => {
		let resolveFirst!: (value: number) => void;
		let resolveSecond!: (value: number) => void;
		const first = new Promise<number>((resolve) => {
			resolveFirst = resolve;
		});
		const second = new Promise<number>((resolve) => {
			resolveSecond = resolve;
		});
		let invocation = 0;
		const api = {
			run: () => (++invocation === 1 ? first : second),
		};
		const { result, unmount } = renderHook(() => useWorkerTask(api, "run"));
		let firstCall!: Promise<number>;
		let secondCall!: Promise<number>;
		act(() => {
			firstCall = result.current.run();
			secondCall = result.current.run();
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
		unmount();
	});
});
