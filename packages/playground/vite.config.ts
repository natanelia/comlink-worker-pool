import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "/comlink-worker-pool/",
	build: {
		outDir: "./dist",
		emptyOutDir: true,
	},
	plugins: [react()],
});
