import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auth, fetchHandler } from "./handler.js";
import { createVercelFunctionHandler } from "./lib/vercel-function-handler.js";
import { VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN } from "./lib/vercel-route-patterns.js";

let marketingHtml: Promise<string> | undefined;

export const handleVercelRpcRequest = createVercelFunctionHandler({
	fetch: async (request) => {
		const url = new URL(request.url);
		if (url.pathname === "/api/public-home") {
			const headers = {
				"Cache-Control": "private, no-store",
				Vary: "Cookie",
			};
			if (request.method !== "GET" && request.method !== "HEAD") {
				return new Response(null, {
					status: 405,
					headers: { ...headers, Allow: "GET, HEAD" },
				});
			}
			const session = await auth.api.getSession({ headers: request.headers });
			if (!session) {
				// /home is always marketing; do not activate root-only auth flows.
				for (const key of ["redirect", "user_code", "error"])
					url.searchParams.delete(key);
				return new Response(null, {
					status: 302,
					headers: { ...headers, Location: `/${url.search}` },
				});
			}
			return serveMarketing(request);
		}
		const response = await fetchHandler(request);
		// An expired cookie still selects the authenticated root rewrite. Serve the
		// public homepage in place instead of redirecting back into that same rule.
		if (
			url.pathname === "/api/home" &&
			response.status === 302 &&
			response.headers.get("Location") === "/"
		) {
			return serveMarketing(request);
		}
		return response;
	},
	functionGroup: "rpc-auth",
	publicPathPattern: VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN,
});

async function serveMarketing(request: Request): Promise<Response> {
	if (request.method !== "HEAD")
		marketingHtml ??= readFile(
			resolve(process.cwd(), "dist-site/marketing.html"),
			"utf8",
		);
	return new Response(request.method === "HEAD" ? null : await marketingHtml, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "private, no-store",
			Vary: "Cookie",
		},
	});
}
