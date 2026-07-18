import { wrap } from "comlink";
import { WorkerPool } from "comlink-worker-pool";
import { useWorkerPool } from "comlink-worker-pool-react";
import { StrictMode, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { BrowserWorkerApi } from "./worker";

const createWorker = () =>
	new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const createProxy = (worker: Worker) => wrap<BrowserWorkerApi>(worker);

async function parallelCalls() {
	const pool = new WorkerPool<BrowserWorkerApi>({
		size: 2,
		workerFactory: createWorker,
		proxyFactory: createProxy,
	});
	const values = await Promise.all(
		["a", "b", "c", "d"].map((value) => pool.run("delayEcho", [value, 20])),
	);
	const report = await pool.close();
	return { report, values };
}

async function recover(method: "crash" | "hang") {
	let workersCreated = 0;
	const pool = new WorkerPool<BrowserWorkerApi>({
		size: 1,
		// Leave enough headroom for a cold worker start in slower engines while
		// still keeping the deliberately wedged call bounded.
		taskTimeoutMs: 300,
		workerFactory: () => {
			workersCreated++;
			return createWorker();
		},
		proxyFactory: createProxy,
	});
	let errorName = "";
	try {
		await pool.run(method, []);
	} catch (error) {
		errorName = error instanceof Error ? error.name : String(error);
	}
	const recovered = await pool.run("echo", ["recovered"]);
	await pool.close();
	return { errorName, recovered, workersCreated };
}

async function reactStrictMode() {
	let workersCreated = 0;
	let workersTerminated = 0;
	const workerFactory = () => {
		workersCreated++;
		const worker = createWorker();
		const terminate = worker.terminate.bind(worker);
		worker.terminate = () => {
			workersTerminated++;
			terminate();
		};
		return worker;
	};

	return new Promise<{
		value: string;
		workersCreated: number;
		workersTerminated: number;
	}>((resolve, reject) => {
		const root = createRoot(document.getElementById("root") as HTMLElement);
		function Probe() {
			const { api } = useWorkerPool<BrowserWorkerApi>({
				poolSize: 1,
				workerFactory,
				proxyFactory: createProxy,
			});
			useEffect(() => {
				if (!api) return;
				void api.echo("react-ready").then((value) => {
					root.unmount();
					setTimeout(
						() => resolve({ value, workersCreated, workersTerminated }),
						0,
					);
				}, reject);
			}, [api, reject, resolve]);
			return createElement("span", null, api ? "ready" : "initializing");
		}
		root.render(createElement(StrictMode, null, createElement(Probe)));
	});
}

const browserChecks = {
	crashRecovery: () => recover("crash"),
	hangRecovery: () => recover("hang"),
	parallelCalls,
	reactStrictMode,
};
window.browserChecks = browserChecks;

declare global {
	interface Window {
		browserChecks: typeof browserChecks;
	}
}
