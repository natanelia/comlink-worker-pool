import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useWorkerTask } from "./useWorkerTask";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("useWorkerTask - regression coverage", () => {
	it("preserves the selected API method receiver", async () => {
		interface ReceiverApi {
			helper(): string;
			run(): Promise<string>;
		}
		const api: ReceiverApi = {
			helper: () => "receiver preserved",
			async run() {
				return this.helper();
			},
		};
		const { result, unmount } = renderHook(() => useWorkerTask(api, "run"));

		let value: string | undefined;
		await act(async () => {
			value = await result.current.run();
		});
		expect(value).toBe("receiver preserved");
		expect(result.current.result).toBe("receiver preserved");
		unmount();
	});

	it("keeps retained callbacks state-inert after rebinding", async () => {
		interface TaskApi {
			run(): Promise<string>;
		}
		const oldTask = deferred<string>();
		const oldApi: TaskApi = { run: () => oldTask.promise };
		const newApi: TaskApi = { run: async () => "new" };
		const { result, rerender, unmount } = renderHook(
			({ api }: { api: TaskApi }) => useWorkerTask(api, "run"),
			{ initialProps: { api: oldApi } },
		);
		const retainedRun = result.current.run;
		const retainedReset = result.current.reset;

		rerender({ api: newApi });
		await act(async () => {
			await result.current.run();
		});
		expect(result.current).toMatchObject({
			status: "completed",
			result: "new",
			error: null,
		});

		let retainedPromise!: Promise<string>;
		act(() => {
			retainedPromise = retainedRun();
			retainedReset();
		});
		expect(result.current).toMatchObject({
			status: "completed",
			result: "new",
			error: null,
		});

		await act(async () => {
			oldTask.resolve("old");
			await retainedPromise;
		});
		expect(result.current).toMatchObject({
			status: "completed",
			result: "new",
			error: null,
		});
		unmount();
	});

	it("stores callable results without invoking them as React updaters", async () => {
		let invocations = 0;
		const callable = () => {
			invocations++;
			return "invoked";
		};
		interface CallableApi {
			load(): Promise<typeof callable>;
		}
		const api: CallableApi = { load: async () => callable };
		const { result, unmount } = renderHook(() => useWorkerTask(api, "load"));

		await act(async () => {
			await expect(result.current.run()).resolves.toBe(callable);
		});
		expect(result.current.result).toBe(callable);
		expect(invocations).toBe(0);
		unmount();
	});

	it("stores callable rejection reasons without invoking them", async () => {
		let invocations = 0;
		const callableError = () => {
			invocations++;
			return "invoked";
		};
		interface CallableErrorApi {
			fail(): Promise<never>;
		}
		const api: CallableErrorApi = {
			fail: () => Promise.reject(callableError),
		};
		const { result, unmount } = renderHook(() => useWorkerTask(api, "fail"));

		let received: unknown;
		await act(async () => {
			try {
				await result.current.run();
			} catch (error) {
				received = error;
			}
		});
		expect(received).toBe(callableError);
		expect(result.current.error).toBe(callableError);
		expect(invocations).toBe(0);
		unmount();
	});
});
