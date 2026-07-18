import { defineConfig } from "bunup";

export default defineConfig({
	entry: "src/index.ts",
	outDir: "dist",
	format: ["esm", "cjs"],
	dts: true,
	minify: true,
	clean: true,
	outputExtension: ({ format }) => ({
		js: format === "esm" ? ".js" : ".cjs",
		dts: format === "esm" ? ".d.ts" : ".d.cts",
	}),
});
