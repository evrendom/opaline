import { getLogger } from "@logtape/logtape";
import { createRouterClient, ORPCError } from "@orpc/server";
import type { Auth, Session } from "../auth.js";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { isSelfHosted, isSelfHostedAdmin } from "../lib/self-hosted.js";
import { splitAnalyticsInputs } from "../mcp/analytics-inputs.js";
import { workspacePageUrl } from "../mcp/app-links.js";
import {
	DASHBOARD_WIDGET_URI,
	MCP_APP_MIME_TYPE,
	OPALINE_ICON,
	pluginAssetOrigin,
	pluginResourceDomains,
	readDashboardWidgetHtml,
	withAbsoluteAvatars,
} from "../mcp/dashboard-widget.js";
import { mcpOpenToEveryone } from "../mcp/mcp-availability.js";
import {
	APP_ONLY,
	listedTool,
	MCP_TOOLS,
	McpToolError,
	type McpWorkspace,
	retroListedTool,
	SESSION_RESOURCE_PREFIX,
} from "../mcp/mcp-tools.js";
import { isPluginTool, PLUGIN_TOOLS } from "../mcp/plugin-tools.js";
import { withRedactedOutput } from "../mcp/redacted-tools.js";
import { toolsListedFor, workspacesListing } from "../mcp/retro-listing.js";
import {
	recoveryHint,
	unknownToolMessage,
	validationMessage,
} from "../mcp/tool-errors.js";
import type { AppContext } from "../middleware.js";
import { router } from "../router.js";
import { apiKeyFromHeaders, apiKeyUserId } from "../selfhost/api-key-auth.js";
import {
	recordToolCall,
	toolCallRow,
} from "../services/mcp-analytics/tool-calls.js";

export const MCP_PATH = "/api/mcp";
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
	readonly publicLookupSource: string;
	readonly requestId: string;
}

interface JsonRpcRequest {
	readonly id?: string | number | null;
	readonly method?: string;
	readonly params?: Record<string, unknown>;
}

/**
 * Dark launch: until MCP_PLUGIN_PUBLIC is exactly "true", only members of the
 * Opaline team workspace (VITE_ADMIN_ORGANIZATION_ID) can connect or call tools.
 */
async function isMcpAvailable(userId: string) {
	if (mcpOpenToEveryone()) return true;
	const team = process.env.VITE_ADMIN_ORGANIZATION_ID;
	if (!team) return false;
	const rows = await sqlClient`
		SELECT 1 FROM member WHERE organization_id = ${team} AND user_id = ${userId}
	`;
	return rows.length > 0;
}

async function listingFor(
	userId: string,
): Promise<{ retro: boolean; admin: boolean }> {
	const memberships = await sqlClient<
		{ id: string; createdAt: Date | string | null }[]
	>`
		SELECT m.organization_id AS id, o.created_at AS "createdAt"
		FROM member m
		LEFT JOIN organization o ON o.id = m.organization_id
		WHERE m.user_id = ${userId}
	`;
	const listing = workspacesListing(memberships);
	return isSelfHosted()
		? { ...listing, admin: await isSelfHostedAdmin(sqlClient, userId) }
		: listing;
}

function listedTools(listing: { retro: boolean; admin: boolean }) {
	const tools = toolsListedFor(TOOLS, listing.retro, listing.admin);
	return listing.retro ? tools.map(retroListedTool) : tools.map(listedTool);
}

/**
 * Routes the MCP endpoint. Clients authenticate with an API key (the Mac app
 * writes one into each agent's plugin config); there is no OAuth flow.
 * Returns null for any other path.
 */
