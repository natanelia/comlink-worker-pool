import { WorkerPool } from "../packages/comlink-worker-pool/src";

type BenchmarkApi = {
	run(value: number): Promise<number>;
};

class BenchmarkWorker extends EventTarget {
	public terminate(): void {}
}

const taskCount = Number(process.env.WORKER_POOL_BENCHMARK_TASKS ?? 10_000);
const runCount = Number(process.env.WORKER_POOL_BENCHMARK_RUNS ?? 5);
const budgetMs = Number(process.env.WORKER_POOL_BENCHMARK_BUDGET_MS ?? 2_000);

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
}

assertPositiveInteger(taskCount, "WORKER_POOL_BENCHMARK_TASKS");
assertPositiveInteger(runCount, "WORKER_POOL_BENCHMARK_RUNS");
if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
	throw new Error("WORKER_POOL_BENCHMARK_BUDGET_MS must be positive");
}

async function measure(taskTotal: number): Promise<number> {
	const pool = new WorkerPool<BenchmarkApi>({
		maxConcurrentTasksPerWorker: 1,
		maxQueueSize: taskTotal,
		proxyFactory: () => ({
			run: async (value: number) => value,
		}),
		size: 4,
		taskTimeoutMs: false,
		workerFactory: () => new BenchmarkWorker() as unknown as Worker,
	});
	const api = pool.getApi();
	const startedAt = performance.now();
	const results = await Promise.all(
		Array.from({ length: taskTotal }, (_, value) => api.run(value)),
	);
	const elapsedMs = performance.now() - startedAt;
	const expectedChecksum = ((taskTotal - 1) * taskTotal) / 2;
	const checksum = results.reduce((total, value) => total + value, 0);
	const stats = pool.getStats();

	if (checksum !== expectedChecksum) {
		throw new Error(`benchmark checksum mismatch: ${checksum}`);
	}
	if (stats.completedTasks !== taskTotal || stats.queue !== 0) {
		throw new Error(
			`benchmark ended in an invalid state: ${stats.completedTasks} completed, ${stats.queue} queued`,
		);
	}
	await pool.close();
	return elapsedMs;
}

await measure(Math.min(1_000, taskCount));

const samples: number[] = [];
for (let run = 0; run < runCount; run += 1) {
	samples.push(await measure(taskCount));
}
samples.sort((left, right) => left - right);

const medianMs = samples[Math.floor(samples.length / 2)];
const p95Ms = samples[Math.ceil(samples.length * 0.95) - 1];
const tasksPerSecond = Math.round(taskCount / (medianMs / 1_000));

console.log(
	JSON.stringify(
		{
			budgetMs,
			medianMs: Number(medianMs.toFixed(2)),
			p95Ms: Number(p95Ms.toFixed(2)),
			runs: runCount,
			taskCount,
			tasksPerSecond,
		},
		null,
		2,
	),
);

if (p95Ms > budgetMs) {
	throw new Error(
		`worker-pool benchmark exceeded its ${budgetMs} ms p95 budget (${p95Ms.toFixed(2)} ms)`,
	);
}
