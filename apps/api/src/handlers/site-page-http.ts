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

export const WORKSPACE_META_NAME = "opaline-workspace";

interface PageWorkspace {
	readonly id: string;
	readonly slug: string;
}

interface PageWorkspaceLookup {
	readonly exists: boolean;
	readonly workspace: PageWorkspace | null;
}

const SESSION_COOKIE_NAMES = [
	"__Secure-better-auth.session_token",
	"better-auth.session_token",
];

export function readSessionToken(request: Request): string | null {
	const cookies = new Map<string, string>();
	for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
		const separator = part.indexOf("=");
		if (separator < 0) continue;
		cookies.set(
			part.slice(0, separator).trim(),
			part.slice(separator + 1).trim(),
		);
	}
	for (const name of SESSION_COOKIE_NAMES) {
		const value = cookies.get(name);
		if (!value) continue;
		let decoded: string;
		try {
			decoded = decodeURIComponent(value);
		} catch {
			return null;
		}
		const token = decoded.split(".")[0];
		return token ? token : null;
	}
	return null;
}

async function findWorkspaceBySlug(
	slug: string,
	sessionToken: string | null,
): Promise<PageWorkspaceLookup> {
	const [workspace] = await sqlClient<{ id: string; member: boolean }[]>`
		SELECT o.id, EXISTS (
			SELECT 1 FROM session s
			JOIN member m ON m.user_id = s.user_id
			WHERE s.token = ${sessionToken}
				AND s.expires_at > now()
				AND m.organization_id = o.id
		) AS member
		FROM organization o WHERE o.slug = ${slug} LIMIT 1
	`;
	if (!workspace) return { exists: false, workspace: null };
	return {
		exists: true,
		workspace: workspace.member ? { id: workspace.id, slug } : null,
	};
}

export async function handleSitePageRequest(
	request: Request,
	siteDirectory = resolve(process.cwd(), "dist-site"),
	findWorkspace: (
		slug: string,
		sessionToken: string | null,
	) => Promise<PageWorkspaceLookup> = findWorkspaceBySlug,
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
	let workspace: PageWorkspace | null = null;
	if (route.kind === "gone") status = 410;
	if (route.kind === "app") status = 200;
	if (route.kind === "workspace") {
		const lookup = await findWorkspace(route.slug, readSessionToken(request));
		workspace = lookup.workspace;
		if (lookup.exists) status = 200;
	}
	if (request.method === "HEAD") return new Response(null, { status, headers });
	const documentPath = resolve(siteDirectory, documentPaths[status]);
	let document = documents.get(documentPath);
	if (!document) {
		document = readFile(documentPath, "utf8");
		documents.set(documentPath, document);
	}
	const html = await document;
	return new Response(workspace ? withWorkspaceMeta(html, workspace) : html, {
		status,
		headers,
	});
}

export function withWorkspaceMeta(
	document: string,
	workspace: PageWorkspace,
): string {
	const tag = `<meta name="${WORKSPACE_META_NAME}" content="${escapeAttribute(workspace.slug)}" data-id="${escapeAttribute(workspace.id)}">`;
	return document.replace("</head>", `${tag}</head>`);
}

function escapeAttribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
