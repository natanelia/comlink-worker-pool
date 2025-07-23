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

// New I/O-bound functions to demonstrate concurrent execution
export async function fetchData(url: string, delay: number = 1000): Promise<string> {
	// Simulate network request delay
	await sleep(delay);
	if (typeof url !== "string") throw new Error("URL must be a string");
	
	// Simulate different response types based on URL
	if (url.includes("api.example.com")) {
		return `Mock data from ${url} (${delay}ms delay)`;
	} else if (url.includes("jsonplaceholder")) {
		return `JSON response from ${url} (${delay}ms delay)`;
	} else {
		return `Generic response from ${url} (${delay}ms delay)`;
	}
}

export async function processData(data: string, delay: number = 500): Promise<string> {
	// Simulate data processing delay
	await sleep(delay);
	if (typeof data !== "string") throw new Error("Data must be a string");
	
	// Simulate processing operations
	const processed = data
		.toUpperCase()
		.split(" ")
		.map(word => `[${word}]`)
		.join(" ");
	
	return `Processed: ${processed} (took ${delay}ms)`;
}

const api = { fibAsync, countWords, reverseString, fetchData, processData };
export type WorkerApi = typeof api;

Comlink.expose(api);
