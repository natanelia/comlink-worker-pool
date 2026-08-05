import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
	type ReactNode,
	Suspense,
	startTransition,
	useLayoutEffect,
	useRef,
} from "react";
import { useWorkerPool } from "./useWorkerPool";

class RegressionWorker extends EventTarget {
	terminateCalls = 0;

	terminate(): void {
		this.terminateCalls++;
	}
}

describe("useWorkerPool - regression coverage", () => {
	it("tracks a call started by a later layout effect once the API is ready", async () => {
		interface Api {
			load(): Promise<string>;
		}
		const { result, unmount } = renderHook(() => {
			const pool = useWorkerPool<Api>({
				poolSize: 1,
				workerFactory: () => new RegressionWorker() as unknown as Worker,
				proxyFactory: () => ({ load: async () => "layout" }),
			});
			const startedRef = useRef(false);
			useLayoutEffect(() => {
				if (!pool.api || startedRef.current) return;
				startedRef.current = true;
				void pool.call("load");
			}, [pool.api, pool.call]);
			return pool;
		});

		await waitFor(() => expect(result.current.status).toBe("completed"));
		expect(result.current.result).toBe("layout");
		await act(async () => {
			await result.current.close();
		});
		unmount();
	});

	it("does not publish observers from an abandoned suspended render", async () => {
		interface Api {
			echo(value: string): Promise<string>;
		}
		let releaseSuspension!: () => void;
		let shouldSuspend = true;
		const suspension = new Promise<void>((resolve) => {
			releaseSuspension = resolve;
		});
		const observedLabels: string[] = [];
		const wrapper = ({ children }: { children: ReactNode }) => (
			<Suspense fallback={null}>{children}</Suspense>
		);
		const { result, rerender, unmount } = renderHook(
			({ label, suspend }: { label: string; suspend: boolean }) => {
				const pool = useWorkerPool<Api>({
					poolSize: 1,
					workerFactory: () => new RegressionWorker() as unknown as Worker,
					proxyFactory: () => ({ echo: async (value) => value }),
					onEvent: () => {
						observedLabels.push(label);
					},
				});
				if (suspend && shouldSuspend) throw suspension;
				return { label, pool };
			},
			{
				initialProps: { label: "committed", suspend: false },
				wrapper,
			},
		);
		await waitFor(() => expect(result.current.pool.poolStatus).toBe("ready"));
		const api = result.current.pool.api;
		if (!api) throw new Error("Worker pool API was not initialized");

		act(() => {
			startTransition(() => {
				rerender({ label: "next", suspend: true });
			});
		});
		expect(result.current.label).toBe("committed");

		observedLabels.length = 0;
		await act(async () => {
			await expect(api.echo("first")).resolves.toBe("first");
		});
		expect(observedLabels.length).toBeGreaterThan(0);
		expect(observedLabels.every((label) => label === "committed")).toBe(true);

		shouldSuspend = false;
		await act(async () => {
			releaseSuspension();
			await suspension;
		});
		await waitFor(() => expect(result.current.label).toBe("next"));

		observedLabels.length = 0;
		await act(async () => {
			await expect(api.echo("second")).resolves.toBe("second");
		});
		expect(observedLabels.length).toBeGreaterThan(0);
		expect(observedLabels.every((label) => label === "next")).toBe(true);

		await act(async () => {
			await result.current.pool.close();
		});
		unmount();
	});

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
