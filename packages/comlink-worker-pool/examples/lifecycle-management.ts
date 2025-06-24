/**
 * Example demonstrating worker lifecycle management features
 */

import { WorkerPool } from "../src/WorkerPool";
import * as Comlink from "comlink";

// Define worker API
type WorkerApi = {
  processData(data: string): Promise<string>;
  heavyComputation(n: number): Promise<number>;
};

// Create worker pool with lifecycle management
const pool = new WorkerPool<WorkerApi>({
  size: 2,
  
  // Worker factories
  workerFactory: () => new Worker(new URL("./example-worker.ts", import.meta.url), { type: "module" }),
  proxyFactory: (worker) => Comlink.wrap<WorkerApi>(worker),
  
  // Lifecycle management options
  maxTasksPerWorker: 10,        // Terminate workers after 10 tasks
  maxWorkerLifetimeMs: 60000,   // Terminate workers after 1 minute
  workerIdleTimeoutMs: 30000,   // Terminate idle workers after 30 seconds
  
  // Monitor pool statistics
  onUpdateStats: (stats) => {
    console.log(`Pool Stats - Workers: ${stats.workers}, Idle: ${stats.idleWorkers}, Queue: ${stats.queue}`);
  },
});

async function demonstrateLifecycleManagement() {
  const api = pool.getApi();
  
  console.log("Starting lifecycle management demonstration...");
  
  // Execute multiple tasks to trigger maxTasksPerWorker termination
  console.log("\n1. Testing maxTasksPerWorker (10 tasks per worker):");
  for (let i = 0; i < 25; i++) {
    const result = await api.processData(`Task ${i + 1}`);
    console.log(`Task ${i + 1} result: ${result}`);
    
    if (i % 5 === 4) {
      // Show stats every 5 tasks
      console.log("Current stats:", pool.getStats());
    }
  }
  
  console.log("\n2. Testing maxWorkerLifetimeMs (waiting for workers to expire):");
  console.log("Waiting 65 seconds for workers to exceed lifetime...");
  
  // Wait for workers to exceed lifetime
  await new Promise(resolve => setTimeout(resolve, 65000));
  
  // Execute a task to trigger new worker creation
  const result = await api.processData("Post-lifetime task");
  console.log("Post-lifetime task result:", result);
  console.log("Final stats:", pool.getStats());
  
  console.log("\n3. Testing workerIdleTimeoutMs (workers will be terminated after 30s of inactivity):");
  console.log("Workers should be terminated automatically after 30 seconds of inactivity.");
  
  // Clean up
  pool.terminateAll();
  console.log("\nDemo completed. All workers terminated.");
}

// Run the demonstration
demonstrateLifecycleManagement().catch(console.error);
