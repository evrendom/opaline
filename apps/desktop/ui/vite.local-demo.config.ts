// Local preview of the full app against the public read-only demo workspace,
// without a local API or database:
//
//   bun run --cwd apps/desktop/ui dev:demo   → http://localhost:4011/
//
// product-demo mode holds auth requests until the marketing page's "Explore"
// button activates the demo. There is no such button here, so activate it as
// soon as the page loads, on the demo's clock (DEMO_TODAY in demo-clock.ts,
// its data's last day) so the default date range holds its sessions.
//
// The demo workspace has no GitHub connection, so the server never offers the
// GitHub outcome metrics there. To work on that gated UI locally, dashboard
// responses get synthetic GitHub metrics (tools/local-github-preview.ts).

import type { IncomingMessage } from "node:http";
import type { CostDashboardInput } from "@rudel/api-routes";
import type { ConfigEnv, Plugin, UserConfig } from "vite";
import type * as GitHubPreview from "./tools/local-github-preview";
import baseConfig from "./vite.config";

const DEMO_ORIGIN = "https://opaline.so";
const DASHBOARD_PATH = "/api/demo/rpc/analytics/overview/costs";

const activateDemo: Plugin = {
	name: "activate-local-demo",
	transformIndexHtml: () => [
		{
			tag: "script",
			attrs: { type: "module" },
			children:
				'import { installDemoClock } from "/src/features/demo/demo-clock.ts"; import { setDemoActive } from "/src/features/demo/demo-activation.ts"; installDemoClock(); setDemoActive(true);',
			injectTo: "head",
		},
	],
};

async function readBody(request: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

const githubPreview: Plugin = {
	name: "local-github-preview",
	configureServer(server) {
		// Registered before Vite's proxy, so this handles the dashboard request
		// and every other /api/demo request still goes through the proxy.
		server.middlewares.use(DASHBOARD_PATH, async (request, response, next) => {
			if (request.method !== "POST") return next();
			try {
				// Loaded through Vite: the generator imports workspace TypeScript
				// that plain Node (which loads this config) cannot.
				const { isGitHubPreviewMetric, withGitHubPreview } =
					(await server.ssrLoadModule(
						"/tools/local-github-preview.ts",
					)) as typeof GitHubPreview;
				const body = JSON.parse(await readBody(request)) as {
					json: CostDashboardInput;
				};
				const input = body.json;
				// The demo API cannot serve a GitHub metric: ask it for cost, and
				// drop GitHub-only filters, which use GitHub repository ids.
				const upstreamInput = isGitHubPreviewMetric(input.requestedMetric)
					? {
							...input,
							requestedMetric: "cost" as const,
							splitBy: "none" as const,
							repositories: [],
							githubAuthors: [],
						}
					: input;
				const upstream = await fetch(`${DEMO_ORIGIN}${DASHBOARD_PATH}`, {
					method: "POST",
					headers: { "content-type": "application/json", origin: DEMO_ORIGIN },
					body: JSON.stringify({ ...body, json: upstreamInput }),
				});
				const text = await upstream.text();
				response.statusCode = upstream.status;
				response.setHeader("content-type", "application/json");
				if (!upstream.ok) return response.end(text);
				const payload = JSON.parse(text);
				payload.json = withGitHubPreview(payload.json, input);
				response.end(JSON.stringify(payload));
			} catch (error) {
				server.config.logger.error(
					`[local-github-preview] ${error instanceof Error ? error.message : String(error)}`,
				);
				next(error);
			}
		});
	},
};

export default async (env: ConfigEnv): Promise<UserConfig> => {
	const config =
		typeof baseConfig === "function" ? await baseConfig(env) : await baseConfig;
	return {
		...config,
		plugins: [...(config.plugins ?? []), activateDemo, githubPreview],
	};
};
