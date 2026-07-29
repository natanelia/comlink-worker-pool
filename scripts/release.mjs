import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REGISTRY = "https://registry.npmjs.org/";

function run(command, args, { capture = false } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: ROOT,
			env: process.env,
			stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
		});
		let stdout = "";
		let stderr = "";
		if (capture) {
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
		}
		child.once("error", reject);
		child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

async function runChecked(command, args, options = {}) {
	const result = await run(command, args, options);
	if (result.code !== 0) {
		const detail = result.stderr.trim();
		throw new Error(
			`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`,
		);
	}
	return result;
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function getPublishablePackages() {
	const rootPackage = await readJson(join(ROOT, "package.json"));
	const workspaces = Array.isArray(rootPackage.workspaces)
		? rootPackage.workspaces
		: rootPackage.workspaces?.packages;
	if (!Array.isArray(workspaces)) {
		throw new Error("The root package does not define an array of workspaces.");
	}

	const packages = [];
	for (const workspace of workspaces) {
		if (workspace.includes("*")) {
			throw new Error(
				`Release workspaces must use explicit package paths: ${workspace}`,
			);
		}
		const packagePath = join(ROOT, workspace, "package.json");
		let packageJson;
		try {
			packageJson = await readJson(packagePath);
		} catch (error) {
			if (error?.code === "ENOENT") continue;
			throw error;
		}
		if (packageJson.private === true || !packageJson.publishConfig?.access)
			continue;
		packages.push({ name: packageJson.name, version: packageJson.version });
	}

	if (packages.length === 0) {
		throw new Error("No publishable workspace packages were found.");
	}
	const versions = [
		...new Set(packages.map((packageInfo) => packageInfo.version)),
	];
	if (versions.length !== 1) {
		throw new Error(
			`Publishable packages must share one version; found ${versions.join(", ")}.`,
		);
	}
	return { packages, version: versions[0] };
}

async function assertCleanWorkingTree({ allowDirty = false } = {}) {
	const result = await runChecked("git", ["status", "--porcelain"], {
		capture: true,
	});
	if (result.stdout.trim() && !allowDirty) {
		throw new Error("The working tree must be clean before releasing.");
	}
	if (result.stdout.trim() && allowDirty) {
		console.warn(
			"[dry-run] working tree is dirty; no changes will be published.",
		);
	}
}

async function getReleaseTarget() {
	const head = await runChecked("git", ["rev-parse", "HEAD"], {
		capture: true,
	});
	const target = process.env.GITHUB_SHA?.trim() || head.stdout.trim();
	const remote = await runChecked("git", ["ls-remote", "origin"], {
		capture: true,
	});
	const targetIsOnOrigin = remote.stdout
		.split(/\r?\n/)
		.some((line) => line.startsWith(`${target}\t`));
	if (!targetIsOnOrigin) {
		throw new Error(
			`Release target ${target} is not available on origin; push the release commit first.`,
		);
	}
	return target;
}

async function githubReleaseExists(tag) {
	const result = await run(
		"gh",
		["release", "view", tag, "--json", "tagName"],
		{
			capture: true,
		},
	);
	return result.code === 0;
}

async function main() {
	const argumentsList = process.argv.slice(2);
	const dryRun = argumentsList.length === 1 && argumentsList[0] === "--dry-run";
	if (argumentsList.length > 0 && !dryRun) {
		throw new Error("Usage: bun run release [--dry-run]");
	}

	const { packages, version } = await getPublishablePackages();
	const tag = `v${version}`;
	await assertCleanWorkingTree({ allowDirty: dryRun });
	const target = await getReleaseTarget();
	console.log(
		`Preparing ${tag} for ${packages.map((packageInfo) => packageInfo.name).join(", ")} (registry: ${REGISTRY})`,
	);

	if (dryRun) {
		console.log("[dry-run] bun run verify");
		console.log("[dry-run] bun x changeset publish");
		console.log(
			`[dry-run] gh release create ${tag} --target ${target} --generate-notes`,
		);
		return;
	}

	await runChecked("npm", ["whoami", "--registry", REGISTRY], {
		capture: true,
	});
	await runChecked("gh", ["auth", "status"], { capture: true });
	await runChecked("bun", ["run", "verify"]);
	await runChecked("bun", ["x", "changeset", "publish"]);

	if (await githubReleaseExists(tag)) {
		console.log(`GitHub release ${tag} already exists; npm publish completed.`);
		return;
	}
	await runChecked("gh", [
		"release",
		"create",
		tag,
		"--target",
		target,
		"--title",
		tag,
		"--generate-notes",
	]);
	console.log(`Published npm packages and created GitHub release ${tag}.`);
}

main().catch((error) => {
	console.error(`Release failed: ${error.message}`);
	process.exitCode = 1;
});
