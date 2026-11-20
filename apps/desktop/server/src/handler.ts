import { getLogger, withContext } from "@logtape/logtape";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { SESSION_ARRIVALS_PATH } from "@rudel/api-routes";
import type { Session as AuthSession } from "./auth.js";
import { createAuth } from "./auth.js";
import { db, sqlClient } from "./db.js";
import { getResendConfigWarnings } from "./email.js";
import {
	handleAvatarGetRequest,
	handleAvatarUploadRequest,
} from "./handlers/avatar-http.js";
import { handleCliConnectionRequest } from "./handlers/cli-connection-http.js";
import {
	handleLocalObjectStoreRoute,
	isLocalObjectStorePath,
} from "./handlers/local-object-store-http.js";
import { handleMcpRoute } from "./handlers/mcp-http.js";
import { handleSelfHostRoute, selfHostAuth } from "./handlers/selfhost-http.js";
import { handleSessionArrivalsRequest } from "./handlers/session-arrivals-http.js";
import { handleSessionDetailStatsRequest } from "./handlers/session-detail-stats-http.js";
import {
	API_RESPONSE_MAX_BYTES,
	enforceApiResponseSize,
	isStreamedRpcResponse,
} from "./lib/api-response-size.js";
import { enforceCookieCsrfOrigin } from "./lib/csrf-origin.js";
import { getDependencyHealthResponse } from "./lib/dependency-health.js";
import {
	readBetterAuthSecret,
	readCliDeviceVerificationUrl,
	readNonNegativeSafeIntegerEnv,
	readPositiveSafeIntegerEnv,
} from "./lib/env.js";
import { maybeCompressSessionDetailRpcResponse } from "./lib/http-compression.js";
import {
	appendVaryHeader,
	PRODUCTION_SECURITY_HEADERS,
} from "./lib/http-response-policy.js";
import { isAuthorizedIngestOperatorRequest } from "./lib/ingest-quiescence.js";
import { resolvePublicLookupSource } from "./lib/public-lookup-source.js";
import { createRequestWorkspaceLookups } from "./lib/request-workspace.js";
import {
	createRpcBatchPlugin,
	readWorkspaceFromRequest,
} from "./lib/rpc-batch.js";
import { isSelfHosted } from "./lib/self-hosted.js";
import { setupLogging } from "./logging.js";
import type { ApiKeyAuthFailure, AppContext } from "./middleware.js";
import { readPasswordAuthAllowlist } from "./password-auth.js";
import { readResendConfig } from "./resend-config.js";
import { router } from "./router.js";
import { consumeLoginToken } from "./selfhost/login-tokens.js";
import { createSignUpGate } from "./selfhost/signup-gate.js";
import { getIngestFilterQueueMetrics } from "./services/ingest-filter.service.js";
import {
	isIngestStillProcessingBody,
	isIngestStillProcessingReply,
} from "./services/r2-ingest-http-error.js";

await setupLogging();

const logger = getLogger(["rudel", "api", "http"]);
type AuthUser = AuthSession["user"];
const betterAuthSecret = readBetterAuthSecret();
const port = process.env.PORT ?? "4010";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const IS_TEST = process.env.NODE_ENV === "test";
const DEFAULT_DEV_API_ORIGIN = `http://localhost:${port}`;
const DEFAULT_DEV_ORIGIN = "http://localhost:4011";
const DEFAULT_DEV_ORIGINS = [
	DEFAULT_DEV_ORIGIN,
	"http://127.0.0.1:4011",
	"http://localhost:4012",
	"http://127.0.0.1:4012",
	"http://localhost:4013",
	"http://127.0.0.1:4013",
	"http://localhost:4014",
	"http://127.0.0.1:4014",
	"http://localhost:4015",
	"http://127.0.0.1:4015",
	"http://localhost:4600",
	"http://127.0.0.1:4600",
] as const;

const socialProviders: Record<
	string,
	{ clientId: string; clientSecret: string }
> = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
	socialProviders.google = {
		clientId: process.env.GOOGLE_CLIENT_ID,
		clientSecret: process.env.GOOGLE_CLIENT_SECRET,
	};
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
	socialProviders.github = {
		clientId: process.env.GITHUB_CLIENT_ID,
		clientSecret: process.env.GITHUB_CLIENT_SECRET,
	};
}

