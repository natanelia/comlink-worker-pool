import type { QueueOverflowPolicy, Task } from "../WorkerPool";

export interface ScheduledTask<TTask, TResult> extends Task<TTask, TResult> {
	settled: boolean;
	priority: number;
	sequence: number;
	enqueuedAt: number;
	startedAt?: number;
	workerId?: number;
	signal?: AbortSignal;
	abortHandler?: () => void;
	queueTimeout?: ReturnType<typeof setTimeout>;
	queueDeadline?: number;
	timeout?: ReturnType<typeof setTimeout>;
}

export interface QueueEviction<TTask, TResult> {
	task: ScheduledTask<TTask, TResult>;
	dropped: boolean;
}

/** Priority/FIFO queue with bounded-overflow mechanics kept outside the pool. */
export class SchedulerQueue<TTask, TResult> {
	private readonly items: ScheduledTask<TTask, TResult>[] = [];

	get length(): number {
		return this.items.length;
	}

	insert(task: ScheduledTask<TTask, TResult>): void {
		const index = this.items.findIndex(
			(candidate) => candidate.priority < task.priority,
		);
		if (index === -1) this.items.push(task);
		else this.items.splice(index, 0, task);
	}

	shift(): ScheduledTask<TTask, TResult> | undefined {
		return this.items.shift();
	}

	contains(task: ScheduledTask<TTask, TResult>): boolean {
		return this.items.includes(task);
	}

	remove(task: ScheduledTask<TTask, TResult>): boolean {
		const index = this.items.indexOf(task);
		if (index === -1) return false;
		this.items.splice(index, 1);
		return true;
	}

	drain(): ScheduledTask<TTask, TResult>[] {
		return this.items.splice(0);
	}

	oldestEnqueuedAt(): number | null {
		if (this.items.length === 0) return null;
		return this.items.reduce(
			(oldest, item) => Math.min(oldest, item.enqueuedAt),
			Number.POSITIVE_INFINITY,
		);
	}

	enforceLimit(
		submitted: ScheduledTask<TTask, TResult>,
		maxQueueSize: number,
		policy: QueueOverflowPolicy,
	): QueueEviction<TTask, TResult>[] {
		const evictions: QueueEviction<TTask, TResult>[] = [];
		while (this.items.length > maxQueueSize) {
			let rejected = submitted;
			let dropped = false;
			if (!this.contains(submitted) || policy === "drop-oldest") {
				rejected = this.items.reduce((oldest, candidate) =>
					candidate.sequence < oldest.sequence ? candidate : oldest,
				);
				dropped = policy === "drop-oldest";
			}
			if (!this.remove(rejected)) break;
			evictions.push({ task: rejected, dropped });
		}
		return evictions;
	}
}
