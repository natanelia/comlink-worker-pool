import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

try {
	const corePackage = pack("packages/comlink-worker-pool");
	const reactPackage = pack("packages/comlink-worker-pool-react");
	writeFileSync(
		join(temporaryDirectory, "package.json"),
		JSON.stringify({
			name: "worker-pool-consumer",
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
			"react@^19",
			"@types/react@^19",
		],
		temporaryDirectory,
	);

	writeFileSync(
		join(temporaryDirectory, "esm.mjs"),
		'import { WorkerPool, WorkerPoolQueueFullError } from "comlink-worker-pool";\nimport { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";\nif (typeof WorkerPool !== "function" || typeof WorkerPoolQueueFullError !== "function" || typeof useWorkerPool !== "function" || typeof useWorkerTask !== "function") process.exit(1);\n',
	);
	writeFileSync(
		join(temporaryDirectory, "cjs.cjs"),
		'const core = require("comlink-worker-pool");\nconst react = require("comlink-worker-pool-react");\nif (typeof core.WorkerPool !== "function" || typeof core.WorkerPoolQueueFullError !== "function" || typeof react.useWorkerPool !== "function" || typeof react.useWorkerTask !== "function") process.exit(1);\n',
	);
	writeFileSync(
		join(temporaryDirectory, "consumer.ts"),
		'import { WorkerPool, type WorkerPoolShutdownReport } from "comlink-worker-pool";\nimport { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";\ntype Api = { add(a: number, b: number): Promise<number> };\ndeclare const workerFactory: () => Worker;\ndeclare const proxyFactory: (worker: Worker) => Api;\nconst pool = new WorkerPool<Api>({ size: 1, workerFactory, proxyFactory, maxQueueSize: 2 });\nconst result: Promise<number> = pool.run("add", [1, 2], { priority: 1 });\nconst shutdown: Promise<WorkerPoolShutdownReport> = pool.drain();\nconst hook = useWorkerPool<Api>({ workerFactory, proxyFactory, poolSize: 1 });\nconst task = useWorkerTask(hook.api, "add");\nconst taskResult: number | null = task.result;\nvoid result;\nvoid shutdown;\nvoid taskResult;\n',
	);
	writeFileSync(
		join(temporaryDirectory, "tsconfig.json"),
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

	execute("node", ["esm.mjs"], temporaryDirectory);
	execute("node", ["cjs.cjs"], temporaryDirectory);
	execute(
		resolve(workspaceRoot, "node_modules/.bin/tsc"),
		["-p", "tsconfig.json"],
		temporaryDirectory,
	);
} finally {
	rmSync(temporaryDirectory, { force: true, recursive: true });
}
