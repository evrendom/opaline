import { getLogger } from "@logtape/logtape";
import { createRouterClient, ORPCError } from "@orpc/server";
import {
	type Auth,
	MCP_CONSENT_HEADER,
	MCP_CONSENT_SECRET,
	type Session,
} from "../auth.js";
import { sqlClient } from "../db.js";
import { getFrontendOrigin } from "../frontend-origin.js";
import {
	DASHBOARD_WIDGET_URI,
	MCP_APP_MIME_TYPE,
	OPALINE_ICON,
	pluginAssetOrigin,
	pluginResourceDomains,
	readDashboardWidgetHtml,
	withAbsoluteAvatars,
} from "../mcp/dashboard-widget.js";
import {
	APP_ONLY,
	listedTool,
	MCP_TOOLS,
	McpToolError,
	type McpWorkspace,
	SESSION_RESOURCE_PREFIX,
} from "../mcp/mcp-tools.js";
import { isPluginTool, PLUGIN_TOOLS } from "../mcp/plugin-tools.js";
import { withRedactedOutput } from "../mcp/redacted-tools.js";
import type { AppContext } from "../middleware.js";
import { router } from "../router.js";

export const MCP_PATH = "/api/mcp";
export const MCP_CONSENT_PATH = "/api/mcp/consent";
const MCP_AUTHORIZE_PATH = "/api/auth/mcp/authorize";
const MCP_TOKEN_PATH = "/api/auth/mcp/token";
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const logger = getLogger(["opaline", "api", "mcp"]);
const SERVER_INFO = {
	name: "opaline",
	title: "Opaline",
	version: "1.0.0",
	icons: [OPALINE_ICON],
};
const SERVER_INSTRUCTIONS =
	"Opaline helps a team find where their coding agents get stuck or waste time, so they can fix their setup (instructions, docs, scripts, CI). No tool changes or deletes sessions. find and read record their calls in a private draft of the current analysis; save_answer publishes that draft once (saving is append-only) and share_answer shares a saved answer. Dates are UTC.";
// OpenAI MCP extension: native settings on the plugin page.
const SETTINGS = { readTool: "settings_read", updateTool: "settings_update" };
const CAPABILITIES = {
	tools: {},
	resources: {},
	extensions: { "openai/settings": SETTINGS },
	experimental: { "openai/settings": SETTINGS },
};
const TOOLS = [...MCP_TOOLS, ...PLUGIN_TOOLS].map(withRedactedOutput);

interface McpDependencies {
	readonly auth: Auth;
	readonly allowedOrigins: readonly string[];
	readonly publicLookupSource: string;
	readonly requestId: string;
}

interface JsonRpcRequest {
	readonly id?: string | number | null;
	readonly method?: string;
	readonly params?: Record<string, unknown>;
}

/** Endpoints of Better Auth's MCP plugin, which `Auth` cannot name. */
interface McpAuthApi {
	getMCPProtectedResource(): Promise<unknown>;
	getMcpOAuthConfig(): Promise<unknown>;
	getMcpSession(input: {
		headers: Headers;
	}): Promise<{ userId?: string | null; accessTokenExpiresAt: Date } | null>;
}

const UNAVAILABLE_HTML =
	"<p>The Opaline plugin is not available for your account yet.</p>";

/**
 * Dark launch: until MCP_PLUGIN_PUBLIC is exactly "true", only members of the
 * Opaline team workspace (VITE_ADMIN_ORGANIZATION_ID) can connect or call tools.
 */
async function isMcpAvailable(userId: string) {
	if (process.env.MCP_PLUGIN_PUBLIC === "true") return true;
	const team = process.env.VITE_ADMIN_ORGANIZATION_ID;
	if (!team) return false;
	const rows = await sqlClient`
		SELECT 1 FROM member WHERE organization_id = ${team} AND user_id = ${userId}
	`;
	return rows.length > 0;
}

function mcpApi(auth: Auth) {
	return auth.api as unknown as McpAuthApi;
}

/**
 * Routes the MCP endpoint, its OAuth discovery documents and the consent step.
 * Returns null for any other path.
 */
