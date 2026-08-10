import { WorkerPool, WorkerPoolQueueFullError } from "comlink-worker-pool";
import { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";

if (
	typeof WorkerPool !== "function" ||
	typeof WorkerPoolQueueFullError !== "function" ||
	typeof useWorkerPool !== "function" ||
	typeof useWorkerTask !== "function"
) {
	process.exit(1);
}
