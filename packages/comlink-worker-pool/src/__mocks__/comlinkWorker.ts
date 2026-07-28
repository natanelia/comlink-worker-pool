import * as Comlink from "comlink";

const api = {
	echo(x: string) {
		return x;
	},
	fail() {
		throw new Error("fail");
	},
	async delayAndReturn(ms: number, value: string) {
		await new Promise<void>((resolve) => setTimeout(resolve, ms));
		return value;
	},
};

Comlink.expose(api);
