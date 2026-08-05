import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "worker-pool-consumer-"));

function execute(command, args, cwd = workspaceRoot) {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	}).trim();
}

function pack(packageDirectory) {
	const output = execute("npm", [
		"pack",
		"--json",
		"--pack-destination",
		temporaryDirectory,
		resolve(workspaceRoot, packageDirectory),
	]);
	const [{ filename }] = JSON.parse(output);
	return join(temporaryDirectory, filename);
}

function writeConsumerFiles(directory) {
	writeFileSync(
		join(directory, "esm.mjs"),
		'import { WorkerPool, WorkerPoolQueueFullError } from "comlink-worker-pool";\nimport { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";\nif (typeof WorkerPool !== "function" || typeof WorkerPoolQueueFullError !== "function" || typeof useWorkerPool !== "function" || typeof useWorkerTask !== "function") process.exit(1);\n',
	);
	writeFileSync(
		join(directory, "cjs.cjs"),
		'const core = require("comlink-worker-pool");\nconst react = require("comlink-worker-pool-react");\nif (typeof core.WorkerPool !== "function" || typeof core.WorkerPoolQueueFullError !== "function" || typeof react.useWorkerPool !== "function" || typeof react.useWorkerTask !== "function") process.exit(1);\n',
	);
	writeFileSync(
		join(directory, "consumer.ts"),
		'import { WorkerPool, type PooledApi, type WorkerPoolShutdownReport } from "comlink-worker-pool";\nimport { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";\ninterface Api { add(a: number, b: number): Promise<number> }\ninterface SyncApi { sync(value: number): number; then(): Promise<void>; [Symbol.iterator](): Iterator<number> }\ndeclare const workerFactory: () => Worker;\ndeclare const proxyFactory: (worker: Worker) => Api;\ndeclare const syncProxyFactory: (worker: Worker) => SyncApi;\nconst pool = new WorkerPool<Api>({ size: 1, workerFactory, proxyFactory, maxQueueSize: 2 });\nconst result: Promise<number> = pool.run("add", [1, 2], { priority: 1 });\nconst shutdown: Promise<WorkerPoolShutdownReport> = pool.drain();\nconst hook = useWorkerPool<Api>({ workerFactory, proxyFactory, poolSize: 1 });\nconst task = useWorkerTask(hook.api, "add");\nconst taskResult: number | null = task.result;\nconst syncPool = new WorkerPool<SyncApi>({ size: 1, workerFactory, proxyFactory: syncProxyFactory });\nconst pooledApi: PooledApi<SyncApi> = syncPool.getApi();\nconst syncResult: Promise<number> = pooledApi.sync(1);\nconst reservedResult: Promise<void> = syncPool.run("then", []);\n// @ts-expect-error Scheduled calls always return promises.\nconst incorrectSyncResult: number = pooledApi.sync(1);\n// @ts-expect-error The then key is reserved on the scheduled proxy.\npooledApi.then();\n// @ts-expect-error Symbol methods are not exposed by the scheduled proxy.\npooledApi[Symbol.iterator]();\nconst syncHook = useWorkerPool<SyncApi>({ workerFactory, proxyFactory: syncProxyFactory });\nconst hookSyncResult: Promise<number> | undefined = syncHook.api?.sync(1);\nconst trackedSyncResult: Promise<number> = syncHook.call("sync", 1);\n// @ts-expect-error The then key is reserved on the scheduled hook API.\nsyncHook.call("then");\nvoid result;\nvoid shutdown;\nvoid taskResult;\nvoid syncResult;\nvoid reservedResult;\nvoid incorrectSyncResult;\nvoid hookSyncResult;\nvoid trackedSyncResult;\n',
	);
	writeFileSync(
		join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				lib: ["ES2022", "DOM"],
				module: "NodeNext",
				moduleResolution: "NodeNext",
				noEmit: true,
				strict: true,
				target: "ES2022",
			},
			include: ["consumer.ts"],
		}),
	);
}

try {
	const corePackage = pack("packages/comlink-worker-pool");
	const reactPackage = pack("packages/comlink-worker-pool-react");

	for (const reactMajor of [17, 18, 19]) {
		const consumerDirectory = join(
			temporaryDirectory,
			`react-${reactMajor}-consumer`,
		);
		mkdirSync(consumerDirectory);
		writeFileSync(
			join(consumerDirectory, "package.json"),
			JSON.stringify({
				name: `worker-pool-react-${reactMajor}-consumer`,
				private: true,
				type: "module",
			}),
		);
		execute(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				"--no-package-lock",
				corePackage,
				reactPackage,
				`react@^${reactMajor}`,
				`@types/react@^${reactMajor}`,
			],
			consumerDirectory,
		);
		writeConsumerFiles(consumerDirectory);
		execute("node", ["esm.mjs"], consumerDirectory);
		execute("node", ["cjs.cjs"], consumerDirectory);
		execute(
			resolve(workspaceRoot, "node_modules/.bin/tsc"),
			["-p", "tsconfig.json"],
			consumerDirectory,
		);
	}
} finally {
	rmSync(temporaryDirectory, { force: true, recursive: true });
}
