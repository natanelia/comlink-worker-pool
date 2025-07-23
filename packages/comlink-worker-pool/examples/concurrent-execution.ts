import { WorkerPool } from "../src/WorkerPool";
import * as Comlink from "comlink";

// Example worker API for I/O-bound operations
type ApiWorker = {
  fetchData(url: string): Promise<string>;
  processData(data: string, delay: number): Promise<string>;
};

// Simulate a worker that can handle concurrent I/O operations
const mockWorkerFactory = () => {
  // In a real scenario, this would be: new Worker(new URL("./api-worker.ts", import.meta.url))
  const worker = {
    postMessage: () => {},
    terminate: () => {},
    addEventListener: () => {},
  } as any;
  
  return worker;
};

const mockProxyFactory = (worker: Worker): ApiWorker => {
  // In a real scenario, this would be: Comlink.wrap<ApiWorker>(worker)
  return {
    async fetchData(url: string): Promise<string> {
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 100));
      return `Data from ${url}`;
    },
    async processData(data: string, delay: number): Promise<string> {
      await new Promise(resolve => setTimeout(resolve, delay));
      return `Processed: ${data}`;
    },
  };
};

async function demonstrateConcurrentExecution() {
  console.log("🚀 Demonstrating Concurrent Task Execution\n");

  // Create a pool with concurrent task execution enabled
  const pool = new WorkerPool<ApiWorker>({
    size: 2, // 2 workers
    maxConcurrentTasksPerWorker: 3, // Up to 3 concurrent tasks per worker
    workerFactory: mockWorkerFactory,
    proxyFactory: mockProxyFactory,
    onUpdateStats: (stats) => {
      console.log(`📊 Stats - Workers: ${stats.workers}, Running: ${stats.runningTasks}, Queue: ${stats.queue}`);
    },
  });

  const api = pool.getApi();

  console.log("Starting 6 concurrent I/O operations...");
  const startTime = Date.now();

  // These 6 tasks will be distributed across 2 workers
  // Each worker can handle up to 3 concurrent tasks
  const results = await Promise.all([
    api.fetchData("https://api1.example.com"),
    api.fetchData("https://api2.example.com"),
    api.fetchData("https://api3.example.com"),
    api.fetchData("https://api4.example.com"),
    api.fetchData("https://api5.example.com"),
    api.fetchData("https://api6.example.com"),
  ]);

  const duration = Date.now() - startTime;
  console.log(`\n✅ Completed ${results.length} tasks in ${duration}ms`);
  console.log("Results:", results);

  // Demonstrate mixed workload
  console.log("\n🔄 Demonstrating mixed workload...");
  const mixedResults = await Promise.all([
    api.fetchData("https://fast-api.com"),
    api.processData("some data", 50),
    api.fetchData("https://slow-api.com"),
    api.processData("more data", 75),
  ]);

  console.log("Mixed results:", mixedResults);

  // Show final stats
  const finalStats = pool.getStats();
  console.log("\n📈 Final Stats:", finalStats);

  pool.terminateAll();
}

// Comparison with sequential execution
async function compareWithSequential() {
  console.log("\n🔄 Comparing with Sequential Execution\n");

  // Sequential pool (default behavior)
  const sequentialPool = new WorkerPool<ApiWorker>({
    size: 2,
    // maxConcurrentTasksPerWorker defaults to 1
    workerFactory: mockWorkerFactory,
    proxyFactory: mockProxyFactory,
  });

  const sequentialApi = sequentialPool.getApi();

  console.log("Sequential execution (1 task per worker):");
  const seqStart = Date.now();
  
  const seqResults = await Promise.all([
    sequentialApi.fetchData("url1"),
    sequentialApi.fetchData("url2"),
    sequentialApi.fetchData("url3"),
    sequentialApi.fetchData("url4"),
  ]);
  
  const seqDuration = Date.now() - seqStart;
  console.log(`Sequential: ${seqResults.length} tasks in ${seqDuration}ms`);

  // Concurrent pool
  const concurrentPool = new WorkerPool<ApiWorker>({
    size: 2,
    maxConcurrentTasksPerWorker: 2, // 2 concurrent tasks per worker
    workerFactory: mockWorkerFactory,
    proxyFactory: mockProxyFactory,
  });

  const concurrentApi = concurrentPool.getApi();

  console.log("Concurrent execution (2 tasks per worker):");
  const concStart = Date.now();
  
  const concResults = await Promise.all([
    concurrentApi.fetchData("url1"),
    concurrentApi.fetchData("url2"),
    concurrentApi.fetchData("url3"),
    concurrentApi.fetchData("url4"),
  ]);
  
  const concDuration = Date.now() - concStart;
  console.log(`Concurrent: ${concResults.length} tasks in ${concDuration}ms`);

  console.log(`\n⚡ Performance improvement: ${Math.round((seqDuration / concDuration - 1) * 100)}% faster`);

  sequentialPool.terminateAll();
  concurrentPool.terminateAll();
}

// Run the demonstrations
if (require.main === module) {
  demonstrateConcurrentExecution()
    .then(() => compareWithSequential())
    .catch(console.error);
}

export { demonstrateConcurrentExecution, compareWithSequential };
