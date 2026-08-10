import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "..");
const consumerFixtureDirectory = join(
	scriptDirectory,
	"fixtures",
	"package-consumer",
);
const consumerFixtureFiles = [
	"esm.mjs",
	"cjs.cjs",
	"consumer.ts",
	"tsconfig.json",
];
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

function copyConsumerFixtures(directory) {
	for (const filename of consumerFixtureFiles) {
		copyFileSync(
			join(consumerFixtureDirectory, filename),
			join(directory, filename),
		);
	}
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
		copyConsumerFixtures(consumerDirectory);
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
