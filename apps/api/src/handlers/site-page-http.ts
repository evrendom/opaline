import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sqlClient } from "../db.js";
import { getSitePageRoute } from "../lib/site-page-route.js";

const documentPaths = {
	200: "app.html",
	404: "404.html",
	410: "410/index.html",
};
const documents = new Map<string, Promise<string>>();

export async function handleSitePageRequest(
	request: Request,
	siteDirectory = resolve(process.cwd(), "dist-site"),
): Promise<Response> {
	const headers = {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "private, no-store",
		"X-Robots-Tag": "noindex, nofollow",
	};
	if (!["GET", "HEAD"].includes(request.method)) {
		return new Response(null, {
			status: 405,
			headers: { ...headers, Allow: "GET, HEAD" },
		});
	}
	const route = getSitePageRoute(new URL(request.url).pathname);
	let status: 200 | 404 | 410 = 404;
	if (route.kind === "gone") status = 410;
	if (route.kind === "app") status = 200;
	if (route.kind === "workspace") {
		const [workspace] = await sqlClient<{ exists: number }[]>`
			SELECT 1 AS exists FROM organization WHERE slug = ${route.slug} LIMIT 1
		`;
		if (workspace) status = 200;
	}
	if (request.method === "HEAD") return new Response(null, { status, headers });
	const documentPath = resolve(siteDirectory, documentPaths[status]);
	let document = documents.get(documentPath);
	if (!document) {
		document = readFile(documentPath, "utf8");
		documents.set(documentPath, document);
	}
	return new Response(await document, { status, headers });
}
