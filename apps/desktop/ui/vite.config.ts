import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

// Graphical writes its tailwind-merge classes as CommonJS
// (graphical/generated/tailwind-merge.cjs). Serve that one file as a module so
// `cn()` can extend tailwind-merge with them.
const graphicalMergeConfig: Plugin = {
	name: "graphical-merge-config",
	transform(code, id) {
		if (!id.endsWith("/graphical/generated/tailwind-merge.cjs")) return;
		return code.replace(/\bmodule\.exports\s*=/, "export default");
	},
};

// Point the dev proxy at a remote API (e.g. RUDEL_API_TARGET=https://opaline.so)
// instead of the default local API server. For https targets the proxy rewrites
// the Host/Origin headers and cookie domain so the remote server's origin checks
// pass and its session cookie sticks to localhost.
function buildApiProxy(target: string, bearerToken?: string) {
	const headers: Record<string, string> = {};
	if (target.startsWith("https://")) {
		headers.origin = target;
	}
	if (bearerToken) {
		headers.authorization = `Bearer ${bearerToken}`;
		// Better Auth's bearer plugin appends its session cookie. Strip any stale
		// browser cookie so the server-side bearer identity wins deterministically.
		headers.cookie = "";
	}

	const options = {
		target,
		...(target.startsWith("https://")
			? {
					changeOrigin: true,
					cookieDomainRewrite: "localhost",
				}
			: {}),
		...(Object.keys(headers).length > 0 ? { headers } : {}),
	};

	return {
		// The showcase uses its public read-only gateway, including in local dev.
		"/api/demo": {
			target: "https://opaline.so",
			changeOrigin: true,
			headers: { origin: "https://opaline.so", authorization: "", cookie: "" },
		},
		"/api": options,
		"/rpc": options,
	};
}

const VENDOR_CHUNKS: readonly (readonly [string, RegExp])[] = [
	[
		"vendor-react",
		/^(?:react|react-dom|scheduler|react-router|react-router-dom)$/u,
	],
	["vendor-ui", /^(?:@base-ui|@radix-ui|radix-ui|@floating-ui)(?:\/|$)/u],
	["vendor-motion", /^(?:motion|framer-motion|motion-dom|motion-utils)$/u],
	["vendor-zod", /^zod$/u],
	["vendor-orpc", /^@orpc\//u],
	["vendor-query", /^@tanstack\/(?:react-query|query-core)$/u],
];

function vendorChunk(id: string) {
	const name = /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)/u.exec(id)?.[1];
	if (!name) return undefined;
	return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(name))?.[0];
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, __dirname, "");
	const apiTarget =
		env.RUDEL_API_TARGET ??
		process.env.RUDEL_API_TARGET ??
		"http://localhost:4010";
	const apiBearerToken =
		env.RUDEL_API_BEARER_TOKEN ?? process.env.RUDEL_API_BEARER_TOKEN;

	return {
		plugins: [react(), tailwindcss(), graphicalMergeConfig],
		build:
			mode === "plugin"
				? undefined
				: { rollupOptions: { output: { manualChunks: vendorChunk } } },
		server: {
			port: 4011,
			proxy: buildApiProxy(apiTarget, apiBearerToken),
		},
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
		test: {
			environment: "jsdom",
			exclude: [
				...configDefaults.exclude,
				"e2e/**",
				"tools/**",
				"**/*.bun-test.ts",
				"**/*.bun-test.tsx",
			],
			environmentOptions: {
				jsdom: {
					url: "http://localhost:4011",
				},
			},
			setupFiles: ["./src/test/setup.ts"],
		},
	};
});