export function handleMcpRoute(
	request: Request,
	url: URL,
	dependencies: McpDependencies,
): Promise<Response> | null {
	if (url.pathname === MCP_PATH) return handleMcpRequest(request, dependencies);
	// Domain ownership check for the OpenAI plugin directory.
	if (url.pathname === "/.well-known/openai-apps-challenge") {
		const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
		return Promise.resolve(
			token
				? new Response(token, { headers: { "Content-Type": "text/plain" } })
				: new Response("Not Found", { status: 404 }),
		);
	}
	return null;
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
	const userId = isSelfHosted()
		? await apiKeyUserId(
				dependencies.auth.api,
				apiKeyFromHeaders(request.headers),
			)
		: null;
	if (!userId) {
		return Response.json(
			{ error: "invalid_token" },
			{ status: 401, headers: { "WWW-Authenticate": "Bearer" } },
		);
	}
	if (!(await isMcpAvailable(userId))) {
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
				tools: listedTools(await listingFor(userId)),
			});
		case "tools/call":
			return rpcResult(
				message.id,
				await callTool(userId, params, dependencies),
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
			return readResource(message.id, `${params.uri}`, userId, dependencies);
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
	if ("isError" in result)
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
	const calledAt = new Date();
	const started = performance.now();
	const tool = TOOLS.find((candidate) => candidate.name === params.name);
	const raw = (params.arguments ?? {}) as Record<string, unknown>;
	const recorded = tool !== undefined && !isAppTool(tool);
	const { args, intent } = recorded
		? splitAnalyticsInputs(raw)
		: { args: raw, intent: null };
	const seen = { workspaceId: "", errorCode: null as string | null };
	const response = await runTool(
		tool,
		userId,
		params,
		args,
		dependencies,
		seen,
	);
	if (tool && recorded && intent)
		void recordToolCall(
			getClickhouse(),
			toolCallRow({
				tool: tool.name,
				userId,
				workspaceId: seen.workspaceId,
				calledAt,
				context: intent.context,
				llmModel: intent.llmModel,
				durationMs: performance.now() - started,
				errorCode: seen.errorCode,
				outputChars: response.content.reduce(
					(total, block) => total + block.text.length,
					0,
				),
				...(tool.recordsInput ? { feedback: withoutWorkspace(args) } : {}),
			}),
		);
	return response;
}

function withoutWorkspace(args: Record<string, unknown>) {
	const { workspace: _workspace, ...rest } = args;
	return rest;
}

async function runTool(
	tool: (typeof TOOLS)[number] | undefined,
	userId: string,
	params: Record<string, unknown>,
	args: Record<string, unknown>,
	dependencies: McpDependencies,
	seen: { workspaceId: string; errorCode: string | null },
) {
	const appTool = tool ? isAppTool(tool) : false;
	try {
		if (!tool)
			throw new McpToolError(
				unknownToolMessage(params.name, await modelTools(userId)),
			);
		const workspace = await resolveWorkspace(userId, args.workspace);
		seen.workspaceId = workspace.id;
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
						text: `Open in Opaline: ${workspacePageUrl(workspace.slug, tool.link(args))}`,
					},
				]
			: [];
		const structured = isPluginTool(tool)
			? { result: withAbsoluteAvatars(result) }
			: (appTool || tool.outputSchema) && result && typeof result === "object"
				? Array.isArray(result)
					? { items: result }
					: result
				: undefined;
		return {
			content: appTool
				? []
				: [
						{
							type: "text",
							text:
								typeof result === "string" ? result : JSON.stringify(result),
						},
						...link,
					],
			...(structured ? { structuredContent: structured } : {}),
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
		const message = known ? error.message : "The tool failed.";
		// The widget's session view retries and refreshes on these codes.
		const typed =
			error instanceof ORPCError
				? { code: error.code, status: error.status, data: error.data }
				: {
						code: known ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
						status: known ? 400 : 500,
					};
		seen.errorCode = `${typed.code}`;
		const issues = (typed as { data?: { issues?: unknown } }).data?.issues;
		const hint = typed.status >= 500 ? recoveryHint(params.name) : undefined;
		const text =
			tool && typed.code === "BAD_REQUEST" && Array.isArray(issues)
				? validationMessage(
						{ ...tool, inputSchema: tool.retroInputSchema ?? tool.inputSchema },
						issues,
					)
				: hint
					? `${message}\n\n${hint}`
					: typed.status >= 500
						? `${message} Try again.`
						: message;
		return {
			content: [{ type: "text", text: appTool ? message : text }],
			...(appTool || !tool
				? { structuredContent: { error: { ...typed, message } } }
				: {}),
			isError: true as const,
		};
	}
}

function isAppTool(tool: (typeof TOOLS)[number]): boolean {
	return tool.meta?.ui === APP_ONLY.ui || isPluginTool(tool);
}

async function modelTools(userId: string) {
	const listing = await listingFor(userId);
	return toolsListedFor(TOOLS, listing.retro, listing.admin).filter(
		(tool) => !isAppTool(tool),
	);
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
		SELECT o.id, o.slug, o.created_at AS "createdAt"
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