const preferredFrontendOrigin =
	process.env.ALLOWED_ORIGIN ?? DEFAULT_DEV_ORIGIN;
const rawAppURL = process.env.APP_URL ?? DEFAULT_DEV_API_ORIGIN;
const appURL = isSelfHosted()
	? rawAppURL
	: resolveAuthAppURL({
			defaultDevApiOrigin: DEFAULT_DEV_API_ORIGIN,
			preferredFrontendOrigin,
			rawAppURL,
		});
const configuredTrustedOrigins = process.env.TRUSTED_ORIGINS
	? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
	: [];
const trustedOrigins = [
	...new Set([
		preferredFrontendOrigin,
		...configuredTrustedOrigins,
		...DEFAULT_DEV_ORIGINS,
	]),
];
const resend = readResendConfig();

if (appURL !== rawAppURL) {
	logger.warn(
		"Overriding APP_URL from {rawAppURL} to {appURL} because the frontend origin is local ({preferredFrontendOrigin})",
		{
			appURL,
			preferredFrontendOrigin,
			rawAppURL,
		},
	);
}

for (const warning of getResendConfigWarnings(resend)) {
	logger.warn(warning);
}

const cliDeviceVerification = readCliDeviceVerificationUrl(
	preferredFrontendOrigin,
);
if (cliDeviceVerification.warning) {
	logger.warn(cliDeviceVerification.warning);
}

export const auth = createAuth(db, {
	appURL,
	frontendURL: preferredFrontendOrigin,
	// The showcase handler signs its account in with a password.
	passwordAuthEmails: readPasswordAuthAllowlist(),
	secret: betterAuthSecret,
	resend,
	socialProviders,
	trustedOrigins,
	cliDeviceVerificationUrl: cliDeviceVerification.url,
	slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
	selfHostedLogin: isSelfHosted()
		? (token) => consumeLoginToken(sqlClient, token)
		: undefined,
	beforeUserCreate: isSelfHosted() ? createSignUpGate(sqlClient) : undefined,
});

const selfHostDependencies = {
	auth: selfHostAuth(auth),
	sql: sqlClient,
	env: process.env,
	socialProviders: Object.keys(socialProviders),
};

const rpcHandler = new RPCHandler(router, {
	plugins: [createRpcBatchPlugin<AppContext>()],
	rootInterceptors: [readWorkspaceFromRequest<AppContext>],
	clientInterceptors: [
		onError((error, { context }) => {
			if (
				error instanceof ORPCError &&
				error.code !== "INTERNAL_SERVER_ERROR"
			) {
				return;
			}

			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				cause: error,
				data: { requestId: context.requestId },
			});
		}),
	],
	interceptors: [
		onError((error) => {
			if (isIngestStillProcessingReply(error)) return;
			const logError =
				error instanceof Error && error.cause instanceof Error
					? error.cause
					: error;
			logger.error("RPC unhandled exception: {error} {stack}", {
				error: String(logError),
				stack: logError instanceof Error ? logError.stack : undefined,
			});
		}),
	],
});

function corsHeaders(origin: string | null): Record<string, string> {
	if (!origin || !trustedOrigins.includes(origin)) return {};
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Credentials": "true",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
	};
}

function applyHttpResponsePolicy(
	response: Response,
	input: {
		readonly pathname: string;
		readonly requestId: string;
	},
) {
	response.headers.set("X-Request-ID", input.requestId);
	if (response.headers.has("Access-Control-Allow-Origin")) {
		appendVaryHeader(response.headers, "Origin");
	}

	if (!response.headers.has("Cache-Control")) {
		const isImmutableAsset =
			response.status === 200 &&
			input.pathname.startsWith("/assets/") &&
			!response.headers.get("Content-Type")?.startsWith("text/html");
		response.headers.set(
			"Cache-Control",
			isImmutableAsset ? "public, max-age=31536000, immutable" : "no-store",
		);
	}

	if (!IS_PRODUCTION) {
		return response;
	}

	for (const [name, value] of Object.entries(PRODUCTION_SECURITY_HEADERS)) {
		response.headers.set(name, value);
	}

	return response;
}

export const MAX_REQUEST_BODY_BYTES = readPositiveSafeIntegerEnv(
	"MAX_REQUEST_BODY_BYTES",
	160 * 1024 * 1024,
);
const TRUSTED_PROXY_HOPS = readNonNegativeSafeIntegerEnv(
	"TRUSTED_PROXY_HOPS",
	0,
);

