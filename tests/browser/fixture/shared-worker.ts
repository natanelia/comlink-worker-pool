import { expose } from "comlink";

export interface SharedWorkerApi {
	trackConcurrency(
		value: string,
		delayMs: number,
	): Promise<{ activeTasks: number; value: string }>;
}

let activeTasks = 0;

const api: SharedWorkerApi = {
	trackConcurrency: async (value: string, delayMs: number) => {
		activeTasks++;
		const observedActiveTasks = activeTasks;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		activeTasks--;
		return { activeTasks: observedActiveTasks, value };
	},
};

const sharedScope = self as unknown as {
	onconnect: ((event: MessageEvent) => void) | null;
};

sharedScope.onconnect = (event) => {
	const port = event.ports[0];
	if (port) expose(api, port);
};
