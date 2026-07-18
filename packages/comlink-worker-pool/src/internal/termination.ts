import type { WorkerTerminator } from "../WorkerPool";
import { WorkerTerminationError } from "../errors";
import { MAX_TIMER_DELAY_MS, monotonicNow } from "./lifecycle";

export const DEFAULT_TERMINATION_RETRY_ATTEMPTS = 3;
export const DEFAULT_TERMINATION_RETRY_DELAY_MS = 100;
export const DEFAULT_TERMINATION_ATTEMPT_TIMEOUT_MS = 5_000;

export interface TerminationRecord {
	worker: Worker;
	workerId: number | undefined;
	attempts: number;
	exhausted: boolean;
	retryTimer?: ReturnType<typeof setTimeout>;
	attemptTimers: Set<ReturnType<typeof setTimeout>>;
}

export interface TerminationControllerOptions {
	retryAttempts: number;
	retryDelayMs: number;
	attemptTimeoutMs: number;
	workerTerminator?: WorkerTerminator;
	onFailure: (error: WorkerTerminationError) => void;
	onStateChange: () => void;
}

/** Owns quarantine, retry, deadline, and confirmation state for removed workers. */
export class TerminationController {
	private readonly records = new Map<Worker, TerminationRecord>();
	private failureCount = 0;

	constructor(private readonly options: TerminationControllerOptions) {}

	get count(): number {
		return this.records.size;
	}

	get failures(): number {
		return this.failureCount;
	}

	allExhausted(): boolean {
		return [...this.records.values()].every((record) => record.exhausted);
	}

	hasRetryableWorker(): boolean {
		return [...this.records.values()].some((record) => !record.exhausted);
	}

	quarantine(worker: Worker, workerId?: number): TerminationRecord {
		const existing = this.records.get(worker);
		if (existing) return existing;

		const record: TerminationRecord = {
			worker,
			workerId,
			attempts: 0,
			exhausted: false,
			attemptTimers: new Set(),
		};
		this.records.set(worker, record);
		return record;
	}

	attempt(record: TerminationRecord): void {
		if (this.records.get(record.worker) !== record) return;
		record.retryTimer = undefined;
		record.exhausted = false;
		record.attempts++;

		let result: ReturnType<WorkerTerminator>;
		try {
			result = this.options.workerTerminator
				? this.options.workerTerminator(record.worker)
				: record.worker.terminate();
		} catch (error) {
			this.recordFailure(record, error);
			return;
		}

		let then: unknown;
		try {
			then =
				result !== null &&
				(typeof result === "object" || typeof result === "function")
					? (result as PromiseLike<unknown>).then
					: undefined;
		} catch (error) {
			this.recordFailure(record, error);
			return;
		}

		if (typeof then !== "function") {
			this.confirm(record);
			return;
		}

		let attemptFinished = false;
		const deadline = monotonicNow() + this.options.attemptTimeoutMs;
		let timeout!: ReturnType<typeof setTimeout>;
		const handleTimeout = () => {
			record.attemptTimers.delete(timeout);
			if (attemptFinished) return;
			const remaining = deadline - monotonicNow();
			if (remaining > 0) {
				timeout = setTimeout(
					handleTimeout,
					Math.min(remaining, MAX_TIMER_DELAY_MS),
				);
				record.attemptTimers.add(timeout);
				return;
			}
			attemptFinished = true;
			this.recordFailure(
				record,
				new Error(
					`Termination attempt timed out after ${this.options.attemptTimeoutMs}ms`,
				),
			);
		};
		timeout = setTimeout(
			handleTimeout,
			Math.min(this.options.attemptTimeoutMs, MAX_TIMER_DELAY_MS),
		);
		record.attemptTimers.add(timeout);

		const terminationPromise = new Promise<unknown>((resolve, reject) => {
			Reflect.apply(then, result, [resolve, reject]);
		});
		void terminationPromise.then(
			() => {
				clearTimeout(timeout);
				record.attemptTimers.delete(timeout);
				if (attemptFinished) {
					// A late success still confirms that the worker is gone.
					this.confirm(record);
					return;
				}
				attemptFinished = true;
				this.confirm(record);
			},
			(error) => {
				clearTimeout(timeout);
				record.attemptTimers.delete(timeout);
				if (attemptFinished) return;
				attemptFinished = true;
				this.recordFailure(record, error);
			},
		);
	}

	private confirm(record: TerminationRecord): void {
		if (this.records.get(record.worker) !== record) return;
		if (record.retryTimer !== undefined) clearTimeout(record.retryTimer);
		for (const timer of record.attemptTimers) clearTimeout(timer);
		record.attemptTimers.clear();
		this.records.delete(record.worker);
		this.options.onStateChange();
	}

	private recordFailure(record: TerminationRecord, cause: unknown): void {
		if (this.records.get(record.worker) !== record) return;
		this.failureCount++;
		const exhausted = record.attempts > this.options.retryAttempts;
		record.exhausted = exhausted;
		const error = new WorkerTerminationError(
			record.workerId,
			record.attempts,
			exhausted,
			cause,
		);
		this.options.onFailure(error);

		if (!exhausted) {
			const exponent = Math.min(record.attempts - 1, 30);
			const retryDelay = Math.min(
				this.options.retryDelayMs * 2 ** exponent,
				MAX_TIMER_DELAY_MS,
			);
			record.retryTimer = setTimeout(() => this.attempt(record), retryDelay);
		}

		this.options.onStateChange();
	}
}
