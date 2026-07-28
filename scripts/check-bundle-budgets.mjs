import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const kibibyte = 1024;
const artifacts = [
	{
		file: "packages/comlink-worker-pool/dist/esm/index.js",
		gzipBudget: 10 * kibibyte,
		rawBudget: 48 * kibibyte,
	},
	{
		file: "packages/comlink-worker-pool/dist/cjs/index.cjs",
		gzipBudget: 10 * kibibyte,
		rawBudget: 48 * kibibyte,
	},
	{
		file: "packages/comlink-worker-pool-react/dist/esm/index.js",
		gzipBudget: 5 * kibibyte,
		rawBudget: 16 * kibibyte,
	},
	{
		file: "packages/comlink-worker-pool-react/dist/cjs/index.cjs",
		gzipBudget: 5 * kibibyte,
		rawBudget: 16 * kibibyte,
	},
];

const rows = [];
for (const artifact of artifacts) {
	const contents = await readFile(artifact.file);
	const rawBytes = contents.byteLength;
	const gzipBytes = gzipSync(contents).byteLength;
	rows.push({
		artifact: artifact.file,
		gzipKiB: (gzipBytes / kibibyte).toFixed(2),
		rawKiB: (rawBytes / kibibyte).toFixed(2),
	});

	if (rawBytes > artifact.rawBudget) {
		throw new Error(
			`${artifact.file} is ${rawBytes} bytes; budget is ${artifact.rawBudget} bytes`,
		);
	}
	if (gzipBytes > artifact.gzipBudget) {
		throw new Error(
			`${artifact.file} is ${gzipBytes} gzip bytes; budget is ${artifact.gzipBudget} bytes`,
		);
	}

	const outputText = contents.toString("utf8");
	const sourceMappingUrl = outputText.match(
		/\/\/# sourceMappingURL=(\S+)\s*$/m,
	)?.[1];
	if (!sourceMappingUrl) {
		throw new Error(`${artifact.file} does not reference a source map`);
	}

	const sourceMapPath = resolve(dirname(artifact.file), sourceMappingUrl);
	const sourceMap = JSON.parse(await readFile(sourceMapPath, "utf8"));
	const outputDebugId = outputText.match(/\/\/# debugId=(\S+)\s*$/m)?.[1];
	if (outputDebugId && sourceMap.debugId !== outputDebugId) {
		throw new Error(`${sourceMapPath} does not belong to ${artifact.file}`);
	}
}

console.table(rows);
