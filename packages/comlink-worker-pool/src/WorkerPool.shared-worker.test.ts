import { describe, expect, test } from "bun:test";
import { WorkerCrashedError, WorkerPool } from "./index";

class TestMessagePort extends EventTarget implements MessagePort {
	onmessage: ((this: MessagePort, ev: MessageEvent) => unknown) | null = null;
	onmessageerror: ((this: MessagePort, ev: MessageEvent) => unknown) | null =
		null;
	closeCalls = 0;

	close(): void {
		this.closeCalls++;
	}

	postMessage(
		_message: unknown,
		_options?: StructuredSerializeOptions | Transferable[],
	): void {}

	start(): void {}
}

class TestSharedWorker extends EventTarget implements SharedWorker {
	onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null;
	readonly port = new TestMessagePort();
}

interface SharedApi {
	run(value: string): Promise<string>;
}

describe("WorkerPool - SharedWorker lifecycle", () => {
	test("closes the connection port during default handle cleanup", async () => {
		const worker = new TestSharedWorker();
		const pool = new WorkerPool<SharedApi>({
			size: 1,
			workerFactory: () => worker,
			proxyFactory: (createdWorker) => {
				expect(createdWorker).toBe(worker);
				return { run: async (value) => value };
			},
		});

		expect(await pool.run("run", ["done"])).toBe("done");
		expect(await pool.close()).toMatchObject({ confirmed: true });
		expect(worker.port.closeCalls).toBe(1);
	});

	test.each([
		["SharedWorker", "error", (worker: TestSharedWorker) => worker],
		[
			"connection port",
			"messageerror",
			(worker: TestSharedWorker) => worker.port,
		],
		["connection port", "close", (worker: TestSharedWorker) => worker.port],
	] as const)(
		"observes failures from the %s",
		async (_name, type, failureTarget) => {
			const worker = new TestSharedWorker();
			const pool = new WorkerPool<SharedApi>({
				size: 1,
				workerFactory: () => worker,
				proxyFactory: () => ({
					run: () => new Promise<string>(() => {}),
				}),
			});

			const pending = pool.run("run", ["pending"]);
			failureTarget(worker).dispatchEvent(new Event(type));

			await expect(pending).rejects.toBeInstanceOf(WorkerCrashedError);
			await pool.close();
			expect(worker.port.closeCalls).toBe(1);
		},
	);
});
