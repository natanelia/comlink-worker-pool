import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: '/comlink-plus/',
	build: {
		outDir: "./dist",
		emptyOutDir: true,
	},
	server: {
		open: true,
		port: 5174,
	},
	plugins: [react()],
});