export interface FetchHandlerFallbackInput {
	readonly cors: Readonly<Record<string, string>>;
	readonly request: Request;
	readonly requestId: string;
	readonly url: URL;
	readonly publicLookupSource: string;
}

export interface FetchHandlerOptions {
	readonly fallback?: (
		input: FetchHandlerFallbackInput,
	) => Promise<Response | null>;
	readonly socketIp?: string | null;
}

export async function fetchHandler(
	request: Request,
	options: FetchHandlerOptions = {},
): Promise<Response> {
	const origin = request.headers.get("Origin");
	const cors = corsHeaders(origin);
	const url = new URL(request.url);
	const requestId = crypto.randomUUID();

	if (request.method === "OPTIONS") {
		return applyHttpResponsePolicy(
			new Response(null, { status: 204, headers: cors }),
			{
				pathname: url.pathname,
				requestId,
			},
		);
	}

	const csrfRejection = enforceCookieCsrfOrigin({
		allowedOrigins: trustedOrigins,
		request,
	});
	if (csrfRejection) {
		for (const [name, value] of Object.entries(cors)) {
			csrfRejection.headers.set(name, value);
		}
		return applyHttpResponsePolicy(csrfRejection, {
			pathname: url.pathname,
			requestId,
		});
	}

	const contentLength = request.headers.get("Content-Length");
	if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_BYTES) {
		return applyHttpResponsePolicy(
			new Response(
				JSON.stringify({
					error: `Request body too large. Maximum size is ${Math.round(MAX_REQUEST_BODY_BYTES / (1024 * 1024))} MB.`,
				}),
				{
					status: 413,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			),
			{
				pathname: url.pathname,
				requestId,
			},
		);
	}

	if (
		process.env.NODE_ENV === "test" &&
		url.pathname === "/__test/ingest-filter-queue-metrics"
	) {
		return applyHttpResponsePolicy(
			Response.json(getIngestFilterQueueMetrics()),
			{
				pathname: url.pathname,
				requestId,
			},
		);
	}

	if (url.pathname === "/health/ready") {
		const response =
			request.method === "GET" || request.method === "HEAD"
				? await getDependencyHealthResponse()
				: new Response("Method not allowed", {
						status: 405,
						headers: { Allow: "GET, HEAD" },
					});
		return applyHttpResponsePolicy(response, {
			pathname: url.pathname,
			requestId,
		});
	}

	if (url.pathname === "/health") {
		return applyHttpResponsePolicy(Response.json({ status: "ok" }), {
			pathname: url.pathname,
			requestId,
		});
	}

	const start = performance.now();
	const publicLookupSource = resolvePublicLookupSource({
		forwardedFor: request.headers.get("x-forwarded-for"),
		socketIp: options.socketIp ?? null,
		trustedProxyHops: TRUSTED_PROXY_HOPS,
	});

	return withContext(
		{ requestId, method: request.method, path: url.pathname },
		async () => {
			const response = await handleRequest(
				request,
				url,
				cors,
				requestId,
				publicLookupSource,
				options.fallback,
			);
			const finalResponse =
				url.pathname === "/rpc" ||
				url.pathname.startsWith("/rpc/") ||
				isLocalObjectStorePath(url.pathname) ||
				((url.pathname === SESSION_ARRIVALS_PATH ||
					/^\/api\/cli\/connections\/[a-f0-9-]+\/events$/u.test(
						url.pathname,
					)) &&
					response.headers.get("Content-Type")?.startsWith("text/event-stream"))
					? response
					: await enforceApiResponseSize({
							pathname: url.pathname,
							response,
						});
			const duration = Math.round(performance.now() - start);
			logger.info("{method} {path} {status} {duration}ms", {
				method: request.method,
				path: url.pathname,
				status: finalResponse.status,
				duration,
			});
			return applyHttpResponsePolicy(finalResponse, {
				pathname: url.pathname,
				requestId,
			});
		},
	);
}
function resolveAuthAppURL(input: {
	defaultDevApiOrigin: string;
	preferredFrontendOrigin: string;
	rawAppURL: string;
}) {
	const { defaultDevApiOrigin, preferredFrontendOrigin, rawAppURL } = input;

	if (!isLoopbackOrigin(preferredFrontendOrigin)) {
		return rawAppURL;
	}

	if (!isLoopbackOrigin(rawAppURL)) {
		return defaultDevApiOrigin;
	}

	if (sameOrigin(rawAppURL, preferredFrontendOrigin)) {
		return defaultDevApiOrigin;
	}

	return rawAppURL;
}

