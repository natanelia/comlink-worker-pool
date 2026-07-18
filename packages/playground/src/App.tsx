import * as Comlink from "comlink";
import type { WorkerPoolEvent, WorkerPoolStats } from "comlink-worker-pool";
import { useWorkerPool, useWorkerTask } from "comlink-worker-pool-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkerApi } from "./worker";

const DEFAULT_POOL_SIZE = Math.max(
	1,
	Math.min(4, (navigator.hardwareConcurrency || 2) - 1),
);
const MAX_LOG_ENTRIES = 80;

interface PoolConfig {
	concurrency: number;
	revision: number;
	size: number;
}

interface LogEntry {
	detail: string;
	id: number;
	kind: "error" | "lifecycle" | "task";
}

interface BatchState {
	completed: number;
	failed: number;
	status: "idle" | "running" | "completed" | "error";
}

const workerFactory = () =>
	new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const proxyFactory = (worker: Worker) => Comlink.wrap<WorkerApi>(worker);

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function updateFiniteNumber(
	event: React.ChangeEvent<HTMLInputElement>,
	update: (value: number) => void,
): void {
	if (Number.isFinite(event.currentTarget.valueAsNumber)) {
		update(event.currentTarget.valueAsNumber);
	}
}

function describeEvent(event: WorkerPoolEvent): string {
	switch (event.type) {
		case "task-queued":
			return `#${event.taskId} ${event.method} queued at priority ${event.priority}`;
		case "task-started":
			return `#${event.taskId} started on worker ${event.workerId} after ${Math.round(event.queueWaitMs)} ms`;
		case "task-settled":
			return `#${event.taskId} ${event.outcome} in ${Math.round(event.durationMs)} ms`;
		case "worker-created":
			return `worker ${event.workerId} created`;
		case "worker-removed":
			return `worker ${event.workerId} removed: ${event.reason}`;
		case "worker-termination-failed":
			return `worker termination attempt ${event.attempt} failed${event.exhausted ? ": retries exhausted" : ""}`;
	}
}

