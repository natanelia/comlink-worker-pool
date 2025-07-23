import { describe, expect, test } from "bun:test";
import { WorkerPool } from "./WorkerPool";
import * as Comlink from "comlink";

type WorkerApi = {
  echo(x: string): Promise<string>;
  delay(ms: number): Promise<void>;
  delayAndReturn(ms: number, value: string): Promise<string>;
};

describe("WorkerPool - Concurrent Task Execution", () => {
  function createTestWorker(): Worker {
    return new Worker(
      new URL("./__mocks__/comlinkWorker.ts", import.meta.url),
      {
        type: "module",
      },
    );
  }

  function comlinkProxyFactory(worker: Worker): WorkerApi {
    const base = Comlink.wrap<WorkerApi>(worker);
    return {
      echo: (x: string) => base.echo(x),
      delay: (ms: number) => base.delay(ms),
      delayAndReturn: async (ms: number, value: string) => {
        await base.delay(ms);
        return base.echo(value);
      },
    };
  }

  test("single worker can handle multiple concurrent tasks", async () => {
    const pool = new WorkerPool({
      size: 1, // Only one worker
      maxConcurrentTasksPerWorker: 3, // Allow 3 concurrent tasks
      workerFactory: createTestWorker,
      proxyFactory: comlinkProxyFactory,
    });

    const api = pool.getApi();
    const startTime = Date.now();

    // Start 3 tasks that each take 100ms - they should run concurrently
    const results = await Promise.all([
      api.delayAndReturn(100, "task1"),
      api.delayAndReturn(100, "task2"),
      api.delayAndReturn(100, "task3"),
    ]);

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(results).toEqual(["task1", "task2", "task3"]);
    // Should complete in ~100ms (concurrent) rather than ~300ms (sequential)
    expect(duration).toBeLessThan(200); // Allow some margin for execution overhead
  });

  test("respects maxConcurrentTasksPerWorker limit", async () => {
    const statsHistory: any[] = [];
    const pool = new WorkerPool({
      size: 1,
      maxConcurrentTasksPerWorker: 2, // Limit to 2 concurrent tasks
      workerFactory: createTestWorker,
      proxyFactory: comlinkProxyFactory,
      onUpdateStats: (stats) => statsHistory.push({ ...stats }),
    });

    const api = pool.getApi();

    // Start 4 tasks - only 2 should run concurrently, 2 should queue
    const promises = [
      api.delayAndReturn(50, "task1"),
      api.delayAndReturn(50, "task2"),
      api.delayAndReturn(50, "task3"),
      api.delayAndReturn(50, "task4"),
    ];

    // Wait a bit to let the first batch start
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Check that we have queued tasks
    const stats = pool.getStats();
    expect(stats.queue).toBeGreaterThan(0);
    expect(stats.runningTasks).toBeLessThanOrEqual(2);

    const results = await Promise.all(promises);
    expect(results).toEqual(["task1", "task2", "task3", "task4"]);
  });

  test("multiple workers with concurrent tasks", async () => {
    const pool = new WorkerPool({
      size: 2, // Two workers
      maxConcurrentTasksPerWorker: 2, // 2 concurrent tasks per worker
      workerFactory: createTestWorker,
      proxyFactory: comlinkProxyFactory,
    });

    const api = pool.getApi();
    const startTime = Date.now();

    // Start 4 tasks - should run 2 per worker concurrently
    const results = await Promise.all([
      api.delayAndReturn(100, "task1"),
      api.delayAndReturn(100, "task2"),
      api.delayAndReturn(100, "task3"),
      api.delayAndReturn(100, "task4"),
    ]);

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(results).toEqual(["task1", "task2", "task3", "task4"]);
    // Should complete in ~100ms (all concurrent) rather than ~200ms+ (sequential)
    expect(duration).toBeLessThan(200);
  });

  test("stats correctly reflect concurrent execution", async () => {
    const statsHistory: any[] = [];
    const pool = new WorkerPool({
      size: 1,
      maxConcurrentTasksPerWorker: 3,
      workerFactory: createTestWorker,
      proxyFactory: comlinkProxyFactory,
      onUpdateStats: (stats) => statsHistory.push({ ...stats }),
    });

    const api = pool.getApi();

    // Start 3 concurrent tasks
    const promises = [
      api.delayAndReturn(100, "task1"),
      api.delayAndReturn(100, "task2"),
      api.delayAndReturn(100, "task3"),
    ];

    // Wait a bit for tasks to start
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const stats = pool.getStats();
    expect(stats.runningTasks).toBe(3);
    expect(stats.workers).toBe(1);
    expect(stats.idleWorkers).toBe(0);
    expect(stats.availableForConcurrency).toBe(0); // Worker is at capacity

    await Promise.all(promises);

    // Wait a bit more to ensure all cleanup is done
    await new Promise(resolve => setTimeout(resolve, 10));

    // After completion, worker should be idle
    const finalStats = pool.getStats();
    expect(finalStats.runningTasks).toBe(0);
    expect(finalStats.idleWorkers).toBe(1);
  });

  test("backwards compatibility - defaults to 1 concurrent task", async () => {
    const pool = new WorkerPool({
      size: 1,
      // No maxConcurrentTasksPerWorker specified - should default to 1
      workerFactory: createTestWorker,
      proxyFactory: comlinkProxyFactory,
    });

    const api = pool.getApi();
    const startTime = Date.now();

    // Start 2 tasks - should run sequentially
    const results = await Promise.all([
      api.delayAndReturn(50, "task1"),
      api.delayAndReturn(50, "task2"),
    ]);

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(results).toEqual(["task1", "task2"]);
    // Should take ~100ms (sequential) rather than ~50ms (concurrent)
    expect(duration).toBeGreaterThan(80);
  });

  test("error handling with concurrent tasks", async () => {
    const pool = new WorkerPool({
      size: 1,
      maxConcurrentTasksPerWorker: 2,
      workerFactory: createTestWorker,
      proxyFactory: comlinkProxyFactory,
    });

    const api = pool.getApi();

    // Mix of successful and failing tasks
    const results = await Promise.allSettled([
      api.echo("success1"),
      api.fail(), // This should fail
      api.echo("success2"),
    ]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(results[2].status).toBe("fulfilled");
    
    if (results[0].status === "fulfilled") {
      expect(results[0].value).toBe("success1");
    }
    if (results[2].status === "fulfilled") {
      expect(results[2].value).toBe("success2");
    }
  });

  test("validates maxConcurrentTasksPerWorker parameter", () => {
    expect(() => {
      new WorkerPool({
        size: 1,
        maxConcurrentTasksPerWorker: 0, // Invalid
        workerFactory: createTestWorker,
        proxyFactory: comlinkProxyFactory,
      });
    }).toThrow("maxConcurrentTasksPerWorker must be at least 1");

    expect(() => {
      new WorkerPool({
        size: 1,
        maxConcurrentTasksPerWorker: -1, // Invalid
        workerFactory: createTestWorker,
        proxyFactory: comlinkProxyFactory,
      });
    }).toThrow("maxConcurrentTasksPerWorker must be at least 1");
  });
});
