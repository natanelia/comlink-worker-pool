import { defineConfig } from "bunup";

const shared = {
	entry: "src/index.ts",
	dts: true,
	minify: false,
	sourcemap: "linked" as const,
};

export default defineConfig([
	{
		...shared,
		name: "esm",
		format: "esm",
		outDir: "dist/esm",
	},
	{
		...shared,
		name: "cjs",
		format: "cjs",
		outDir: "dist/cjs",
	},
]);