export function handleMcpRoute(
	request: Request,
	url: URL,
	dependencies: McpDependencies,
): Promise<Response> | null {
	if (url.pathname === MCP_PATH) return handleMcpRequest(request, dependencies);
	if (url.pathname === MCP_CONSENT_PATH) {
		return handleConsentRequest(request, url, dependencies);
	}
	if (url.pathname === MCP_TOKEN_PATH && request.method === "POST") {
		return handleTokenRequest(request, dependencies.auth);
	}
	// Domain ownership check for the OpenAI plugin directory.
	if (url.pathname === "/.well-known/openai-apps-challenge") {
		const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
		return Promise.resolve(
			token
				? new Response(token, { headers: { "Content-Type": "text/plain" } })
				: new Response("Not Found", { status: 404 }),
		);
	}
	if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
		return discoveryResponse(
			mcpApi(dependencies.auth).getMCPProtectedResource(),
		);
	}
	if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
		return discoveryResponse(mcpApi(dependencies.auth).getMcpOAuthConfig());
	}
	return null;
}

async function discoveryResponse(metadata: Promise<unknown>) {
	return Response.json(await metadata, {
		headers: { "Access-Control-Allow-Origin": "*" },
	});
}

/**
 * Better Auth 1.5.4 neither rotates refresh tokens nor checks confidential
 * clients' secrets on refresh, so refresh grants are answered here: the old
 * grant is consumed atomically and replaced. Code exchanges pass through.
 */
