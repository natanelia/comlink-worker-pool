import { expose } from "comlink";

const api = {
	echo: async (value: string) => value,
	delayEcho: async (value: string, delayMs: number) => {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		return value;
	},
	hang: () => new Promise<never>(() => {}),
	crash: () => {
		self.close();
		return new Promise<never>(() => {});
	},
};

export type BrowserWorkerApi = typeof api;
expose(api);
