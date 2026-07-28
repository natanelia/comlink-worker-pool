import { WorkerPool } from "../packages/comlink-worker-pool/src";

type BenchmarkApi = {
	run(value: number): Promise<number>;
};

class BenchmarkWorker extends EventTarget {
	public terminate(): void {}
}

interface WorkerCounters {
	creations: number;
	terminations: number;
}

class CountingBenchmarkWorker extends EventTarget {
	constructor(private readonly counters: WorkerCounters) {
		super();
	}

	public terminate(): void {
		this.counters.terminations++;
	}
}

const taskCount = Number(process.env.WORKER_POOL_BENCHMARK_TASKS ?? 50_000);
const workerChurnCount = Number(
	process.env.WORKER_POOL_BENCHMARK_CHURN_WORKERS ?? 10_000,
);
const workerBurstCount = Number(
	process.env.WORKER_POOL_BENCHMARK_BURST_WORKERS ?? 1_000,
);
const runCount = Number(process.env.WORKER_POOL_BENCHMARK_RUNS ?? 5);
const budgetMs = Number(process.env.WORKER_POOL_BENCHMARK_BUDGET_MS ?? 500);
const churnBudgetMs = Number(
	process.env.WORKER_POOL_BENCHMARK_CHURN_BUDGET_MS ?? 250,
);
const burstBudgetMs = Number(
	process.env.WORKER_POOL_BENCHMARK_BURST_BUDGET_MS ?? 100,
);

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
}

for (const [value, label] of [
	[taskCount, "WORKER_POOL_BENCHMARK_TASKS"],
	[workerChurnCount, "WORKER_POOL_BENCHMARK_CHURN_WORKERS"],
	[workerBurstCount, "WORKER_POOL_BENCHMARK_BURST_WORKERS"],
	[runCount, "WORKER_POOL_BENCHMARK_RUNS"],
] as const) {
	assertPositiveInteger(value, label);
}
for (const [value, label] of [
	[budgetMs, "WORKER_POOL_BENCHMARK_BUDGET_MS"],
	[churnBudgetMs, "WORKER_POOL_BENCHMARK_CHURN_BUDGET_MS"],
	[burstBudgetMs, "WORKER_POOL_BENCHMARK_BURST_BUDGET_MS"],
] as const) {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${label} must be positive`);
	}
}

async function measureTasks(taskTotal: number): Promise<number> {
	const pool = new WorkerPool<BenchmarkApi>({
		maxConcurrentTasksPerWorker: 1,
		maxQueueSize: taskTotal,
		onUpdateStats: () => {},
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

async function measureWorkerChurn(workerTotal: number): Promise<number> {
	const counters: WorkerCounters = { creations: 0, terminations: 0 };
	const pool = new WorkerPool<BenchmarkApi>({
		maxTasksPerWorker: 1,
		proxyFactory: () => ({ run: async (value: number) => value }),
		size: 1,
		taskTimeoutMs: false,
		workerFactory: () => {
			counters.creations++;
			return new CountingBenchmarkWorker(counters) as unknown as Worker;
		},
	});
	let checksum = 0;
	const startedAt = performance.now();
	for (let value = 0; value < workerTotal; value++) {
		checksum += await pool.run("run", [value]);
	}
	const elapsedMs = performance.now() - startedAt;
	await pool.close();

	const expectedChecksum = ((workerTotal - 1) * workerTotal) / 2;
	if (
		checksum !== expectedChecksum ||
		counters.creations !== workerTotal ||
		counters.terminations !== workerTotal
	) {
		throw new Error(
			`worker churn ended in an invalid state: ${counters.creations} created, ${counters.terminations} terminated, checksum ${checksum}`,
		);
	}
	return elapsedMs;
}

async function measureWorkerBurst(workerTotal: number): Promise<number> {
	const counters: WorkerCounters = { creations: 0, terminations: 0 };
	const pool = new WorkerPool<BenchmarkApi>({
		proxyFactory: () => ({ run: async (value: number) => value }),
		size: workerTotal,
		taskTimeoutMs: false,
		workerFactory: () => {
			counters.creations++;
			return new CountingBenchmarkWorker(counters) as unknown as Worker;
		},
	});
	const startedAt = performance.now();
	const results = await Promise.all(
		Array.from({ length: workerTotal }, (_, value) => pool.run("run", [value])),
	);
	await pool.close();
	const elapsedMs = performance.now() - startedAt;
	const checksum = results.reduce((total, value) => total + value, 0);
	const expectedChecksum = ((workerTotal - 1) * workerTotal) / 2;
	if (
		checksum !== expectedChecksum ||
		counters.creations !== workerTotal ||
		counters.terminations !== workerTotal
	) {
		throw new Error(
			`worker burst ended in an invalid state: ${counters.creations} created, ${counters.terminations} terminated, checksum ${checksum}`,
		);
	}
	return elapsedMs;
}

async function collectSamples(
	measure: () => Promise<number>,
): Promise<{ medianMs: number; p95Ms: number }> {
	const samples: number[] = [];
	for (let run = 0; run < runCount; run++) samples.push(await measure());
	samples.sort((left, right) => left - right);
	return {
		medianMs: samples[Math.floor(samples.length / 2)],
		p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
	};
}

await measureTasks(Math.min(1_000, taskCount));
await measureWorkerChurn(Math.min(100, workerChurnCount));
await measureWorkerBurst(Math.min(100, workerBurstCount));

const taskSamples = await collectSamples(() => measureTasks(taskCount));
const churnSamples = await collectSamples(() =>
	measureWorkerChurn(workerChurnCount),
);
const burstSamples = await collectSamples(() =>
	measureWorkerBurst(workerBurstCount),
);

console.log(
	JSON.stringify(
		{
			budgetMs,
			medianMs: Number(taskSamples.medianMs.toFixed(2)),
			p95Ms: Number(taskSamples.p95Ms.toFixed(2)),
			runs: runCount,
			taskCount,
			tasksPerSecond: Math.round(taskCount / (taskSamples.medianMs / 1_000)),
			workerChurn: {
				budgetMs: churnBudgetMs,
				medianMs: Number(churnSamples.medianMs.toFixed(2)),
				p95Ms: Number(churnSamples.p95Ms.toFixed(2)),
				workerCount: workerChurnCount,
				workersPerSecond: Math.round(
					workerChurnCount / (churnSamples.medianMs / 1_000),
				),
			},
			workerBurst: {
				budgetMs: burstBudgetMs,
				medianMs: Number(burstSamples.medianMs.toFixed(2)),
				p95Ms: Number(burstSamples.p95Ms.toFixed(2)),
				workerCount: workerBurstCount,
				workersPerSecond: Math.round(
					workerBurstCount / (burstSamples.medianMs / 1_000),
				),
			},
		},
		null,
		2,
	),
);

if (taskSamples.p95Ms > budgetMs) {
	throw new Error(
		`worker-pool benchmark exceeded its ${budgetMs} ms task p95 budget (${taskSamples.p95Ms.toFixed(2)} ms)`,
	);
}
if (churnSamples.p95Ms > churnBudgetMs) {
	throw new Error(
		`worker-pool benchmark exceeded its ${churnBudgetMs} ms churn p95 budget (${churnSamples.p95Ms.toFixed(2)} ms)`,
	);
}
if (burstSamples.p95Ms > burstBudgetMs) {
	throw new Error(
		`worker-pool benchmark exceeded its ${burstBudgetMs} ms burst p95 budget (${burstSamples.p95Ms.toFixed(2)} ms)`,
	);
}