function isLoopbackOrigin(origin: string) {
	try {
		const url = new URL(origin);
		return url.hostname === "localhost" || url.hostname === "127.0.0.1";
	} catch {
		return false;
	}
}

function sameOrigin(left: string, right: string) {
	try {
		const leftUrl = new URL(left);
		const rightUrl = new URL(right);
		return leftUrl.origin === rightUrl.origin;
	} catch {
		return false;
	}
}

async function handleRequest(
	request: Request,
	url: URL,
	cors: Record<string, string>,
	requestId: string,
	publicLookupSource: string,
	fallback: FetchHandlerOptions["fallback"],
): Promise<Response> {
	const objectStoreResponse = handleLocalObjectStoreRoute(request, url);
	if (objectStoreResponse) return objectStoreResponse;
	const selfHostResponse = handleSelfHostRoute(
		request,
		url,
		selfHostDependencies,
	);
	if (selfHostResponse) return selfHostResponse;
	const mcpResponse = handleMcpRoute(request, url, {
		auth,
		allowedOrigins: trustedOrigins,
		publicLookupSource,
		requestId,
	});
	if (mcpResponse) return mcpResponse;
	if (
		url.pathname === "/api/cli/connections" ||
		url.pathname.startsWith("/api/cli/connections/")
	) {
		const response = await handleCliConnectionRequest(request, {
			allowedOrigins: trustedOrigins,
			source: publicLookupSource,
			getUserId: async (req) =>
				(await getContext(req, requestId, publicLookupSource)).user?.id ?? null,
			getBrowserUserId: async (req) =>
				(await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
		});
		for (const [key, value] of Object.entries(cors))
			response.headers.set(key, value);
		return response;
	}
	if (url.pathname === SESSION_ARRIVALS_PATH) {
		const session = await auth.api.getSession({ headers: request.headers });
		const response = await handleSessionArrivalsRequest(
			request,
			session?.user.id ?? null,
		);
		for (const [key, value] of Object.entries(cors))
			response.headers.set(key, value);
		return response;
	}
	if (IS_TEST && url.pathname === "/api/__test/oversized-response") {
		return Response.json({ payload: "x".repeat(API_RESPONSE_MAX_BYTES) });
	}
	if (IS_TEST && url.pathname === "/rpc/__test/oversized-response") {
		return enforceApiResponseSize({
			pathname: url.pathname,
			response: Response.json({
				json: { payload: "x".repeat(API_RESPONSE_MAX_BYTES) },
			}),
		});
	}
	// Defense in depth: block Better Auth's built-in org deletion route.
	// Opaline has its own guarded deletion path via the RPC router.
	if (url.pathname === "/api/auth/organization/delete") {
		return new Response("Not Found", { status: 404, headers: cors });
	}
	if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
		const response = await auth.handler(request);
		for (const [key, value] of Object.entries(cors)) {
			response.headers.set(key, value);
		}
		return response;
	}

	if (url.pathname.startsWith("/api/avatar/")) {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method Not Allowed", {
				headers: { ...cors, Allow: "GET, HEAD" },
				status: 405,
			});
		}
		return handleAvatarGetRequest({
			cors,
			ifNoneMatch: request.headers.get("If-None-Match"),
			method: request.method,
			pathname: url.pathname,
		});
	}

	if (url.pathname === "/api/profile/avatar") {
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				headers: { ...cors, Allow: "POST" },
				status: 405,
			});
		}
		return handleAvatarUploadRequest({
			cors,
			getSession: (req) => auth.api.getSession({ headers: req.headers }),
			request,
			requestId,
		});
	}

	if (url.pathname === "/api/dev/session-detail-stats") {
		return handleSessionDetailStatsRequest({
			cors,
			enabled: isLoopbackOrigin(preferredFrontendOrigin),
			getSession: (req) => auth.api.getSession({ headers: req.headers }),
			request,
		});
	}

	const { matched, response } = await rpcHandler.handle(request, {
		prefix: "/rpc",
		context: await getContext(request, requestId, publicLookupSource),
	});

	if (matched) {
		if (response.status >= 500) {
			const body = await response.clone().text();
			if (isIngestStillProcessingBody(body))
				logger.info(
					"RPC {path}: {status}, the ingest job is still processing {body}",
					{ path: url.pathname, status: response.status, body },
				);
			else
				logger.error("RPC error on {path}: {status} {body}", {
					path: url.pathname,
					status: response.status,
					body,
				});
		}
		for (const [key, value] of Object.entries(cors)) {
			response.headers.set(key, value);
		}
		if (isStreamedRpcResponse(url.pathname, response)) return response;
		return maybeCompressSessionDetailRpcResponse({
			pathname: url.pathname,
			requestHeaders: request.headers,
			response: await enforceApiResponseSize({
				pathname: url.pathname,
				response,
			}),
		});
	}

	const fallbackResponse = await fallback?.({
		cors,
		request,
		requestId,
		url,
		publicLookupSource,
	});
	if (fallbackResponse) {
		return fallbackResponse;
	}

	// Dev mode: redirect to frontend dev server for non-API routes
	// (e.g., after OAuth callback redirects to APP_URL which has no SPA)
	if (preferredFrontendOrigin !== appURL) {
		return Response.redirect(
			`${preferredFrontendOrigin}${url.pathname}${url.search}`,
			302,
		);
	}

	return new Response("Not found", { status: 404, headers: cors });
}

