import * as Comlink from "comlink";

const api = {
	echo(x: string) {
		return x;
	},
	fail() {
		throw new Error("fail");
	},
	delay(ms: number) {
		return new Promise<void>((resolve) => setTimeout(resolve, ms));
	},
	async delayAndReturn(ms: number, value: string) {
		await new Promise<void>((resolve) => setTimeout(resolve, ms));
		return value;
	},
};

Comlink.expose(api);
