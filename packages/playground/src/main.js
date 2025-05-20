import * as Comlink from "comlink";
import { WorkerPool } from "comlink-worker-pool";

// DOM Elements
const taskCountInput = document.getElementById("taskCount");
const fibInput = document.getElementById("fibInput");
const wordCountInput = document.getElementById("wordCountInput");
const reverseStringInput = document.getElementById("reverseStringInput");

const runFibButton = document.getElementById("runFib");
const runCountWordsButton = document.getElementById("runCountWords");
const runReverseStringButton = document.getElementById("runReverseString");

const logsContainer = document.getElementById("logsContainer");
const clearLogsButton = document.getElementById("clearLogs");

const statSize = document.getElementById("statSize");
const statAvailable = document.getElementById("statAvailable");
const statQueue = document.getElementById("statQueue");
const statWorkers = document.getElementById("statWorkers");
const statIdleWorkers = document.getElementById("statIdleWorkers");

let pool;

const workerFactory = () =>
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

const proxyFactory = (worker) => Comlink.wrap(worker);

function updateStatsDisplay(stats) {
  if (!stats) return;
  statSize.textContent = stats.size;
  statAvailable.textContent = stats.available;
  statQueue.textContent = stats.queue;
  statWorkers.textContent = stats.workers;
  statIdleWorkers.textContent = stats.idleWorkers;
}

function initializePool() {
  const size = navigator.hardwareConcurrency || 4;
  pool = new WorkerPool({
    size,
    workerFactory,
    proxyFactory,
    onUpdateStats: updateStatsDisplay,
    workerIdleTimeoutMs: 1000,
  });
  updateStatsDisplay(pool.getStats());
}

function addLog(message) {
  const logEntry = document.createElement("div");
  logEntry.className = "log-entry";
  logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logsContainer.appendChild(logEntry);
  logsContainer.scrollTop = logsContainer.scrollHeight; // Auto-scroll
}

function clearLogs() {
  logsContainer.innerHTML = "";
}

clearLogsButton.addEventListener("click", clearLogs);

async function runAndLogTasks(taskFn, label, input) {
  if (!pool) return;
  const api = pool.getApi();
  const numTasks = parseInt(taskCountInput.value, 10);
  addLog(`Starting ${numTasks} "${label}" tasks for input: ${input}...`);

  const tasks = [];
  for (let i = 0; i < numTasks; i++) {
    tasks.push(
      (async () => {
        try {
          const result = await taskFn(api, input);
          addLog(`"${label}" result: ${result}`);
        } catch (error) {
          addLog(`"${label}" error: ${error.message}`);
          console.error(error);
        }
      })(),
    );
  }
  await Promise.all(tasks);
  addLog(`Finished ${numTasks} "${label}" tasks.`);
}

runFibButton.addEventListener("click", () => {
  const n = parseInt(fibInput.value, 10);
  runAndLogTasks(async (api, val) => api.fibAsync(val), "Fibonacci", n);
});

runCountWordsButton.addEventListener("click", () => {
  const text = wordCountInput.value;
  runAndLogTasks(async (api, val) => api.countWords(val), "Count Words", text);
});

runReverseStringButton.addEventListener("click", () => {
  const text = reverseStringInput.value;
  runAndLogTasks(async (api, val) => api.reverseString(val), "Reverse String", text);
});

// Initialize
initializePool();

// Handle page unload to terminate workers
window.addEventListener("beforeunload", () => {
  if (pool) {
    pool.terminateAll();
  }
});

addLog("Playground initialized. Worker pool created.");