async function handleTokenRequest(request: Request, auth: Auth) {
	const raw = await request.clone().text();
	const body = new URLSearchParams(
		request.headers.get("content-type")?.includes("json")
			? Object.entries(safeJson(raw)).map(([key, value]): [string, string] => [
					key,
					`${value}`,
				])
			: raw,
	);
	if (body.get("grant_type") !== "refresh_token") return auth.handler(request);
	const basic = request.headers.get("authorization")?.match(/^Basic (.+)$/u);
	const [basicId, basicSecret] = basic?.[1]
		? Buffer.from(basic[1], "base64").toString().split(":")
		: [];
	const clientId = body.get("client_id") ?? basicId ?? "";
	const clientSecret = body.get("client_secret") ?? basicSecret ?? "";
	const [client] = await sqlClient<
		Array<{ type: string; client_secret: string | null }>
	>`
		SELECT type, client_secret FROM "oauthApplication"
		WHERE client_id = ${clientId} AND disabled IS NOT TRUE
	`;
	if (
		!client ||
		(client.type !== "public" && client.client_secret !== clientSecret)
	) {
		return Response.json({ error: "invalid_client" }, { status: 401 });
	}
	const token = (bytes: number) =>
		Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
			"base64url",
		);
	const accessToken = token(32);
	const refreshToken = token(32);
	const [grant] = await sqlClient<Array<{ scopes: string }>>`
		WITH consumed AS (
			DELETE FROM "oauthAccessToken"
			WHERE refresh_token = ${body.get("refresh_token") ?? ""}
				AND client_id = ${clientId}
				AND refresh_token_expires_at > now()
			RETURNING user_id, scopes
		)
		INSERT INTO "oauthAccessToken" (
			id, access_token, refresh_token, access_token_expires_at,
			refresh_token_expires_at, client_id, user_id, scopes
		)
		SELECT ${crypto.randomUUID()}, ${accessToken}, ${refreshToken},
			now() + make_interval(secs => ${ACCESS_TOKEN_TTL_SECONDS}),
			now() + make_interval(secs => ${REFRESH_TOKEN_TTL_SECONDS}),
			${clientId}, user_id, scopes
		FROM consumed
		RETURNING scopes
	`;
	if (!grant) return Response.json({ error: "invalid_grant" }, { status: 400 });
	return Response.json(
		{
			access_token: accessToken,
			token_type: "Bearer",
			expires_in: ACCESS_TOKEN_TTL_SECONDS,
			refresh_token: refreshToken,
			scope: grant.scopes,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

async function handleMcpRequest(
	request: Request,
	dependencies: McpDependencies,
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { Allow: "POST" },
		});
	}
	// This is a legacy-era server (initialize handshake, up to 2025-11-25).
	// A modern request (2026-07-28 and later) gets a plain 400 so dual-era
	// clients fall back to initialize instead of seeing mixed signals.
	const headerVersion = request.headers.get("mcp-protocol-version");
	if (headerVersion && !PROTOCOL_VERSIONS.includes(headerVersion)) {
		return unsupportedProtocolVersion(headerVersion);
	}
	const token = await mcpApi(dependencies.auth).getMcpSession({
		headers: request.headers,
	});
	if (!token?.userId || token.accessTokenExpiresAt < new Date()) {
		const metadataUrl = new URL(
			`/.well-known/oauth-protected-resource${MCP_PATH}`,
			request.url,
		);
		return Response.json(
			{ error: "invalid_token" },
			{
				status: 401,
				headers: {
					"WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"`,
				},
			},
		);
	}
	if (!(await isMcpAvailable(token.userId))) {
		return Response.json({ error: "not_available" }, { status: 403 });
	}

	let message: JsonRpcRequest;
	try {
		message = (await request.json()) as JsonRpcRequest;
	} catch {
		return rpcError(null, -32700, "Parse error");
	}
	if (message.id === undefined || message.id === null) {
		return new Response(null, { status: 202 });
	}
	const params = message.params ?? {};
	const metaVersion = (params._meta as Record<string, unknown> | undefined)?.[
		"io.modelcontextprotocol/protocolVersion"
	];
	// Protocol diagnostics for directory scans and hosts: method and declared
	// versions only, never arguments, results or tokens.
	logger.info(
		"MCP {method} header={headerVersion} meta={metaVersion} requested={requestedVersion}",
		{
			method: message.method ?? "",
			headerVersion: headerVersion ?? "",
			metaVersion: typeof metaVersion === "string" ? metaVersion : "",
			requestedVersion:
				message.method === "initialize" &&
				typeof params.protocolVersion === "string"
					? params.protocolVersion
					: "",
		},
	);
	if (
		typeof metaVersion === "string" &&
		!PROTOCOL_VERSIONS.includes(metaVersion)
	) {
		return unsupportedProtocolVersion(metaVersion);
	}
	switch (message.method) {
		case "initialize":
			return rpcResult(message.id, {
				protocolVersion: PROTOCOL_VERSIONS.includes(
					params.protocolVersion as string,
				)
					? params.protocolVersion
					: PROTOCOL_VERSIONS[0],
				capabilities: CAPABILITIES,
				serverInfo: SERVER_INFO,
				instructions: SERVER_INSTRUCTIONS,
			});
		case "ping":
			return rpcResult(message.id, {});
		case "tools/list":
			return rpcResult(message.id, {
				tools: TOOLS.map(listedTool),
			});
		case "tools/call":
			return rpcResult(
				message.id,
				await callTool(token.userId, params, dependencies),
			);
		case "resources/list":
			return rpcResult(message.id, {
				resources: [
					{
						uri: DASHBOARD_WIDGET_URI,
						name: "Opaline",
						mimeType: MCP_APP_MIME_TYPE,
					},
				],
			});
		case "resources/templates/list":
			return rpcResult(message.id, {
				resourceTemplates: [
					{
						uriTemplate: `${SESSION_RESOURCE_PREFIX}{workspace}/{sessionId}`,
						name: "Opaline session",
						mimeType: "text/plain",
					},
				],
			});
		case "resources/read":
			return readResource(
				message.id,
				`${params.uri}`,
				token.userId,
				dependencies,
			);
		default:
			return rpcError(message.id, -32601, "Method not found");
	}
}

async function readResource(
	id: JsonRpcRequest["id"],
	uri: string,
	userId: string,
	dependencies: McpDependencies,
) {
	if (uri === DASHBOARD_WIDGET_URI) {
		return rpcResult(id, {
			contents: [
				{
					uri,
					mimeType: MCP_APP_MIME_TYPE,
					text: await readDashboardWidgetHtml(),
					_meta: {
						"openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
						ui: {
							domain: pluginAssetOrigin(),
							csp: {
								resourceDomains: pluginResourceDomains(),
								baseUriDomains: [pluginAssetOrigin()],
								connectDomains: [],
							},
						},
						"openai/widgetDomain": pluginAssetOrigin(),
						"openai/widgetCSP": {
							resource_domains: pluginResourceDomains(),
							connect_domains: [],
						},
					},
				},
			],
		});
	}
	// A session the user @-mentioned: the overview the app-only get_session returns.
	const [workspace, sessionId] = uri.startsWith(SESSION_RESOURCE_PREFIX)
		? uri
				.slice(SESSION_RESOURCE_PREFIX.length)
				.split("/")
				.map(decodeURIComponent)
		: [];
	if (!workspace || !sessionId)
		return rpcError(id, -32002, "Resource not found");
	const result = await callTool(
		userId,
		{ name: "get_session", arguments: { workspace, sessionId } },
		dependencies,
	);
	if (result.isError)
		return rpcError(id, -32002, result.content[0]?.text ?? "");
	// get_session is app-only, so its result is structured content only.
	return rpcResult(id, {
		contents: [
			{
				uri,
				mimeType: "text/plain",
				text:
					result.content[0]?.text ??
					JSON.stringify(result.structuredContent ?? null),
			},
		],
	});
}

async function callTool(
	userId: string,
	params: Record<string, unknown>,
	dependencies: McpDependencies,
) {
	const tool = TOOLS.find((candidate) => candidate.name === params.name);
	const args = (params.arguments ?? {}) as Record<string, unknown>;
	try {
		if (!tool) throw new McpToolError(`Unknown tool: ${params.name}`);
		const workspace = await resolveWorkspace(userId, args.workspace);
		const context = await createToolContext(userId, workspace, dependencies);
		const client = createRouterClient(router, { context });
		const { result, widget } = splitWidget(
			await tool.run(client, args, { userId, workspace, authSession: context }),
		);
		// Its own content block, so a JSON result stays parseable JSON.
		const link = tool.link
			? [
					{
						type: "text",
						text: `Open in Opaline: ${getFrontendOrigin()}/${encodeURIComponent(workspace.slug)}${tool.link(args)}`,
					},
				]
			: [];
		return {
			content:
				tool.meta?.ui === APP_ONLY.ui || isPluginTool(tool)
					? []
					: [
							{
								type: "text",
								// Analysis tools return compact text; everything else is JSON.
								text:
									typeof result === "string" ? result : JSON.stringify(result),
							},
							...link,
						],
			...(isPluginTool(tool)
				? { structuredContent: { result: withAbsoluteAvatars(result) } }
				: result && typeof result === "object"
					? {
							structuredContent: Array.isArray(result)
								? { items: result }
								: result,
						}
					: {}),
			...(widget
				? { _meta: { "opaline/widget": withAbsoluteAvatars(widget) } }
				: {}),
		};
	} catch (error) {
		if (!(error instanceof McpToolError || error instanceof ORPCError)) {
			logger.error("MCP tool {tool} failed: {error}", {
				tool: params.name,
				error,
			});
		}
		const known = error instanceof McpToolError || error instanceof ORPCError;
		const message = known ? error.message : "The tool failed. Try again.";
		// The widget's session view retries and refreshes on these codes.
		const typed =
			error instanceof ORPCError
				? { code: error.code, status: error.status, data: error.data }
				: {
						code: known ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
						status: known ? 400 : 500,
					};
		return {
			content: [{ type: "text", text: message }],
			structuredContent: { error: { ...typed, message } },
			isError: true as const,
		};
	}
}

/** `widget` is the plugin app's data; hosts pass `_meta` to the app only. */
function splitWidget(output: unknown): { result: unknown; widget?: unknown } {
	if (!output || typeof output !== "object" || !("widget" in output)) {
		return { result: output };
	}
	const { widget, ...result } = output;
	return { result, widget };
}

async function resolveWorkspace(
	userId: string,
	requested: unknown,
): Promise<McpWorkspace> {
	const slug = typeof requested === "string" && requested ? requested : null;
	const [workspace] = await sqlClient<McpWorkspace[]>`
		SELECT o.id, o.slug
		FROM member m
		JOIN organization o ON o.id = m.organization_id
		WHERE m.user_id = ${userId}
			AND (${slug}::text IS NULL OR o.slug = ${slug})
		ORDER BY
			o.slug = (
				SELECT default_workspace FROM mcp_user_setting
				WHERE user_id = ${userId}
			) DESC NULLS LAST,
			o.id = (
				SELECT active_organization_id FROM session
				WHERE user_id = ${userId}
					AND active_organization_id IS NOT NULL
				ORDER BY updated_at DESC
				LIMIT 1
			) DESC NULLS LAST,
			o.id = ${userId} DESC,
			m.created_at
		LIMIT 1
	`;
	if (!workspace) {
		throw new McpToolError(
			slug
				? `No workspace "${slug}". Call list_workspaces for the available slugs.`
				: "You are not a member of any workspace.",
		);
	}
	return workspace;
}

/** The procedures' context for this user with the chosen workspace active. */
async function createToolContext(
	userId: string,
	workspace: McpWorkspace,
	dependencies: McpDependencies,
): Promise<AppContext> {
	const authContext = await dependencies.auth.$context;
	const user = await authContext.internalAdapter.findUserById(userId);
	if (!user) throw new McpToolError("Your Opaline account no longer exists.");
	const now = new Date();
	return {
		user: user as Session["user"],
		session: {
			id: `mcp:${userId}`,
			token: "",
			userId,
			createdAt: now,
			updatedAt: now,
			expiresAt: now,
			ipAddress: null,
			userAgent: "mcp",
			activeOrganizationId: workspace.id,
		} as Session["session"],
		apiKeyId: null,
		authFailure: null,
		ingestOperatorAuthorized: false,
		requestId: dependencies.requestId,
		publicLookupSource: dependencies.publicLookupSource,
	};
}

async function handleConsentRequest(
	request: Request,
	url: URL,
	dependencies: McpDependencies,
): Promise<Response> {
	const { auth } = dependencies;
	const session = await auth.api.getSession({ headers: request.headers });
	if (request.method === "GET") {
		// The login page only accepts a plain relative redirect, so the OAuth
		// query (which contains encoded URLs) travels base64url-encoded.
		const params = new URLSearchParams(
			url.searchParams.has("q")
				? Buffer.from(url.searchParams.get("q") ?? "", "base64url").toString()
				: url.search,
		);
		if (!session) {
			const q = Buffer.from(params.toString()).toString("base64url");
			const redirect = `${MCP_CONSENT_PATH}?q=${q}`;
			return Response.redirect(
				`${getFrontendOrigin()}/login?redirect=${encodeURIComponent(redirect)}`,
				302,
			);
		}
		if (!(await isMcpAvailable(session.user.id))) {
			return htmlPage(UNAVAILABLE_HTML, 403);
		}
		const [client] = await sqlClient<Array<{ name: string | null }>>`
			SELECT name FROM "oauthApplication"
			WHERE client_id = ${params.get("client_id") ?? ""}
			LIMIT 1
		`;
		if (!client) return htmlPage("Unknown application.", 400);
		return htmlPage(
			consentHtml({
				clientName: client.name || "An application",
				redirectHost: safeHost(params.get("redirect_uri")),
				email: session.user.email,
				query: params.toString(),
				userId: session.user.id,
			}),
		);
	}
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { Allow: "GET, POST" },
		});
	}
	const origin = request.headers.get("origin");
	if (!session || !origin || !dependencies.allowedOrigins.includes(origin)) {
		return htmlPage("This request could not be verified.", 403);
	}
	if (!(await isMcpAvailable(session.user.id))) {
		return htmlPage(UNAVAILABLE_HTML, 403);
	}
	const form = await request.formData();
	const query = new URLSearchParams(`${form.get("query") ?? ""}`);
	// The page named one account; a sign-in in another tab must not inherit it.
	if (form.get("user") !== session.user.id) {
		return htmlPage(
			"<p>You switched Opaline accounts. Start the connection again from the app.</p>",
			409,
		);
	}
	if (form.get("decision") !== "allow") {
		const [client] = await sqlClient<Array<{ redirect_urls: string }>>`
			SELECT redirect_urls FROM "oauthApplication"
			WHERE client_id = ${query.get("client_id") ?? ""}
		`;
		const redirectUri = query.get("redirect_uri") ?? "";
		if (!client?.redirect_urls.split(",").includes(redirectUri)) {
			return htmlPage(
				"<p>Access was not granted. You can close this window.</p>",
			);
		}
		const denied = new URL(redirectUri);
		denied.searchParams.set("error", "access_denied");
		if (query.get("state"))
			denied.searchParams.set("state", `${query.get("state")}`);
		return handoffPage(denied.toString());
	}
	// Better Auth validates the client, redirect URI, scopes and PKCE here and
	// answers with the redirect that carries the authorization code. Calling
	// its handler with the consent secret is the only way to reach authorize.
	const headers = new Headers(request.headers);
	headers.set(MCP_CONSENT_HEADER, MCP_CONSENT_SECRET);
	const response = await auth.handler(
		new Request(
			new URL(`${MCP_AUTHORIZE_PATH}?${query}`, request.url).toString(),
			{ headers },
		),
	);
	const location = response.headers.get("location");
	return response.status === 302 && location ? handoffPage(location) : response;
}

/**
 * Production pages carry `form-action 'self'`, which blocks a form POST from
 * redirecting to the client's callback, so the callback is opened from a page.
 */
function handoffPage(url: string) {
	const href = escapeHtml(url);
	return htmlPage(
		`<meta http-equiv="refresh" content="0;url=${href}" /><p>Returning to the app… <a href="${href}">Continue</a></p>`,
	);
}

function safeJson(raw: string): Record<string, unknown> {
	try {
		return JSON.parse(raw) ?? {};
	} catch {
		return {};
	}
}

function safeHost(value: string | null) {
	try {
		return value ? new URL(value).host : "";
	} catch {
		return "";
	}
}

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/gu,
		(character) => `&#${character.charCodeAt(0)};`,
	);
}

function consentHtml(input: {
	clientName: string;
	redirectHost: string;
	email: string;
	query: string;
	userId: string;
}) {
	return `<h1>Connect ${escapeHtml(input.clientName)} to Opaline?</h1>
<p>It will be able to read your Opaline dashboards, sessions, skills, repositories and team data as <strong>${escapeHtml(input.email)}</strong>, and save or share the analyses you ask for. Until an analysis is saved it is a private draft, deleted after 7 days. It never changes or deletes your sessions. Besides analyses, it changes only your own default-workspace setting for the plugin, from the plugin settings page.</p>
<p class="muted">You will be sent back to ${escapeHtml(input.redirectHost || "the application")}. Only continue if you started this connection.</p>
<form method="post" action="${MCP_CONSENT_PATH}">
<input type="hidden" name="query" value="${escapeHtml(input.query)}" />
<input type="hidden" name="user" value="${escapeHtml(input.userId)}" />
<button name="decision" value="allow" type="submit">Allow</button>
<button name="decision" value="deny" type="submit" class="secondary">Cancel</button>
</form>`;
}

function htmlPage(body: string, status = 200) {
	return new Response(
		`<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /><title>Opaline</title>
<style>body{max-width:440px;margin:15vh auto;padding:0 24px;font:15px/1.5 system-ui,sans-serif;color:#1f1f1f}h1{font-size:20px}.muted{color:#6b6b6b}button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #1f1f1f;background:#1f1f1f;color:#fff;cursor:pointer;margin-right:8px}.secondary{background:transparent;color:#1f1f1f}</style>
</head><body>${body}</body></html>`,
		{
			status,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
				"Content-Security-Policy": "frame-ancestors 'none'",
				"Referrer-Policy": "same-origin",
			},
		},
	);
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
	return Response.json({ jsonrpc: "2.0", id, result });
}

/** A legacy-era 400 (not the modern -32022 error), so clients fall back. */
function unsupportedProtocolVersion(requested: string) {
	logger.info("MCP rejected unsupported protocol version {requested}", {
		requested,
	});
	return Response.json(
		{
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32600,
				message: `Unsupported MCP protocol version ${requested}; this server supports ${PROTOCOL_VERSIONS.join(", ")} with the initialize handshake.`,
			},
		},
		{ status: 400 },
	);
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
	return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}
