import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWorkerPool } from "./useWorkerPool";

class RegressionWorker extends EventTarget {
	terminateCalls = 0;

	terminate(): void {
		this.terminateCalls++;
	}
}

describe("useWorkerPool - regression coverage", () => {
	it("keeps retained calls from obsolete pool generations state-inert", async () => {
		interface Api {
			add(left: number, right: number): Promise<number>;
		}
		const { result, rerender, unmount } = renderHook(
			({ revision }: { revision: number }) =>
				useWorkerPool<Api>({
					poolSize: 1,
					reconfigureKey: revision,
					workerFactory: () => new RegressionWorker() as unknown as Worker,
					proxyFactory: () => ({
						add: async (left, right) => left + right,
					}),
				}),
			{ initialProps: { revision: 0 } },
		);
		await waitFor(() => expect(result.current.poolStatus).toBe("ready"));
		const retainedCall = result.current.call;

		rerender({ revision: 1 });
		await waitFor(() => expect(result.current.poolStatus).toBe("ready"));
		expect(result.current).toMatchObject({
			status: "idle",
			result: null,
			error: null,
		});

		let received: unknown;
		await act(async () => {
			try {
				await retainedCall("add", 1, 2);
			} catch (error) {
				received = error;
			}
		});
		expect(received).toMatchObject({ name: "WorkerPoolTerminatedError" });
		expect(result.current).toMatchObject({
			status: "idle",
			result: null,
			error: null,
		});
		unmount();
	});

	it("stores callable call results without invoking them as React updaters", async () => {
		let invocations = 0;
		const callable = () => {
			invocations++;
			return "invoked";
		};
		interface Api {
			load(): Promise<typeof callable>;
		}
		const { result, unmount } = renderHook(() =>
			useWorkerPool<Api>({
				poolSize: 1,
				workerFactory: () => new RegressionWorker() as unknown as Worker,
				proxyFactory: () => ({ load: async () => callable }),
			}),
		);
		await waitFor(() => expect(result.current.poolStatus).toBe("ready"));

		await act(async () => {
			await expect(result.current.call("load")).resolves.toBe(callable);
		});
		expect(result.current.result).toBe(callable);
		expect(invocations).toBe(0);
		await act(async () => {
			await result.current.close();
		});
		unmount();
	});

	it("stores callable call rejection reasons without invoking them", async () => {
		let invocations = 0;
		const callableError = () => {
			invocations++;
			return "invoked";
		};
		interface Api {
			fail(): Promise<never>;
		}
		const { result, unmount } = renderHook(() =>
			useWorkerPool<Api>({
				poolSize: 1,
				workerFactory: () => new RegressionWorker() as unknown as Worker,
				proxyFactory: () => ({
					fail: () => Promise.reject(callableError),
				}),
			}),
		);
		await waitFor(() => expect(result.current.poolStatus).toBe("ready"));

		let received: unknown;
		await act(async () => {
			try {
				await result.current.call("fail");
			} catch (error) {
				received = error;
			}
		});
		expect(received).toBe(callableError);
		expect(result.current.error).toBe(callableError);
		expect(invocations).toBe(0);
		await act(async () => {
			await result.current.close();
		});
		unmount();
	});
});
