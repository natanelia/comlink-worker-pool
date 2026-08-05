import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKFLOW_DIRECTORY = join(ROOT, ".github", "workflows");
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const FORBIDDEN_LIFECYCLE_SCRIPTS = new Set([
	"preinstall",
	"install",
	"postinstall",
	"prepublish",
	"prepublishOnly",
	"prepare",
	"prepack",
	"postpack",
	"postpublish",
]);
const DEPENDENCY_SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
];
const FORBIDDEN_DEPENDENCY_PREFIXES = [
	"file:",
	"git:",
	"git+",
	"github:",
	"http:",
	"https:",
	"link:",
];

function fail(message) {
	throw new Error(`Supply-chain policy violation: ${message}`);
}

async function readText(relativePath) {
	return readFile(join(ROOT, relativePath), "utf8");
}

async function readJson(relativePath) {
	return JSON.parse(await readText(relativePath));
}

function countMatches(text, expression) {
	return [...text.matchAll(expression)].length;
}

function validatePackageManifest(relativePath, packageJson) {
	if (packageJson.trustedDependencies !== undefined) {
		fail(`${relativePath} must not grant dependency lifecycle-script trust`);
	}

	for (const scriptName of Object.keys(packageJson.scripts ?? {})) {
		if (FORBIDDEN_LIFECYCLE_SCRIPTS.has(scriptName)) {
			fail(`${relativePath} defines forbidden lifecycle script ${scriptName}`);
		}
	}

	for (const section of DEPENDENCY_SECTIONS) {
		for (const [name, specifier] of Object.entries(packageJson[section] ?? {})) {
			if (typeof specifier !== "string") {
				fail(`${relativePath} has a non-string ${section} specifier for ${name}`);
			}
			if (
				FORBIDDEN_DEPENDENCY_PREFIXES.some((prefix) =>
					specifier.toLowerCase().startsWith(prefix),
				)
			) {
				fail(
					`${relativePath} uses non-registry dependency ${name}@${specifier}`,
				);
			}
		}
	}
}

const rootPackage = await readJson("package.json");
validatePackageManifest("package.json", rootPackage);

const workspaces = Array.isArray(rootPackage.workspaces)
	? rootPackage.workspaces
	: rootPackage.workspaces?.packages;
if (!Array.isArray(workspaces) || workspaces.length === 0) {
	fail("package.json must define explicit workspaces");
}
for (const workspace of workspaces) {
	if (typeof workspace !== "string" || workspace.includes("*")) {
		fail(`workspace paths must be explicit: ${String(workspace)}`);
	}
	validatePackageManifest(
		`${workspace}/package.json`,
		await readJson(`${workspace}/package.json`),
	);
}

const bunConfig = await readText("bunfig.toml");
if (!/\[install\][\s\S]*?\bignoreScripts\s*=\s*true\b/.test(bunConfig)) {
	fail("bunfig.toml must set [install].ignoreScripts = true");
}

const npmConfig = await readText(".npmrc");
if (!/^ignore-scripts=true$/m.test(npmConfig)) {
	fail(".npmrc must set ignore-scripts=true");
}
if (!/^registry=https:\/\/registry\.npmjs\.org\/$/m.test(npmConfig)) {
	fail(".npmrc must pin the public npm registry");
}
if (!/^provenance=true$/m.test(npmConfig)) {
	fail(".npmrc must request npm provenance");
}

const codeOwners = await readText(".github/CODEOWNERS");
for (const requiredPath of [
	"/.github/workflows/",
	"/.github/dependabot.yml",
	"/.github/CODEOWNERS",
	"/.npmrc",
	"/bun.lock",
	"/bunfig.toml",
	"/package.json",
	"/packages/*/package.json",
	"/scripts/check-supply-chain-security.mjs",
	"/scripts/prepare-release-artifacts.mjs",
]) {
	if (!codeOwners.includes(requiredPath)) {
		fail(`CODEOWNERS does not protect ${requiredPath}`);
	}
}
if (!codeOwners.includes("@natanelia") || !codeOwners.includes("@Joezer-Ivan")) {
	fail("security-sensitive paths must have two independent code owners");
}

await readText(".github/dependabot.yml");

const workflowNames = (await readdir(WORKFLOW_DIRECTORY))
	.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
	.sort();
if (workflowNames.length === 0) {
	fail("no GitHub Actions workflows were found");
}

for (const workflowName of workflowNames) {
	const workflow = await readText(`.github/workflows/${workflowName}`);

	for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)) {
		const action = match[1];
		if (action.startsWith("./")) continue;
		const separator = action.lastIndexOf("@");
		const reference = separator === -1 ? "" : action.slice(separator + 1);
		if (!FULL_COMMIT.test(reference)) {
			fail(`${workflowName} uses an unpinned action: ${action}`);
		}
	}

	for (const line of workflow.split(/\r?\n/)) {
		if (!line.includes("bun install")) continue;
		if (!line.includes("--frozen-lockfile") || !line.includes("--ignore-scripts")) {
			fail(
				`${workflowName} must use bun install --frozen-lockfile --ignore-scripts`,
			);
		}
	}

	if (/\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b|_authToken/i.test(workflow)) {
		fail(`${workflowName} contains a reusable npm credential`);
	}

	const checkoutCount = countMatches(
		workflow,
		/uses:\s*actions\/checkout@[0-9a-f]{40}/g,
	);
	const noCredentialCheckoutCount = countMatches(
		workflow,
		/persist-credentials:\s*false/g,
	);
	if (noCredentialCheckoutCount < checkoutCount) {
		fail(`${workflowName} must disable persisted checkout credentials`);
	}
}

const stageWorkflow = await readText(".github/workflows/stage-release.yml");
if (!stageWorkflow.includes("environment: npm-release")) {
	fail("stage-release.yml must use the npm-release environment");
}
if (!stageWorkflow.includes("id-token: write")) {
	fail("stage-release.yml must request an OIDC token");
}
if (!stageWorkflow.includes("npm stage publish")) {
	fail("stage-release.yml must use staged npm publishing");
}
if (/(^|\s)npm\s+publish(?:\s|$)/m.test(stageWorkflow)) {
	fail("stage-release.yml must never directly publish a package");
}

const versionWorkflow = await readText(".github/workflows/release.yml");
if (versionWorkflow.includes("id-token: write")) {
	fail("the Changesets version workflow must not receive an OIDC token");
}
if (versionWorkflow.includes("publish:")) {
	fail("the Changesets version workflow must not publish packages");
}

console.log(
	`Supply-chain policy passed for ${workspaces.length + 1} package manifests and ${workflowNames.length} workflows.`,
);
