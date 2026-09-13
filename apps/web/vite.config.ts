import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

const { version } = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

async function getLatestGitHubVersion() {
	const response = await fetch(
		"https://api.github.com/repos/opalinehq/cli/releases/latest",
		{
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "opaline-web-build",
			},
		},
	);

	if (!response.ok) {
		throw new Error(`GitHub returned ${response.status}`);
	}

	const data = (await response.json()) as { tag_name?: string };

	if (!data.tag_name) {
		throw new Error("GitHub release response did not include a tag");
	}

	return normalizeCliReleaseTag(data.tag_name);
}

function normalizeCliReleaseTag(tag: string) {
	return tag.replace(/^(?:opaline-cli|rudel)@/u, "");
}

function getLatestLocalTagVersion() {
	const output = execFileSync("git", ["tag", "--sort=-version:refname"], {
		cwd: __dirname,
		encoding: "utf-8",
	});

	const tag = output
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean);

	if (!tag) {
		throw new Error("No git tags found");
	}

	return normalizeCliReleaseTag(tag);
}

async function resolveAppVersion() {
	try {
		return await getLatestGitHubVersion();
	} catch {
		try {
			return getLatestLocalTagVersion();
		} catch {
			return version;
		}
	}
}

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

	return { "/api": options, "/rpc": options };
}

const designReferenceRoot = path.resolve(
	__dirname,
	"../marketing/__DO_NOT_MERGE__inspiration/split-rail-com",
);
const designReferenceAssetRoots = new Map([
	[
		"/engineers-v2-assets/",
		path.resolve(designReferenceRoot, "engineers-v2-assets"),
	],
	[
		"/designers-session-assets/",
		path.resolve(designReferenceRoot, "designers-session-assets"),
	],
]);
const designReferenceRoutes = new Map([
	["/product/engineers-v2", "split-rail-engineers-v2.capture.html"],
	["/product/engineers-v2/", "split-rail-engineers-v2.capture.html"],
	["/product/engineers-v2/hero", "split-rail-engineers-v2-hero.capture.html"],
	["/product/engineers-v2/hero/", "split-rail-engineers-v2-hero.capture.html"],
	["/product/designers-v2", "split-rail-designers-session.capture.html"],
	["/product/designers-v2/", "split-rail-designers-session.capture.html"],
	[
		"/product/designers-v2/ship-faster",
		"split-rail-designers-ship-faster-scroll.capture.html",
	],
	[
		"/product/designers-v2/ship-faster/",
		"split-rail-designers-ship-faster-scroll.capture.html",
	],
	[
		"/product/designers-v2/ship-faster/state-1",
		"split-rail-designers-ship-faster-state-1.capture.html",
	],
	[
		"/product/designers-v2/ship-faster/state-2",
		"split-rail-designers-session-section.capture.html",
	],
	[
		"/product/designers-v2/ship-faster/state-3",
		"split-rail-designers-ship-faster-state-3.capture.html",
	],
]);
const designReferenceContentTypes: Record<string, string> = {
	".avif": "image/avif",
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".woff2": "font/woff2",
};

function designReferencePlugin(): Plugin {
	return {
		name: "split-rail-reference",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (!request.url) {
					next();
					return;
				}

				let requestPath: string;
				try {
					requestPath = decodeURIComponent(
						new URL(request.url, "http://localhost").pathname,
					);
				} catch {
					next();
					return;
				}

				const captureName = designReferenceRoutes.get(requestPath);
				let filePath = captureName
					? path.resolve(designReferenceRoot, captureName)
					: null;

				for (const [assetPrefix, assetRoot] of designReferenceAssetRoots) {
					if (requestPath.startsWith(assetPrefix)) {
						const assetName = requestPath.slice(assetPrefix.length);
						if (assetName && path.basename(assetName) === assetName) {
							filePath = path.resolve(assetRoot, assetName);
						}
						break;
					}
				}

				if (
					!filePath ||
					!existsSync(filePath) ||
					!statSync(filePath).isFile()
				) {
					next();
					return;
				}

				response.statusCode = 200;
				response.setHeader("cache-control", "no-store");
				response.setHeader(
					"content-type",
					designReferenceContentTypes[
						path.extname(filePath).toLowerCase()
					] ?? "application/octet-stream",
				);
				createReadStream(filePath).pipe(response);
			});
		},
	};
}

export default defineConfig(async ({ mode }) => {
	const appVersion = await resolveAppVersion();
	const env = loadEnv(mode, __dirname, "");
	const apiTarget =
		env.RUDEL_API_TARGET ??
		process.env.RUDEL_API_TARGET ??
		"http://localhost:4010";
	const apiBearerToken =
		env.RUDEL_API_BEARER_TOKEN ?? process.env.RUDEL_API_BEARER_TOKEN;

	return {
		define: {
			__APP_VERSION__: JSON.stringify(appVersion),
		},
		plugins: [designReferencePlugin(), react(), tailwindcss()],
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
