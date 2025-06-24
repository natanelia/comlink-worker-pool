/**
 * Example worker for lifecycle management demonstration
 */

import { expose } from "comlink";

let taskCount = 0;
const startTime = Date.now();

const api = {
  processData: async (data: string): Promise<string> => {
    taskCount++;
    const runtime = Date.now() - startTime;
    
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return `Processed: ${data} (Task #${taskCount}, Runtime: ${runtime}ms)`;
  },
  
  heavyComputation: async (n: number): Promise<number> => {
    taskCount++;
    const runtime = Date.now() - startTime;
    
    // Simulate heavy computation
    let result = 0;
    for (let i = 0; i < n * 1000000; i++) {
      result += Math.sqrt(i);
    }
    
    console.log(`Heavy computation completed (Task #${taskCount}, Runtime: ${runtime}ms)`);
    return result;
  },
};

expose(api);
