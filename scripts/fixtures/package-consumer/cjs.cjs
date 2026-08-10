const core = require("comlink-worker-pool");
const react = require("comlink-worker-pool-react");

if (
	typeof core.WorkerPool !== "function" ||
	typeof core.WorkerPoolQueueFullError !== "function" ||
	typeof react.useWorkerPool !== "function" ||
	typeof react.useWorkerTask !== "function"
) {
	process.exit(1);
}
