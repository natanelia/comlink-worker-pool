import type { ScheduledTask } from "./scheduler";

export const MAX_TIMER_DELAY_MS = 2_147_483_647;
export const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

export interface WorkerMetadata<TProxy, TTask, TResult> {
	id: number;
	proxy: TProxy;
	worker: Worker;
	taskCount: number;
	createdAt: number;
	activeTasks: Set<ScheduledTask<TTask, TResult>>;
	markedForTermination: boolean;
	retirementReason?: "lifetime" | "max-tasks";
	idleTimer?: ReturnType<typeof setTimeout>;
	idleDeadline?: number;
	lifetimeTimer?: ReturnType<typeof setTimeout>;
	failureHandler: (event: Event) => void;
	failureEventTypes: string[];
}

export function monotonicNow(): number {
	return typeof globalThis.performance?.now === "function"
		? globalThis.performance.now()
		: Date.now();
}

export function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be at least 1 and a safe integer`);
	}
}

export function assertNonNegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer`);
	}
}

export function assertPositiveDuration(
	value: number | undefined,
	name: string,
): void {
	if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
		throw new RangeError(`${name} must be a positive finite number`);
	}
}