async function getContext(
	request: Request,
	requestId: string,
	publicLookupSource: string,
) {
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	let apiKeyId: string | null = null;
	let authFailure: ApiKeyAuthFailure | null = null;
	const apiKey =
		request.headers.get("x-api-key") ??
		request.headers.get("X-API-Key") ??
		null;

	let apiKeyUser: AuthUser | null = null;
	if (apiKey) {
		try {
			const verification = await auth.api.verifyApiKey({
				body: {
					key: apiKey,
					permissions: { ingest: ["write"] },
				},
			});

			if (verification.valid && verification.key) {
				const [foundUser] = await sqlClient<
					Array<{
						createdAt: Date;
						email: string;
						emailVerified: boolean;
						id: string;
						image: string | null;
						name: string;
						updatedAt: Date;
					}>
				>`
					SELECT
						id,
						name,
						email,
						email_verified AS "emailVerified",
						image,
						created_at AS "createdAt",
						updated_at AS "updatedAt"
					FROM "user"
					WHERE id = ${verification.key.referenceId}
					LIMIT 1
				`;

				if (foundUser) {
					apiKeyUser = {
						id: foundUser.id,
						name: foundUser.name,
						email: foundUser.email,
						emailVerified: foundUser.emailVerified,
						image: foundUser.image,
						createdAt: foundUser.createdAt,
						updatedAt: foundUser.updatedAt,
					} satisfies AuthUser;
					apiKeyId = verification.key.id;
				}
			} else {
				authFailure = getApiKeyAuthFailure(verification);
				logger.warn("API key verification failed: {code} {message}", {
					code: authFailure.code ?? "unknown",
					message: authFailure.message,
				});
			}
		} catch (error) {
			authFailure = getApiKeyAuthFailure(error);
			logger.warn("API key verification threw: {code} {message}", {
				code: authFailure.code ?? "unknown",
				message: authFailure.message,
			});
		}
	}

	return {
		user: session?.user ?? apiKeyUser ?? null,
		session: session?.session ?? null,
		apiKeyId,
		authFailure,
		ingestOperatorAuthorized: isAuthorizedIngestOperatorRequest(
			request.headers,
		),
		requestId,
		publicLookupSource,
		workspaceLookups: createRequestWorkspaceLookups(),
	};
}

function getApiKeyAuthFailure(input: unknown): ApiKeyAuthFailure {
	const error = getErrorRecord(input);
	const code = getStringProperty(error, "code");
	const message =
		getStringProperty(error, "message") ??
		(code === "RATE_LIMITED"
			? "API key rate limit exceeded"
			: "API key verification failed");

	return { code, message };
}

function getErrorRecord(input: unknown): Record<string, unknown> | null {
	if (isRecord(input) && isRecord(input.error)) {
		return input.error;
	}

	if (isRecord(input) && isRecord(input.body)) {
		return input.body;
	}

	return isRecord(input) ? input : null;
}

function getStringProperty(
	record: Record<string, unknown> | null,
	key: string,
) {
	const value = record?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
