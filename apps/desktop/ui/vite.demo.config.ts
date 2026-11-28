import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app's styles load files from public/ by root URL (/opaline-trace-fill.svg,
// /shell/team-lineup-stats-panel-noise.svg, /opaline-icon.svg). The demo is
// served under /product-demo/ with demo-public as its public dir, so it bundles
// those files from public/ instead (CSS url() resolves through aliases).
const APP_PUBLIC = path.resolve(import.meta.dirname, "public");
const appPublicFiles = readdirSync(APP_PUBLIC, { recursive: true })
	.map(String)
	.filter((file) => statSync(path.join(APP_PUBLIC, file)).isFile())
	.map((file) => file.split(path.sep).join("/"));

export default defineConfig({
	mode: "product-demo",
	base: "/product-demo/",
	publicDir: "demo-public",
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [
			{ find: "@", replacement: path.resolve(import.meta.dirname, "src") },
			...appPublicFiles.map((file) => ({
				find: `/${file}`,
				replacement: path.join(APP_PUBLIC, file),
			})),
		],
	},
	build: {
		outDir: "dist-demo",
		modulePreload: false,
		// The prerendered preview and hydrated app share their styles from first
		// paint; activating the app must not introduce another stylesheet.
		cssCodeSplit: false,
		rollupOptions: { input: "demo.html" },
	},
});