function App() {
	const [config, setConfig] = useState<PoolConfig>({
		concurrency: 1,
		revision: 0,
		size: DEFAULT_POOL_SIZE,
	});
	const [draftConcurrency, setDraftConcurrency] = useState(1);
	const [draftSize, setDraftSize] = useState(DEFAULT_POOL_SIZE);
	const [stats, setStats] = useState<WorkerPoolStats | null>(null);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [fibInput, setFibInput] = useState(36);
	const [textInput, setTextInput] = useState(
		"Worker pools keep expensive work away from the main thread.",
	);
	const [batchCount, setBatchCount] = useState(12);
	const [batchDelay, setBatchDelay] = useState(300);
	const [batch, setBatch] = useState<BatchState>({
		completed: 0,
		failed: 0,
		status: "idle",
	});
	const logSequence = useRef(0);
	const logListRef = useRef<HTMLOListElement>(null);

	const appendLog = useCallback((kind: LogEntry["kind"], detail: string) => {
		const entry = { detail, id: ++logSequence.current, kind };
		setLogs((current) => [...current.slice(-(MAX_LOG_ENTRIES - 1)), entry]);
	}, []);

	const handleEvent = useCallback(
		(event: WorkerPoolEvent) => {
			appendLog(
				event.type.startsWith("worker-") ? "lifecycle" : "task",
				describeEvent(event),
			);
		},
		[appendLog],
	);

	const pool = useWorkerPool<WorkerApi>({
		maxConcurrentTasksPerWorker: config.concurrency,
		maxQueueSize: 48,
		onEvent: handleEvent,
		onUpdateStats: setStats,
		poolSize: config.size,
		proxyFactory,
		queueTimeoutMs: 5_000,
		reconfigureKey: config.revision,
		taskTimeoutMs: 30_000,
		workerFactory,
		workerIdleTimeoutMs: 30_000,
	});
	const fibTask = useWorkerTask(pool.api, "fibAsync");
	const textTask = useWorkerTask(pool.api, "analyzeText");

	const isBusy =
		fibTask.status === "running" ||
		textTask.status === "running" ||
		batch.status === "running";
	const poolReady = pool.poolStatus === "ready";
	const capacity =
		stats?.maxConcurrentTasks ?? config.size * config.concurrency;
	const utilization = capacity
		? Math.min(100, Math.round(((stats?.runningTasks ?? 0) / capacity) * 100))
		: 0;
	const visibleError = pool.error ?? fibTask.error ?? textTask.error;
	const latestLogId = logs.at(-1)?.id;

	const statusLabel = useMemo(() => {
		if (pool.poolStatus === "ready" && isBusy) return "working";
		return pool.poolStatus;
	}, [isBusy, pool.poolStatus]);

	useEffect(() => {
		if (latestLogId !== undefined && logListRef.current) {
			logListRef.current.scrollTop = logListRef.current.scrollHeight;
		}
	}, [latestLogId]);

	const applyConfig = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const size = Math.max(1, Math.min(16, Math.round(draftSize)));
		const concurrency = Math.max(1, Math.min(8, Math.round(draftConcurrency)));
		setDraftSize(size);
		setDraftConcurrency(concurrency);
		setStats(null);
		setBatch({ completed: 0, failed: 0, status: "idle" });
		setConfig((current) => ({
			concurrency,
			revision: current.revision + 1,
			size,
		}));
		appendLog(
			"lifecycle",
			`pool configuration applied: ${size} x ${concurrency}`,
		);
	};

	const runFibonacci = () => {
		void fibTask.run(fibInput).catch((error) => {
			appendLog("error", `fibonacci failed: ${toErrorMessage(error)}`);
		});
	};

	const runTextAnalysis = () => {
		void textTask.run(textInput).catch((error) => {
			appendLog("error", `text analysis failed: ${toErrorMessage(error)}`);
		});
	};

	const runBatch = async () => {
		if (!pool.api) return;
		const taskTotal = Math.max(1, Math.min(40, Math.round(batchCount)));
		const delayMs = Math.max(0, Math.min(5_000, Math.round(batchDelay)));
		setBatchCount(taskTotal);
		setBatchDelay(delayMs);
		setBatch({ completed: 0, failed: 0, status: "running" });
		const calls = Array.from({ length: taskTotal }, (_, index) =>
			pool.api?.delayedTransform(`task-${index + 1}`, delayMs),
		).filter(
			(
				call,
			): call is Promise<Awaited<ReturnType<WorkerApi["delayedTransform"]>>> =>
				Boolean(call),
		);
		const settled = await Promise.allSettled(calls);
		const completed = settled.filter(
			(result) => result.status === "fulfilled",
		).length;
		const failed = settled.length - completed;
		setBatch({
			completed,
			failed,
			status: failed > 0 ? "error" : "completed",
		});
		appendLog(
			failed > 0 ? "error" : "task",
			`batch settled: ${completed} completed, ${failed} failed`,
		);
	};

	return (
		<main className="app-shell">
			<header className="masthead">
				<div>
					<p className="eyebrow">Interactive worker lab</p>
					<h1>Comlink Worker Pool</h1>
					<p className="lede">
						Configure a real pool, dispatch typed React tasks, and inspect its
						scheduler live.
					</p>
				</div>
				<a
					className="source-link"
					href="https://github.com/natanelia/comlink-worker-pool"
					rel="noreferrer"
					target="_blank"
				>
					View source
				</a>
			</header>

			<section className="status-strip" aria-label="Live pool summary">
				<div className="pool-state">
					<span
						className={`status-dot status-${statusLabel}`}
						aria-hidden="true"
					/>
					<div>
						<span className="stat-label">Pool state</span>
						<strong>{statusLabel}</strong>
					</div>
				</div>
				<div className="summary-stat">
					<span className="stat-label">Workers</span>
					<strong>
						{stats?.workers ?? 0} / {config.size}
					</strong>
				</div>
				<div className="summary-stat">
					<span className="stat-label">Running</span>
					<strong>{stats?.runningTasks ?? 0}</strong>
				</div>
				<div className="summary-stat">
					<span className="stat-label">Queued</span>
					<strong>{stats?.queue ?? 0}</strong>
				</div>
				<div className="summary-stat">
					<span className="stat-label">Settled</span>
					<strong>
						{(stats?.completedTasks ?? 0) + (stats?.failedTasks ?? 0)}
					</strong>
				</div>
			</section>

			<div className="workspace-grid">
				<section
					className="panel workbench"
					aria-labelledby="workbench-heading"
				>
					<div className="panel-heading">
						<div>
							<p className="section-index">01 / Workbench</p>
							<h2 id="workbench-heading">Dispatch workloads</h2>
						</div>
						<span className="binding-badge">React hooks</span>
					</div>

					<form className="configuration" onSubmit={applyConfig}>
						<label>
							<span>Worker limit</span>
							<input
								max={16}
								min={1}
								onChange={(event) => updateFiniteNumber(event, setDraftSize)}
								required
								type="number"
								value={draftSize}
							/>
						</label>
						<label>
							<span>Tasks per worker</span>
							<input
								max={8}
								min={1}
								onChange={(event) =>
									updateFiniteNumber(event, setDraftConcurrency)
								}
								required
								type="number"
								value={draftConcurrency}
							/>
						</label>
						<button className="button button-secondary" type="submit">
							Apply and restart
						</button>
					</form>

					<div className="workload-list">
						<article className="workload">
							<div className="workload-copy">
								<span className="workload-kind">CPU task</span>
								<h3>Fibonacci</h3>
								<p>
									Run one recursive calculation through{" "}
									<code>useWorkerTask</code>.
								</p>
							</div>
							<div className="workload-action">
								<label>
									<span>Input</span>
									<input
										max={45}
										min={0}
										onChange={(event) => updateFiniteNumber(event, setFibInput)}
										required
										type="number"
										value={fibInput}
									/>
								</label>
								<button
									className="button button-primary"
									disabled={!poolReady || fibTask.status === "running"}
									onClick={runFibonacci}
									type="button"
								>
									{fibTask.status === "running" ? "Running" : "Calculate"}
								</button>
							</div>
							<output className="task-output" aria-live="polite">
								{fibTask.result === null
									? "No result yet"
									: `Result: ${fibTask.result}`}
							</output>
						</article>

						<article className="workload">
							<div className="workload-copy">
								<span className="workload-kind">Typed transform</span>
								<h3>Analyze text</h3>
								<p>
									Return a structured result from a dedicated worker method.
								</p>
							</div>
							<div className="workload-action workload-action-wide">
								<label>
									<span>Text</span>
									<input
										onChange={(event) =>
											setTextInput(event.currentTarget.value)
										}
										type="text"
										value={textInput}
									/>
								</label>
								<button
									className="button button-primary"
									disabled={
										!poolReady ||
										textTask.status === "running" ||
										textInput.length === 0
									}
									onClick={runTextAnalysis}
									type="button"
								>
									{textTask.status === "running" ? "Running" : "Analyze"}
								</button>
							</div>
							<output className="task-output" aria-live="polite">
								{textTask.result === null
									? "No result yet"
									: `${textTask.result.words} words, ${textTask.result.characters} characters, reversed: ${textTask.result.reversed}`}
							</output>
						</article>

						<article className="workload workload-featured">
							<div className="workload-copy">
								<span className="workload-kind">Scheduler probe</span>
								<h3>Saturate the pool</h3>
								<p>
									Queue deterministic delayed tasks and watch capacity move in
									real time.
								</p>
							</div>
							<div className="batch-controls">
								<label>
									<span>Tasks</span>
									<input
										max={40}
										min={1}
										onChange={(event) =>
											updateFiniteNumber(event, setBatchCount)
										}
										required
										type="number"
										value={batchCount}
									/>
								</label>
								<label>
									<span>Delay, ms</span>
									<input
										max={5_000}
										min={0}
										onChange={(event) =>
											updateFiniteNumber(event, setBatchDelay)
										}
										required
										type="number"
										value={batchDelay}
									/>
								</label>
								<button
									className="button button-primary"
									disabled={!poolReady || batch.status === "running"}
									onClick={() => void runBatch()}
									type="button"
								>
									{batch.status === "running" ? "Dispatching" : "Run batch"}
								</button>
							</div>
							<output className="task-output" aria-live="polite">
								{batch.status === "idle"
									? "No batch has run"
									: `${batch.completed} completed, ${batch.failed} failed`}
							</output>
						</article>
					</div>
				</section>

				<aside className="telemetry-column">
					<section
						className="panel telemetry"
						aria-labelledby="telemetry-heading"
					>
						<div className="panel-heading compact-heading">
							<div>
								<p className="section-index">02 / Telemetry</p>
								<h2 id="telemetry-heading">Scheduler health</h2>
							</div>
						</div>
						<div className="meter-heading">
							<span>Active capacity</span>
							<strong>{utilization}%</strong>
						</div>
						<div
							aria-label={`${utilization}% of task capacity is active`}
							aria-valuemax={100}
							aria-valuemin={0}
							aria-valuenow={utilization}
							className="meter"
							role="progressbar"
							tabIndex={0}
						>
							<span style={{ width: `${utilization}%` }} />
						</div>
						<dl className="telemetry-grid">
							<div>
								<dt>Capacity</dt>
								<dd>{capacity}</dd>
							</div>
							<div>
								<dt>Available</dt>
								<dd>{stats?.available ?? config.size}</dd>
							</div>
							<div>
								<dt>Started</dt>
								<dd>{stats?.startedTasks ?? 0}</dd>
							</div>
							<div>
								<dt>Completed</dt>
								<dd>{stats?.completedTasks ?? 0}</dd>
							</div>
							<div>
								<dt>Timed out</dt>
								<dd>{stats?.timedOutTasks ?? 0}</dd>
							</div>
							<div>
								<dt>Dropped</dt>
								<dd>{stats?.droppedTasks ?? 0}</dd>
							</div>
						</dl>
						<p className="configuration-note">
							Queue limit 48, queue deadline 5 seconds, task deadline 30
							seconds.
						</p>
					</section>

					<section
						className="panel event-panel"
						aria-labelledby="events-heading"
					>
						<div className="event-heading">
							<div>
								<p className="section-index">03 / Events</p>
								<h2 id="events-heading">Scheduler stream</h2>
							</div>
							<button
								className="text-button"
								onClick={() => setLogs([])}
								type="button"
							>
								Clear
							</button>
						</div>
						{visibleError ? (
							<p className="error-banner" role="alert">
								{toErrorMessage(visibleError)}
							</p>
						) : null}
						<ol className="event-list" ref={logListRef} aria-live="polite">
							{logs.length === 0 ? (
								<li className="empty-state">
									Dispatch a workload to populate the event stream.
								</li>
							) : (
								logs.map((entry) => (
									<li className={`event event-${entry.kind}`} key={entry.id}>
										<span>{String(entry.id).padStart(2, "0")}</span>
										<p>{entry.detail}</p>
									</li>
								))
							)}
						</ol>
					</section>
				</aside>
			</div>

			<footer>
				<span>
					Core scheduling and React lifecycle bindings, exercised in one browser
					session.
				</span>
				<code>
					{config.size} workers x {config.concurrency} tasks
				</code>
			</footer>
		</main>
	);
}

export default App;
