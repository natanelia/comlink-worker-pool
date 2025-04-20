import * as Comlink from "comlink";

const api = {
	echo(x: string) {
		return x;
	},
	fail() {
		throw new Error("fail");
	},
};

Comlink.expose(api);
