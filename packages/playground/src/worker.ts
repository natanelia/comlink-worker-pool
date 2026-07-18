import * as Comlink from "comlink";

function fibonacci(n: number): number {
	if (n <= 1) return n;
	return fibonacci(n - 1) + fibonacci(n - 2);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fibAsync(n: number): Promise<number> {
	if (!Number.isSafeInteger(n) || n < 0 || n > 45) {
		throw new Error("Fibonacci input must be an integer from 0 to 45");
	}
	return fibonacci(n);
}

export interface TextAnalysis {
	characters: number;
	reversed: string;
	words: number;
}

export async function analyzeText(text: string): Promise<TextAnalysis> {
	if (typeof text !== "string") throw new Error("Text input must be a string");
	return {
		characters: text.length,
		reversed: [...text].reverse().join(""),
		words: text.trim().split(/\s+/).filter(Boolean).length,
	};
}

export interface DelayedTaskResult {
	delayMs: number;
	label: string;
	workerValue: string;
}

export async function delayedTransform(
	label: string,
	delayMs: number,
): Promise<DelayedTaskResult> {
	if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 5_000) {
		throw new Error("Delay must be between 0 and 5000 milliseconds");
	}
	await sleep(delayMs);
	return {
		delayMs,
		label,
		workerValue: label.toUpperCase(),
	};
}

const api = { analyzeText, delayedTransform, fibAsync };
export type WorkerApi = typeof api;

Comlink.expose(api);
