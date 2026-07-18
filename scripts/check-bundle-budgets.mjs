import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const kibibyte = 1024;
const artifacts = [
	{
		file: "packages/comlink-worker-pool/dist/index.js",
		gzipBudget: 10 * kibibyte,
		rawBudget: 48 * kibibyte,
	},
	{
		file: "packages/comlink-worker-pool/dist/index.cjs",
		gzipBudget: 10 * kibibyte,
		rawBudget: 48 * kibibyte,
	},
	{
		file: "packages/comlink-worker-pool-react/dist/index.js",
		gzipBudget: 5 * kibibyte,
		rawBudget: 16 * kibibyte,
	},
	{
		file: "packages/comlink-worker-pool-react/dist/index.cjs",
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

	const sourceMap = await stat(`${artifact.file}.map`);
	if (sourceMap.size === 0) {
		throw new Error(`${artifact.file}.map is empty`);
	}
}

console.table(rows);
