import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PACKAGE_PATHS = [
	"packages/comlink-worker-pool/package.json",
	"packages/comlink-worker-pool-react/package.json",
];
const ALLOWED_PATHS = new Set([
	"bun.lock",
	"packages/comlink-worker-pool/package.json",
	"packages/comlink-worker-pool/CHANGELOG.md",
	"packages/comlink-worker-pool-react/package.json",
	"packages/comlink-worker-pool-react/CHANGELOG.md",
]);
const SEMVER =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

const argumentsList = process.argv.slice(2);
const allowEmpty =
	argumentsList.length === 1 && argumentsList[0] === "--allow-empty";
if (argumentsList.length > 0 && !allowEmpty) {
	throw new Error(
		"Usage: node scripts/validate-version-changes.mjs [--allow-empty]",
	);
}

const changedLines = execFileSync(
	"git",
	["diff", "--name-status", "--find-renames=0"],
	{ encoding: "utf8" },
)
	.trim()
	.split(/\r?\n/)
	.filter(Boolean);
if (changedLines.length === 0) {
	if (allowEmpty) {
		console.log("No pending Changesets produced version changes.");
		process.exit(0);
	}
	throw new Error("No pending Changesets produced a version patch");
}

for (const line of changedLines) {
	const [status, ...pathParts] = line.split("\t");
	const path = pathParts.at(-1);
	if (!path) throw new Error(`Invalid git diff entry: ${line}`);
	if (path.startsWith(".changeset/") && path.endsWith(".md")) {
		if (status !== "D") {
			throw new Error(`Changeset files may only be deleted: ${line}`);
		}
		continue;
	}
	if (!ALLOWED_PATHS.has(path)) {
		throw new Error(`Unexpected versioning change: ${line}`);
	}
	if (status !== "M") {
		throw new Error(`Expected a modified generated file: ${line}`);
	}
}

function readHeadJson(path) {
	return JSON.parse(
		execFileSync("git", ["show", `HEAD:${path}`], {
			encoding: "utf8",
		}),
	);
}

function stripAllowedChanges(packageJson, reactPackage) {
	const copy = structuredClone(packageJson);
	copy.version = undefined;
	if (reactPackage && copy.dependencies) {
		copy.dependencies["comlink-worker-pool"] = undefined;
	}
	return copy;
}

const packages = PACKAGE_PATHS.map((path, index) => {
	const before = readHeadJson(path);
	const after = JSON.parse(readFileSync(path, "utf8"));
	const beforeStable = stripAllowedChanges(before, index === 1);
	const afterStable = stripAllowedChanges(after, index === 1);
	if (JSON.stringify(beforeStable) !== JSON.stringify(afterStable)) {
		throw new Error(`${path} changed outside version fields`);
	}
	if (before.name !== after.name || before.version === after.version) {
		throw new Error(`${path} did not receive a valid version-only update`);
	}
	if (!SEMVER.test(after.version)) {
		throw new Error(`${path} contains invalid version ${after.version}`);
	}
	return after;
});

const versions = new Set(packages.map(({ version }) => version));
if (versions.size !== 1) {
	throw new Error(
		`Publishable packages must share one version; found ${[...versions].join(", ")}`,
	);
}
console.log(
	`Validated ${packages
		.map(({ name, version }) => `${name}@${version}`)
		.join(", ")}`,
);
