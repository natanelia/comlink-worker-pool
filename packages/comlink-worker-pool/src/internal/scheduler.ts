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
	queueIndex: number;
	previousQueued: ScheduledTask<TTask, TResult> | null;
	nextQueued: ScheduledTask<TTask, TResult> | null;
}

export interface QueueEviction<TTask, TResult> {
	task: ScheduledTask<TTask, TResult>;
	dropped: boolean;
}

const FIFO_QUEUE_INDEX = -2;

/**
 * Priority/FIFO queue with bounded-overflow mechanics kept outside the pool.
 *
 * Dual representation invariants:
 * - The linked list (`oldest`/`newest`) is authoritative in both FIFO and heap
 *   modes for enqueue order, drain order, oldest-age tracking, and overflow.
 * - `items` is empty whenever `heapMode === false`. `promoteToHeap()` therefore
 *   pushes into an empty array, and `contains()` can gate its FIFO branch on
 *   `!heapMode` without consulting the heap.
 * - In heap mode, `queueIndex` mirrors membership in `items`; FIFO mode uses
 *   `FIFO_QUEUE_INDEX` so `remove`/`drain` can unlink without heap bookkeeping.
 */
export class SchedulerQueue<TTask, TResult> {
	private readonly items: ScheduledTask<TTask, TResult>[] = [];
	private oldest: ScheduledTask<TTask, TResult> | null = null;
	private newest: ScheduledTask<TTask, TResult> | null = null;
	private queueSize = 0;
	private uniformPriority: number | undefined;
	private heapMode = false;

	get length(): number {
		return this.queueSize;
	}

	insert(task: ScheduledTask<TTask, TResult>): void {
		if (task.queueIndex !== -1) {
			throw new Error("Scheduled task is already queued");
		}

		const previous = this.newest;
		task.previousQueued = previous;
		task.nextQueued = null;
		if (previous) previous.nextQueued = task;
		else this.oldest = task;
		this.newest = task;
		this.queueSize++;

		if (!this.heapMode) {
			if (this.queueSize === 1) this.uniformPriority = task.priority;
			if (task.priority === this.uniformPriority) {
				task.queueIndex = FIFO_QUEUE_INDEX;
				return;
			}
			this.promoteToHeap();
			return;
		}

		task.queueIndex = this.items.length;
		this.items.push(task);
		this.siftUp(task.queueIndex);
	}

	shift(): ScheduledTask<TTask, TResult> | undefined {
		const task = this.heapMode ? this.items[0] : (this.oldest ?? undefined);
		if (task) this.remove(task);
		return task;
	}

	contains(task: ScheduledTask<TTask, TResult>): boolean {
		if (task.queueIndex === FIFO_QUEUE_INDEX) {
			return (
				!this.heapMode &&
				(task.previousQueued !== null ||
					task.nextQueued !== null ||
					this.oldest === task)
			);
		}
		return task.queueIndex >= 0 && this.items[task.queueIndex] === task;
	}

	remove(task: ScheduledTask<TTask, TResult>): boolean {
		if (!this.contains(task)) return false;

		if (this.heapMode) {
			const index = task.queueIndex;
			const last = this.items.pop() as ScheduledTask<TTask, TResult>;
			if (index < this.items.length) {
				this.items[index] = last;
				last.queueIndex = index;
				const parentIndex = (index - 1) >> 1;
				const parent = this.items[parentIndex];
				if (
					index > 0 &&
					(last.priority > parent.priority ||
						(last.priority === parent.priority &&
							last.sequence < parent.sequence))
				) {
					this.siftUp(index);
				} else {
					this.siftDown(index);
				}
			}
		}

		const previous = task.previousQueued;
		const next = task.nextQueued;
		if (previous) previous.nextQueued = next;
		else this.oldest = next;
		if (next) next.previousQueued = previous;
		else this.newest = previous;
		task.queueIndex = -1;
		task.previousQueued = null;
		task.nextQueued = null;
		this.queueSize--;
		if (this.queueSize === 0) {
			this.items.length = 0;
			this.uniformPriority = undefined;
			this.heapMode = false;
		}
		return true;
	}

	drain(): ScheduledTask<TTask, TResult>[] {
		const tasks = new Array<ScheduledTask<TTask, TResult>>(this.queueSize);
		let current = this.oldest;
		let index = 0;
		while (current) {
			const next = current.nextQueued;
			current.queueIndex = -1;
			current.previousQueued = null;
			current.nextQueued = null;
			tasks[index++] = current;
			current = next;
		}
		this.items.length = 0;
		this.oldest = null;
		this.newest = null;
		this.queueSize = 0;
		this.uniformPriority = undefined;
		this.heapMode = false;
		return tasks;
	}

	oldestEnqueuedAt(): number | null {
		return this.oldest?.enqueuedAt ?? null;
	}

	enforceLimit(
		submitted: ScheduledTask<TTask, TResult>,
		maxQueueSize: number,
		policy: QueueOverflowPolicy,
	): QueueEviction<TTask, TResult>[] {
		const evictions: QueueEviction<TTask, TResult>[] = [];
		while (this.queueSize > maxQueueSize) {
			let rejected = submitted;
			let dropped = false;
			if (!this.contains(submitted) || policy === "drop-oldest") {
				if (!this.oldest) break;
				rejected = this.oldest;
				dropped = policy === "drop-oldest";
			}
			if (!this.remove(rejected)) break;
			evictions.push({ task: rejected, dropped });
		}
		return evictions;
	}

	private promoteToHeap(): void {
		this.heapMode = true;
		let current = this.oldest;
		while (current) {
			current.queueIndex = this.items.length;
			this.items.push(current);
			current = current.nextQueued;
		}
		for (let index = (this.items.length >> 1) - 1; index >= 0; index--) {
			this.siftDown(index);
		}
	}

	private siftUp(startIndex: number): void {
		let index = startIndex;
		const task = this.items[index];
		while (index > 0) {
			const parentIndex = (index - 1) >> 1;
			const parent = this.items[parentIndex];
			if (
				parent.priority > task.priority ||
				(parent.priority === task.priority && parent.sequence <= task.sequence)
			) {
				break;
			}
			this.items[index] = parent;
			parent.queueIndex = index;
			index = parentIndex;
		}
		this.items[index] = task;
		task.queueIndex = index;
	}

	private siftDown(startIndex: number): void {
		let index = startIndex;
		const task = this.items[index];
		const firstLeaf = this.items.length >> 1;
		while (index < firstLeaf) {
			let childIndex = index * 2 + 1;
			let child = this.items[childIndex];
			const rightIndex = childIndex + 1;
			if (rightIndex < this.items.length) {
				const right = this.items[rightIndex];
				if (
					right.priority > child.priority ||
					(right.priority === child.priority && right.sequence < child.sequence)
				) {
					childIndex = rightIndex;
					child = right;
				}
			}
			if (
				task.priority > child.priority ||
				(task.priority === child.priority && task.sequence <= child.sequence)
			) {
				break;
			}
			this.items[index] = child;
			child.queueIndex = index;
			index = childIndex;
		}
		this.items[index] = task;
		task.queueIndex = index;
	}
}
