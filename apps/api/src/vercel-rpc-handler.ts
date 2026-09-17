import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchHandler } from "./handler.js";
import { createVercelFunctionHandler } from "./lib/vercel-function-handler.js";
import { VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN } from "./lib/vercel-route-patterns.js";

let marketingHtml: Promise<string> | undefined;

export const handleVercelRpcRequest = createVercelFunctionHandler({
	fetch: async (request) => {
		const response = await fetchHandler(request);
		// An expired cookie still selects the authenticated root rewrite. Serve the
		// public homepage in place instead of redirecting back into that same rule.
		if (
			new URL(request.url).pathname === "/api/home" &&
			response.status === 302 &&
			response.headers.get("Location") === "/"
		) {
			if (request.method !== "HEAD")
				marketingHtml ??= readFile(
					resolve(process.cwd(), "dist-site/marketing.html"),
					"utf8",
				);
			return new Response(
				request.method === "HEAD" ? null : await marketingHtml,
				{
					headers: {
						"Content-Type": "text/html; charset=utf-8",
						"Cache-Control": "private, no-store",
						Vary: "Cookie",
					},
				},
			);
		}
		return response;
	},
	functionGroup: "rpc-auth",
	publicPathPattern: VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN,
});
