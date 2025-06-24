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
};

Comlink.expose(api);
