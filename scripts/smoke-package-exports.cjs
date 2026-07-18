const assert = require("node:assert/strict");

async function main() {
	const coreCjs = require("comlink-worker-pool");
	const reactCjs = require("comlink-worker-pool-react");
	const coreEsm = await import("comlink-worker-pool");
	const reactEsm = await import("comlink-worker-pool-react");

	for (const core of [coreCjs, coreEsm]) {
		assert.equal(typeof core.WorkerPool, "function");
		assert.equal(typeof core.WorkerPoolTerminatedError, "function");
	}
	for (const react of [reactCjs, reactEsm]) {
		assert.equal(typeof react.useWorkerPool, "function");
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
