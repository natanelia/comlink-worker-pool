import * as Comlink from "comlink";
import { useWorkerPool } from "comlink-worker-pool-react";
import type { WorkerPoolStats } from "comlink-worker-pool";
import { useEffect, useRef, useState } from "react";
import "./index.css";

const workerFactory = () =>
	new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

type WorkerApi = {
	fibAsync: (n: number) => Promise<number>;
	countWords: (text: string) => Promise<number>;
	reverseString: (text: string) => Promise<string>;
};

const proxyFactory = (worker: Worker) => Comlink.wrap<WorkerApi>(worker);

function App() {
	const [inputNumber, setInputNumber] = useState(40);
	const [taskCount, setTaskCount] = useState(10);
	const [inputText, setInputText] = useState("");
	const [reverseText, setReverseText] = useState("");
	const [logs, setLogs] = useState<{ key: string; text: string }[]>([]);
	const logsListRef = useRef<HTMLUListElement>(null);

	const { pool, stats, setStats } = useWorkerPool<WorkerApi>({
		size: navigator.hardwareConcurrency || 4,
		workerFactory,
		proxyFactory,
		workerIdleTimeoutMs: 1000,
	});

	// Utility to format log messages
	const formatLog = (label: string, result: unknown) =>
		`${label}: ${typeof result === "object" ? JSON.stringify(result) : result}`;

	/**
	 * Helper to run N tasks in parallel and log each result
	 * @param taskFn - async function returning the result
	 * @param label - label to display in the log
	 */
	const runAndLogTasks = async (
		taskFn: () => Promise<unknown>,
		label: string,
	) => {
		const tasks: Promise<void>[] = [];
		for (let i = 0; i < taskCount; i++) {
			tasks.push(
				(async () => {
					const result = await taskFn();
					setLogs((prev) => [
						...prev,
						{
							key: Date.now() + Math.random().toString(),
							text: formatLog(label, result),
						},
					]);
				})(),
			);
		}
		await Promise.all(tasks);
	};

	const runTasks = async () => {
		if (!pool) return;
		const api = pool.getApi();
		await runAndLogTasks(
			() => api.fibAsync(inputNumber),
			`Fib(${inputNumber})`,
		);
	};

	const runCountWords = async () => {
		if (!pool) return;
		const api = pool.getApi();
		await runAndLogTasks(
			() => api.countWords(inputText),
			`CountWords("${inputText}")`,
		);
	};

	const runReverseString = async () => {
		if (!pool) return;
		const api = pool.getApi();
		await runAndLogTasks(
			() => api.reverseString(reverseText),
			`ReverseString("${reverseText}")`,
		);
	};

	// Auto-scroll logs to bottom when logs change
	useEffect(() => {
		if (logs && logsListRef.current) {
			logsListRef.current.scrollTop = logsListRef.current.scrollHeight;
		}
	}, [logs]);

	return (
		<div className="min-h-screen px-2 py-8 font-sans bg-gradient-to-tr from-organic-50 via-organic-100 to-organic-200">
			<div className="max-w-6xl mx-auto">
				<h1 className="mb-12 text-5xl font-extrabold tracking-tight text-center text-organic-400 font-display drop-shadow">
					Comlink Worker Pool Playground
				</h1>
				{/* Controls & Worker Stats */}
				<div className="flex flex-wrap items-end justify-center gap-8 mb-10">
					<label className="flex flex-col gap-1 min-w-[200px] text-base font-semibold">
						<span className="text-organic-300">
							Tasks (parallel for all actions)
						</span>
						<input
							type="number"
							aria-label="Number of parallel tasks"
							value={taskCount}
							min={1}
							max={100}
							onChange={(e) => setTaskCount(Number(e.target.value))}
							className="px-4 py-3 text-lg transition border-2 shadow-sm bg-organic-50 border-organic-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-organic-300 focus:bg-organic-100"
						/>
					</label>
					<div className="flex flex-row flex-wrap items-end gap-5 py-3 border shadow bg-organic-50/90 rounded-2xl px-7 border-organic-200">
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Workers</span>
							<span className="text-xl font-bold text-organic-300">
								{stats?.size ?? 0}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Available</span>
							<span className="text-xl font-bold text-organic-300">
								{stats?.available ?? 0}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Queue</span>
							<span className="text-xl font-bold text-organic-300">
								{stats?.queue ?? 0}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Active Workers</span>
							<span className="text-lg font-bold text-organic-300">
								{stats?.workers ?? 0}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Idle Workers</span>
							<span className="text-lg font-bold text-organic-300">
								{stats?.idleWorkers ?? 0}
							</span>
						</div>
					</div>
				</div>
				<div className="grid gap-8 mb-10 md:grid-cols-3">
					{/* Fibonacci Section */}
					<div className="relative flex flex-col gap-6 p-8 transition-shadow border-l-8 shadow-xl bg-organic-50/80 border-organic-200 rounded-2xl hover:shadow-2xl group">
						<div className="absolute text-3xl select-none -left-6 top-6">
							🧮
						</div>
						<h2 className="flex items-center gap-2 mb-1 text-xl font-bold text-organic-900 font-display">
							Fibonacci Calculator
						</h2>
						<label className="flex flex-col gap-1 text-base font-semibold">
							<span>Number (n)</span>
							<input
								type="number"
								value={inputNumber}
								min={1}
								max={100}
								onChange={(e) => setInputNumber(Number(e.target.value))}
								className="px-4 py-3 text-lg transition border rounded-lg border-organic-200 bg-organic-50 focus:outline-none focus:ring-2 focus:ring-organic-400 focus:bg-organic-100"
							/>
						</label>
						<button
							className="px-5 py-3 text-lg font-bold transition shadow text-organic-900 bg-organic-200 rounded-xl hover:bg-organic-300 hover:shadow-lg"
							type="button"
							onClick={runTasks}
						>
							Calculate Fib (n)
						</button>
						<span className="mt-1 text-xs text-organic-500">
							Runs <b>{taskCount}</b> parallel Fibonacci calculations for n.
						</span>
					</div>

					{/* CountWords Section */}
					<div className="relative flex flex-col gap-6 p-8 transition-shadow border-l-8 shadow-xl bg-organic-50/80 border-organic-200 rounded-2xl hover:shadow-2xl group">
						<div className="absolute text-3xl select-none -left-6 top-6">
							📖
						</div>
						<h2 className="flex items-center gap-2 mb-1 text-xl font-bold text-organic-900 font-display">
							Word Counter
						</h2>
						<label className="flex flex-col gap-1 text-base font-semibold">
							<span>Input Text</span>
							<input
								type="text"
								value={inputText}
								onChange={(e) => setInputText(e.target.value)}
								placeholder="Type a sentence or paragraph..."
								className="px-4 py-3 text-lg transition border rounded-lg border-organic-200 bg-organic-50 focus:outline-none focus:ring-2 focus:ring-organic-400 focus:bg-organic-100"
							/>
						</label>
						<button
							className="px-5 py-3 text-lg font-bold transition shadow text-organic-900 bg-organic-200 rounded-xl hover:bg-organic-300 hover:shadow-lg"
							type="button"
							onClick={runCountWords}
						>
							Count Words
						</button>
						<span className="mt-1 text-xs text-organic-500">
							Counts the number of words in the input text, running{" "}
							<b>{taskCount}</b> tasks in parallel.
						</span>
					</div>

					{/* ReverseString Section */}
					<div className="relative flex flex-col gap-6 p-8 transition-shadow border-l-8 shadow-xl bg-organic-50/80 border-organic-200 rounded-2xl hover:shadow-2xl group">
						<div className="absolute text-3xl select-none -left-6 top-6">
							🔄
						</div>
						<h2 className="flex items-center gap-2 mb-1 text-xl font-bold text-organic-900 font-display">
							String Reverser
						</h2>
						<label className="flex flex-col gap-1 text-base font-semibold">
							<span>Input Text</span>
							<input
								type="text"
								value={reverseText}
								onChange={(e) => setReverseText(e.target.value)}
								placeholder="Type text to reverse..."
								className="px-4 py-3 text-lg transition border rounded-lg border-organic-200 bg-organic-50 focus:outline-none focus:ring-2 focus:ring-organic-400 focus:bg-organic-100"
							/>
						</label>
						<button
							className="px-5 py-3 text-lg font-bold transition shadow text-organic-900 bg-organic-200 rounded-xl hover:bg-organic-300 hover:shadow-lg"
							type="button"
							onClick={runReverseString}
						>
							Reverse String
						</button>
						<span className="mt-1 text-xs text-organic-500">
							Reverses the input text, running <b>{taskCount}</b> tasks in
							parallel.
						</span>
					</div>
				</div>

				<div className="shadow rounded-xl">
					<div className="flex items-center justify-between gap-2 px-6 py-3 text-lg font-semibold border-b text-organic-400 bg-gradient-to-r from-organic-100 to-organic-100 border-organic-200 rounded-t-xl font-display">
						<div>
							<span>📜</span> Logs
						</div>
						<button
							className="flex items-center justify-center px-5 py-1 transition shadow text-organic-50 bg-organic-500 rounded-xl hover:bg-organic-600 focus:outline-none focus:ring-2 focus:ring-organic-400"
							type="button"
							onClick={() => setLogs([])}
							title="Clear all logs"
							aria-label="Clear logs"
						>
							Clear
						</button>
					</div>
					<ul
						ref={logsListRef}
						className="px-6 py-4 m-0 overflow-y-auto font-mono text-sm list-none max-h-96 bg-organic-50"
					>
						{logs.length === 0 && (
							<li className="italic text-organic-300">No logs yet.</li>
						)}
						{logs.map((log) => (
							<li key={log.key} className="mb-1 break-all text-organic-900">
								{log.text}
							</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	);
}

export default App;
