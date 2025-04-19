import * as Comlink from 'comlink';

// CPU-intensive Fibonacci
function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

// simulate variable workload
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// Handle generic tasks with random delay
async function handleTask(task) {
  const delay = Math.floor(Math.random() * 800) + 200; // 200–1000ms
  await sleep(delay);
  if (task.type === 'fib') {
    return fib(task.payload);
  }
  throw new Error(`Unknown task type: ${task.type}`);
}

Comlink.expose({ handleTask });
