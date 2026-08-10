export interface FailingSharedWorkerApi {
	never(): Promise<never>;
}

throw new Error("intentional SharedWorker startup failure");
