import * as Comlink from "comlink";

// CPU-intensive Fibonacci
function fib(n: number): number {
	if (n <= 1) return n;
	return fib(n - 1) + fib(n - 2);
}

// simulate variable workload
function sleep(ms: number) {
	return new Promise((res) => setTimeout(res, ms));
}

export async function fibAsync(n: number): Promise<number> {
	if (typeof n !== "number") throw new Error("Input must be a number");
	return fib(n);
}

// Example API methods for proxified callbacks
export async function countWords(text: string): Promise<number> {
	// Simulate processing delay
	const delay = Math.floor(Math.random() * 800) + 200;
	await sleep(delay);
	if (typeof text !== "string") throw new Error("Input must be a string");
	return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function reverseString(text: string): Promise<string> {
	const delay = Math.floor(Math.random() * 800) + 200;
	await sleep(delay);
	if (typeof text !== "string") throw new Error("Input must be a string");
	return text.split("").reverse().join("");
}

const api = { fibAsync, countWords, reverseString };
export type WorkerApi = typeof api;

Comlink.expose(api);
