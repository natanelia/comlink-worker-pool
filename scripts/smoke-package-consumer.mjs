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
		'import { WorkerPool, type WorkerPoolShutdownReport } from "comlink-worker-pool";\nimport { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";\ninterface Api { add(a: number, b: number): Promise<number> }\ndeclare const workerFactory: () => Worker;\ndeclare const proxyFactory: (worker: Worker) => Api;\nconst pool = new WorkerPool<Api>({ size: 1, workerFactory, proxyFactory, maxQueueSize: 2 });\nconst result: Promise<number> = pool.run("add", [1, 2], { priority: 1 });\nconst shutdown: Promise<WorkerPoolShutdownReport> = pool.drain();\nconst hook = useWorkerPool<Api>({ workerFactory, proxyFactory, poolSize: 1 });\nconst task = useWorkerTask(hook.api, "add");\nconst taskResult: number | null = task.result;\nvoid result;\nvoid shutdown;\nvoid taskResult;\n',
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
