import * as Comlink from "comlink";
import { WorkerPool, type WorkerPoolStats } from "comlink-worker-pool";
import { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";

const workerFactory = () =>
	new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

type WorkerApi = {
	fibAsync: (n: number) => Promise<number>;
	countWords: (text: string) => Promise<number>;
	reverseString: (text: string) => Promise<string>;
	fetchData: (url: string, delay?: number) => Promise<string>;
	processData: (data: string, delay?: number) => Promise<string>;
};

const proxyFactory = (worker: Worker) => Comlink.wrap<WorkerApi>(worker);

function App() {
	const [pool, setPool] = useState<WorkerPool<WorkerApi> | null>(null);
	const [inputNumber, setInputNumber] = useState(40);
	const [taskCount, setTaskCount] = useState(10);
	const [inputText, setInputText] = useState("");
	const [reverseText, setReverseText] = useState("");
	const [logs, setLogs] = useState<{ key: string; text: string }[]>([]);
	const logsListRef = useRef<HTMLUListElement>(null);
	
	// New state for concurrent execution configuration
	const [poolSize, setPoolSize] = useState(navigator.hardwareConcurrency || 4);
	const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(1);
	const [isRecreatingPool, setIsRecreatingPool] = useState(false);

	// Function to create/recreate the pool with current settings
	const createPool = useCallback(() => {
		return new WorkerPool<WorkerApi>({
			size: poolSize,
			maxConcurrentTasksPerWorker: maxConcurrentTasks,
			workerFactory,
			proxyFactory,
			onUpdateStats: setStats,
			workerIdleTimeoutMs: 1000,
		});
	}, [poolSize, maxConcurrentTasks]);

	useEffect(() => {
		const p = createPool();
		setPool(p);
		setStats(p.getStats());
		return () => {
			p.terminateAll();
		};
	}, [createPool]);

	// Function to recreate pool when configuration changes
	const recreatePool = async () => {
		if (!pool) return;
		
		setIsRecreatingPool(true);
		pool.terminateAll();
		
		// Small delay to ensure cleanup
		await new Promise(resolve => setTimeout(resolve, 100));
		
		const newPool = createPool();
		setPool(newPool);
		setStats(newPool.getStats());
		setIsRecreatingPool(false);
		
		setLogs(prev => [...prev, {
			key: Date.now().toString(),
			text: `🔄 Pool recreated: ${poolSize} workers, ${maxConcurrentTasks} max concurrent tasks per worker`
		}]);
	};

	const [stats, setStats] = useState<WorkerPoolStats>({
		size: 0,
		available: 0,
		queue: 0,
		workers: 0,
		idleWorkers: 0,
		runningTasks: 0,
		availableForConcurrency: 0,
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

	// New I/O-bound task functions to demonstrate concurrent execution
	const runFetchData = async () => {
		if (!pool) return;
		const api = pool.getApi();
		const urls = [
			"https://api.example.com/data1",
			"https://api.example.com/data2", 
			"https://api.example.com/data3",
			"https://jsonplaceholder.typicode.com/posts/1",
			"https://jsonplaceholder.typicode.com/posts/2",
		];
		
		const tasks: Promise<void>[] = [];
		for (let i = 0; i < taskCount; i++) {
			const url = urls[i % urls.length];
			tasks.push(
				(async () => {
					const result = await api.fetchData(url, 500 + Math.random() * 1000);
					setLogs((prev) => [
						...prev,
						{
							key: Date.now() + Math.random().toString(),
							text: formatLog(`FetchData("${url}")`, result),
						},
					]);
				})(),
			);
		}
		await Promise.all(tasks);
	};

	const runProcessData = async () => {
		if (!pool) return;
		const api = pool.getApi();
		const dataItems = [
			"user data batch 1",
			"analytics data batch 2", 
			"metrics data batch 3",
			"logs data batch 4",
			"events data batch 5",
		];
		
		const tasks: Promise<void>[] = [];
		for (let i = 0; i < taskCount; i++) {
			const data = dataItems[i % dataItems.length];
			tasks.push(
				(async () => {
					const result = await api.processData(data, 300 + Math.random() * 700);
					setLogs((prev) => [
						...prev,
						{
							key: Date.now() + Math.random().toString(),
							text: formatLog(`ProcessData("${data}")`, result),
						},
					]);
				})(),
			);
		}
		await Promise.all(tasks);
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
				<h1 className="mb-8 text-5xl font-extrabold tracking-tight text-center text-organic-400 font-display drop-shadow">
					Comlink Worker Pool Playground
				</h1>
				
				{/* Pool Configuration Section */}
				<div className="mb-8 p-6 bg-organic-50/90 border-2 border-organic-200 rounded-2xl shadow-lg">
					<h2 className="mb-4 text-2xl font-bold text-organic-400 font-display">
						⚙️ Pool Configuration
					</h2>
					<div className="grid gap-4 md:grid-cols-3">
						<label className="flex flex-col gap-2">
							<span className="text-sm font-semibold text-organic-300">
								Pool Size (Workers)
							</span>
							<input
								type="number"
								value={poolSize}
								min={1}
								max={16}
								onChange={(e) => setPoolSize(Number(e.target.value))}
								className="px-3 py-2 text-base border rounded-lg border-organic-200 bg-organic-50 focus:outline-none focus:ring-2 focus:ring-organic-300"
							/>
						</label>
						<label className="flex flex-col gap-2">
							<span className="text-sm font-semibold text-organic-300">
								Max Concurrent Tasks Per Worker
							</span>
							<input
								type="number"
								value={maxConcurrentTasks}
								min={1}
								max={10}
								onChange={(e) => setMaxConcurrentTasks(Number(e.target.value))}
								className="px-3 py-2 text-base border rounded-lg border-organic-200 bg-organic-50 focus:outline-none focus:ring-2 focus:ring-organic-300"
							/>
						</label>
						<div className="flex items-end">
							<button
								onClick={recreatePool}
								disabled={isRecreatingPool}
								className="w-full px-4 py-2 text-base font-semibold transition shadow text-organic-50 bg-organic-400 rounded-lg hover:bg-organic-500 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{isRecreatingPool ? "Updating..." : "Apply Changes"}
							</button>
						</div>
					</div>
					<div className="mt-3 text-xs text-organic-500">
						<p><strong>Pool Size:</strong> Number of worker threads in the pool</p>
						<p><strong>Max Concurrent Tasks:</strong> How many tasks each worker can handle simultaneously (great for I/O-bound operations)</p>
					</div>
				</div>

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
								{stats.size}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Available</span>
							<span className="text-xl font-bold text-organic-300">
								{stats.available}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Queue</span>
							<span className="text-xl font-bold text-organic-300">
								{stats.queue}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Active Workers</span>
							<span className="text-lg font-bold text-organic-300">
								{stats.workers}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Idle Workers</span>
							<span className="text-lg font-bold text-organic-300">
								{stats.idleWorkers}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Running Tasks</span>
							<span className="text-lg font-bold text-green-600">
								{stats.runningTasks}
							</span>
						</div>
						<div className="flex flex-col items-center min-w-[70px]">
							<span className="text-xs text-organic-300">Can Accept More</span>
							<span className="text-lg font-bold text-blue-600">
								{stats.availableForConcurrency}
							</span>
						</div>
					</div>
				</div>
				<div className="grid gap-6 mb-10 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
					{/* Fibonacci Section - CPU Bound */}
					<div className="relative flex flex-col gap-4 p-6 transition-shadow border-l-8 shadow-xl bg-organic-50/80 border-red-200 rounded-2xl hover:shadow-2xl group">
						<div className="absolute text-2xl select-none -left-5 top-4">
							🧮
						</div>
						<h2 className="flex items-center gap-2 mb-1 text-lg font-bold text-organic-900 font-display">
							Fibonacci Calculator
						</h2>
						<span className="text-xs font-semibold text-red-600 bg-red-100 px-2 py-1 rounded">
							CPU-BOUND
						</span>
						<label className="flex flex-col gap-1 text-sm font-semibold">
							<span>Number (n)</span>
							<input
								type="number"
								value={inputNumber}
								min={1}
								max={100}
								onChange={(e) => setInputNumber(Number(e.target.value))}
								className="px-3 py-2 text-base transition border rounded-lg border-organic-200 bg-organic-50 focus:outline-none focus:ring-2 focus:ring-organic-400 focus:bg-organic-100"
							/>
						</label>
						<button
							className="px-4 py-2 text-base font-bold transition shadow text-organic-900 bg-organic-200 rounded-xl hover:bg-organic-300 hover:shadow-lg"
							type="button"
							onClick={runTasks}
						>
							Calculate Fib (n)
						</button>
						<span className="mt-1 text-xs text-organic-500">
							Runs <b>{taskCount}</b> parallel Fibonacci calculations. Best with maxConcurrent=1.
						</span>
					</div>

					{/* CountWords Section - I/O Bound */}
					<div className="relative flex flex-col gap-4 p-6 transition-shadow border-l-8 shadow-xl bg-organic-50/80 border-blue-200 rounded-2xl hover:shadow-2xl group">
						<div className="absolute text-2xl select-none -left-5 top-4">
							📖
						</div>
						<h2 className="flex items-center gap-2 mb-1 text-lg font-bold text-organic-900 font-display">
							Word Counter
						</h2>
						<span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-1 rounded">
							I/O-BOUND
						</span>
						<label className="flex flex-col gap-1 text-sm font-semibold">
							<span>Input Text</span>
							<input
								type="text"
								value={inputText}
								onChange={(e) => setInputText(e.target.value)}
								placeholder="Type a sentence..."
								className="px-3 py-2 text-base transition border rounded-lg border-organic-200 bg-organic-50 focus:outline-none focus:ring-2 focus:ring-organic-400 focus:bg-organic-100"
							/>
						</label>
						<button
							className="px-4 py-2 text-base font-bold transition shadow text-organic-900 bg-organic-200 rounded-xl hover:bg-organic-300 hover:shadow-lg"
							type="button"
							onClick={runCountWords}
						>
							Count Words
						</button>
						<span className="mt-1 text-xs text-organic-500">
							Counts words with simulated delay. Benefits from concurrent execution.
						</span>
					</div>

					{/* ReverseString Section - I/O Bound */}
					<div className="relative flex flex-col gap-4 p-6 transition-shadow border-l-8 shadow-xl bg-organic-50/80 border-blue-200 rounded-2xl hover:shadow-2xl group">
						<div className="absolute text-2xl select-none -left-5 top-4">
							🔄
						</div>
						<h2 className="flex items-center gap-2 mb-1 text-lg font-bold text-organic-900 font-display">
							String Reverser
						</h2>
						<span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-1 rounded">
							I/O-BOUND
						</span>
						<label className="flex flex-col gap-1 text-sm font-semibold">
							<span>Input Text</span>
							<input
								type="text"
								value={reverseText}
								onChange={(e) => setReverseText(e.target.value)}
								placeholder="Type text to reverse..."
								className="px-3 py-2 text-base transition border rounded-lg border-organic-200 bg-organic-50 focus:outline-none focus:ring-2 focus:ring-organic-400 focus:bg-organic-100"
							/>
						</label>
						<button
							className="px-4 py-2 text-base font-bold transition shadow text-organic-900 bg-organic-200 rounded-xl hover:bg-organic-300 hover:shadow-lg"
							type="button"
							onClick={runReverseString}
						>
							Reverse String
						</button>
						<span className="mt-1 text-xs text-organic-500">
							Reverses text with simulated delay. Benefits from concurrent execution.
						</span>
					</div>

					{/* Fetch Data Section - I/O Bound */}
					<div className="relative flex flex-col gap-4 p-6 transition-shadow border-l-8 shadow-xl bg-organic-50/80 border-green-200 rounded-2xl hover:shadow-2xl group">
						<div className="absolute text-2xl select-none -left-5 top-4">
							🌐
						</div>
						<h2 className="flex items-center gap-2 mb-1 text-lg font-bold text-organic-900 font-display">
							Data Fetcher
						</h2>
						<span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded">
							I/O-BOUND
						</span>
						<div className="flex-1 flex flex-col justify-center">
							<p className="text-sm text-organic-600 mb-3">
								Simulates fetching data from various APIs with random delays.
							</p>
						</div>
						<button
							className="px-4 py-2 text-base font-bold transition shadow text-organic-900 bg-organic-200 rounded-xl hover:bg-organic-300 hover:shadow-lg"
							type="button"
							onClick={runFetchData}
						>
							Fetch Data
						</button>
						<span className="mt-1 text-xs text-organic-500">
							Perfect for testing concurrent execution with high maxConcurrent values.
						</span>
					</div>

					{/* Process Data Section - I/O Bound */}
					<div className="relative flex flex-col gap-4 p-6 transition-shadow border-l-8 shadow-xl bg-organic-50/80 border-purple-200 rounded-2xl hover:shadow-2xl group">
						<div className="absolute text-2xl select-none -left-5 top-4">
							⚙️
						</div>
						<h2 className="flex items-center gap-2 mb-1 text-lg font-bold text-organic-900 font-display">
							Data Processor
						</h2>
						<span className="text-xs font-semibold text-purple-600 bg-purple-100 px-2 py-1 rounded">
							I/O-BOUND
						</span>
						<div className="flex-1 flex flex-col justify-center">
							<p className="text-sm text-organic-600 mb-3">
								Simulates processing data batches with variable delays.
							</p>
						</div>
						<button
							className="px-4 py-2 text-base font-bold transition shadow text-organic-900 bg-organic-200 rounded-xl hover:bg-organic-300 hover:shadow-lg"
							type="button"
							onClick={runProcessData}
						>
							Process Data
						</button>
						<span className="mt-1 text-xs text-organic-500">
							Great for demonstrating concurrent task processing benefits.
						</span>
					</div>
				</div>

				{/* Information Section */}
				<div className="mb-8 p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 rounded-2xl shadow-lg">
					<h2 className="mb-4 text-xl font-bold text-blue-600 font-display">
						💡 Understanding Concurrent Execution
					</h2>
					<div className="grid gap-4 md:grid-cols-2">
						<div>
							<h3 className="font-semibold text-blue-800 mb-2">🔴 CPU-Bound Tasks (Red)</h3>
							<p className="text-sm text-blue-700">
								Tasks like Fibonacci calculations use CPU intensively. For these, keep 
								<strong> Max Concurrent Tasks = 1</strong> to avoid competing for CPU resources.
							</p>
						</div>
						<div>
							<h3 className="font-semibold text-blue-800 mb-2">🔵 I/O-Bound Tasks (Blue/Green/Purple)</h3>
							<p className="text-sm text-blue-700">
								Tasks with delays (network requests, file operations) benefit from 
								<strong> Max Concurrent Tasks &gt; 1</strong>. Try setting it to 3-5 and see the performance improvement!
							</p>
						</div>
					</div>
					<div className="mt-4 p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
						<p className="text-sm text-yellow-800">
							<strong>💡 Tip:</strong> Watch the "Running Tasks" and "Can Accept More" stats while tasks execute. 
							With concurrent execution enabled, you'll see multiple tasks running simultaneously on each worker!
						</p>
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
