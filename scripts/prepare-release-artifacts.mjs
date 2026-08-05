import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUTPUT_DIRECTORY = join(ROOT, "release-artifacts");
const PACKAGE_DIRECTORIES = [
	"packages/comlink-worker-pool",
	"packages/comlink-worker-pool-react",
];
const EXPECTED_PACKAGE_NAMES = new Set([
	"comlink-worker-pool",
	"comlink-worker-pool-react",
]);
const ALLOWED_PACKAGE_FILES = [
	/^dist\//,
	/^package\.json$/,
	/^(?:README|LICENSE|LICENCE|CHANGELOG)(?:\.[^/]*)?$/i,
];
const SENSITIVE_FILE_PATTERN =
	/(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$|.*\.(?:key|pem|p12|pfx)$|.*(?:secret|token|credential).*)/i;

function run(command, args, { capture = false } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: ROOT,
			env: {
				...process.env,
				npm_config_ignore_scripts: "true",
				npm_config_provenance: "true",
				npm_config_registry: "https://registry.npmjs.org/",
			},
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
		child.once("close", (code) =>
			resolve({ code: code ?? 1, stderr, stdout }),
		);
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

async function sha256(path) {
	const contents = await readFile(path);
	return createHash("sha256").update(contents).digest("hex");
}

function assertPackageContents(packageName, files) {
	if (!Array.isArray(files) || files.length === 0) {
		throw new Error(`${packageName} produced an empty npm package`);
	}
	for (const entry of files) {
		const path = entry?.path;
		if (typeof path !== "string") {
			throw new Error(`${packageName} produced invalid npm pack metadata`);
		}
		if (SENSITIVE_FILE_PATTERN.test(path)) {
			throw new Error(`${packageName} package contains sensitive path ${path}`);
		}
		if (!ALLOWED_PACKAGE_FILES.some((pattern) => pattern.test(path))) {
			throw new Error(`${packageName} package contains unexpected path ${path}`);
		}
	}
}

async function getCommit() {
	if (process.env.GITHUB_SHA?.trim()) return process.env.GITHUB_SHA.trim();
	const result = await runChecked("git", ["rev-parse", "HEAD"], { capture: true });
	return result.stdout.trim();
}

const expectedVersion = process.env.RELEASE_VERSION?.trim();
if (!expectedVersion) {
	throw new Error("RELEASE_VERSION is required");
}
if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
	throw new Error(`RELEASE_VERSION is not valid semver: ${expectedVersion}`);
}

const packages = [];
for (const directory of PACKAGE_DIRECTORIES) {
	const packageJson = await readJson(join(ROOT, directory, "package.json"));
	if (!EXPECTED_PACKAGE_NAMES.has(packageJson.name)) {
		throw new Error(`Unexpected publishable package ${packageJson.name}`);
	}
	if (packageJson.private === true) {
		throw new Error(`${packageJson.name} is private`);
	}
	if (packageJson.version !== expectedVersion) {
		throw new Error(
			`${packageJson.name} is ${packageJson.version}, expected ${expectedVersion}`,
		);
	}
	if (packageJson.publishConfig?.access !== "public") {
		throw new Error(`${packageJson.name} must publish with public access`);
	}
	packages.push({
		directory,
		name: packageJson.name,
		version: packageJson.version,
	});
}
if (packages.length !== EXPECTED_PACKAGE_NAMES.size) {
	throw new Error("Publishable package set is incomplete");
}

await rm(OUTPUT_DIRECTORY, { force: true, recursive: true });
await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const packedPackages = [];
for (const packageInfo of packages) {
	const result = await runChecked(
		"npm",
		[
			"pack",
			join(ROOT, packageInfo.directory),
			"--ignore-scripts",
			"--json",
			"--pack-destination",
			OUTPUT_DIRECTORY,
		],
		{ capture: true },
	);
	let packResult;
	try {
		[packResult] = JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(
			`Could not parse npm pack output for ${packageInfo.name}`,
			{ cause: error },
		);
	}
	if (!packResult?.filename || !packResult?.integrity || !packResult?.shasum) {
		throw new Error(`npm pack returned incomplete metadata for ${packageInfo.name}`);
	}
	assertPackageContents(packageInfo.name, packResult.files);
	const filename = basename(packResult.filename);
	const tarballPath = join(OUTPUT_DIRECTORY, filename);
	packedPackages.push({
		name: packageInfo.name,
		version: packageInfo.version,
		filename,
		integrity: packResult.integrity,
		npmShasum: packResult.shasum,
		sha256: await sha256(tarballPath),
		files: packResult.files
			.map(({ path, size }) => ({ path, size }))
			.sort((left, right) => left.path.localeCompare(right.path)),
	});
}

const tarballs = (await readdir(OUTPUT_DIRECTORY))
	.filter((name) => name.endsWith(".tgz"))
	.sort();
if (tarballs.length !== packages.length) {
	throw new Error(
		`Expected ${packages.length} tarballs, found ${tarballs.length}`,
	);
}

const manifest = {
	schemaVersion: 1,
	repository: "natanelia/comlink-worker-pool",
	commit: await getCommit(),
	version: expectedVersion,
	packages: packedPackages.sort((left, right) =>
		left.name.localeCompare(right.name),
	),
};
await writeFile(
	join(OUTPUT_DIRECTORY, "release-manifest.json"),
	`${JSON.stringify(manifest, null, 2)}\n`,
);
await writeFile(
	join(OUTPUT_DIRECTORY, "SHA256SUMS"),
	`${manifest.packages
		.map(({ filename, sha256: digest }) => `${digest}  ${filename}`)
		.join("\n")}\n`,
);

console.log(
	`Prepared ${manifest.packages.map(({ name, version }) => `${name}@${version}`).join(", ")} from ${manifest.commit}.`,
);
