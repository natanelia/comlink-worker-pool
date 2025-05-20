import { defineConfig } from "vite";

export default defineConfig({
	base: '/comlink-plus/',
	build: {
		outDir: "./dist",
		emptyOutDir: true,
	},
	server: {
		open: true,
		port: 5173, // Default port for the non-React playground
	},
	// No React-specific plugins needed for the vanilla JS playground
	plugins: [],
});
