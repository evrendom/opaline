import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	mode: "product-demo",
	base: "/product-demo/",
	publicDir: "demo-public",
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
	build: {
		outDir: "dist-demo",
		modulePreload: false,
		// The prerendered preview and hydrated app share their styles from first
		// paint; activating the app must not introduce another stylesheet.
		cssCodeSplit: false,
		rollupOptions: { input: "demo.html" },
	},
});
