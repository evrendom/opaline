import { randomBytes, timingSafeEqual } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import type { GitHubTokenStatus } from "@rudel/api-routes";
import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import type postgres from "postgres";
import { z } from "zod";
import type { Auth } from "../auth.js";
import { isSelfHosted, isSelfHostedAdmin } from "../lib/self-hosted.js";
import {
	type ApiKeyVerifier,
	apiKeyFromHeaders,
	apiKeyUserId,
} from "../selfhost/api-key-auth.js";
import { SELF_HOSTED_LOGIN_PATH } from "../selfhost/login-plugin.js";
import {
	issueLoginToken,
	LOGIN_TOKEN_TTL_SECONDS,
	loginUrl,
	MEMBER_LOGIN_TOKEN_TTL_SECONDS,
} from "../selfhost/login-tokens.js";
import { isOpenSignup } from "../selfhost/signup-gate.js";

export const SELFHOST_PATH_PREFIX = "/api/selfhost/";
export const SETUP_TOKEN_HEADER = "x-opaline-setup-token";
export const CLI_API_KEY_NAME = "rudel-cli-ingest";

const logger = getLogger(["rudel", "api", "selfhost"]);

type Environment = Readonly<Record<string, string | undefined>>;

export interface SelfHostAuth {
	readonly api: ApiKeyVerifier & {
		signUpEmail(input: {
			body: { email: string; password: string; name: string };
		}): Promise<{ user: { id: string } }>;
		createApiKey(input: {
			body: { userId: string; name: string; expiresIn: null };
		}): Promise<{ id: string; key: string }>;
		getSession(input: {
			headers: Headers;
		}): Promise<{ user: { id: string } } | null>;
	};
	handler(request: Request): Promise<Response>;
}

export interface SelfHostDependencies {
	readonly auth: SelfHostAuth;
	readonly sql: postgres.Sql;
	readonly env: Environment;
	readonly socialProviders: readonly string[];
	readonly readGitHub?: (
		sql: postgres.Sql,
		env: Environment,
	) => Promise<GitHubTokenStatus>;
}

const SetupBodySchema = z.object({
	email: z.string().trim().toLowerCase().email().max(320),
	name: z.string().trim().min(1).max(200),
	workspaceName: z.string().trim().min(1).max(100),
});

const LoginLinkBodySchema = z
	.object({ email: z.string().trim().toLowerCase().email().max(320) })
	.partial();

let setupQueue: Promise<unknown> = Promise.resolve();

export function selfHostAuth(auth: Auth): SelfHostAuth {
	return auth as unknown as SelfHostAuth;
}

export function handleSelfHostRoute(
	request: Request,
	url: URL,
	deps: SelfHostDependencies,
): Promise<Response> | null {
	if (!isSelfHosted(deps.env) || !url.pathname.startsWith(SELFHOST_PATH_PREFIX))
		return null;
	const route = `${request.method} ${url.pathname}`;
	switch (route) {
		case "GET /api/selfhost/info":
		case "HEAD /api/selfhost/info":
			return info(deps);
		case "POST /api/selfhost/setup":
			return setup(request, deps);
		case "POST /api/selfhost/login-link":
			return loginLink(request, deps);
		case "GET /api/selfhost/github":
			return githubStatus(request, deps);
		case "GET /api/selfhost/ingest/timings":
			return ingestTimings(request, deps);
		case "GET /api/selfhost/ingest/status":
			return ingestStatus(request, deps);
		case "POST /api/selfhost/ingest/notify":
			return ingestNotify(request, deps);
		case "GET /api/selfhost/login":
			return deps.auth.handler(
				new Request(
					new URL(
						`/api/auth${SELF_HOSTED_LOGIN_PATH}${url.search}`,
						url,
					).toString(),
					{ headers: request.headers, method: "GET" },
				),
			);
		default:
			return Promise.resolve(
				Response.json({ error: "not_found" }, { status: 404 }),
			);
	}
}

function appUrlOf(env: Environment): string {
	return (env.APP_URL ?? "").replace(/\/+$/u, "");
}

async function info(deps: SelfHostDependencies): Promise<Response> {
	const [row] = await deps.sql<{ users: boolean }[]>`
		SELECT EXISTS (SELECT 1 FROM "user") AS users
	`;
	const appUrl = appUrlOf(deps.env);
	return Response.json({
		selfHosted: true,
		version: deps.env.OPALINE_VERSION?.trim() || "dev",
		appUrl,
		mcpUrl: `${appUrl}/api/mcp`,
		setupComplete: row?.users === true,
		auth: {
			password: true,
			emailCodes: Boolean(deps.env.RESEND_API_KEY?.trim()),
			social: [...deps.socialProviders],
			openSignup: isOpenSignup(deps.env),
		},
	});
}

async function setup(
	request: Request,
	deps: SelfHostDependencies,
): Promise<Response> {
	const expected = deps.env.OPALINE_SETUP_TOKEN?.trim();
	if (!expected)
		return Response.json(
			{
				error: "setup_disabled",
				message: "OPALINE_SETUP_TOKEN is not set on this server.",
			},
			{ status: 403 },
		);
	if (!sameSecret(request.headers.get(SETUP_TOKEN_HEADER) ?? "", expected))
		return Response.json({ error: "invalid_setup_token" }, { status: 401 });
	const parsed = SetupBodySchema.safeParse(
		await request.json().catch(() => null),
	);
	if (!parsed.success)
		return Response.json(
			{
				error: "invalid_body",
				message: "Send { email, name, workspaceName }.",
				issues: parsed.error.issues.map((issue) => ({
					path: issue.path.join("."),
					message: issue.message,
				})),
			},
			{ status: 400 },
		);
	const run = setupQueue.then(() => createFirstUser(parsed.data, deps));
	setupQueue = run.catch(() => undefined);
	return run;
}

async function createFirstUser(
	body: z.infer<typeof SetupBodySchema>,
	deps: SelfHostDependencies,
): Promise<Response> {
	const [state] = await deps.sql<{ users: number; existing: string | null }[]>`
		SELECT
			(SELECT count(*)::int FROM "user") AS users,
			(SELECT id FROM "user" WHERE lower(email) = ${body.email} LIMIT 1) AS existing
	`;
	let userId = state?.existing ?? null;
	if (userId === null) {
		if ((state?.users ?? 0) > 0)
			return Response.json(
				{
					error: "setup_complete",
					message:
						"This server already has users; sign in instead, or ask its owner for an invite.",
				},
				{ status: 409 },
			);
		const created = await deps.auth.api.signUpEmail({
			body: {
				email: body.email,
				password: randomBytes(24).toString("base64url"),
				name: body.name,
			},
		});
		userId = created.user.id;
		await deps.sql`
			UPDATE "user" SET email_verified = true, updated_at = now()
			WHERE id = ${userId}
		`;
		await renameFirstWorkspace(deps.sql, userId, body.workspaceName);
	}
	const [user] = await deps.sql<{ id: string; email: string; name: string }[]>`
		SELECT id, email, name FROM "user" WHERE id = ${userId}
	`;
	const [organization] = await deps.sql<
		{ id: string; slug: string; name: string }[]
	>`
		SELECT o.id, o.slug, o.name
		FROM organization o
		JOIN member m ON m.organization_id = o.id
		WHERE m.user_id = ${userId} AND m.role = 'owner'
		ORDER BY o.created_at, o.id
		LIMIT 1
	`;
	if (!user || !organization)
		return Response.json(
			{ error: "setup_failed", message: "The user has no workspace." },
			{ status: 500 },
		);
	const apiKey = await deps.auth.api.createApiKey({
		body: { userId: user.id, name: CLI_API_KEY_NAME, expiresIn: null },
	});
	const token = await issueLoginToken(deps.sql, user.id);
	void import("../selfhost/local-ingest/index.js").then((module) =>
		module.getLocalIngest()?.wake(),
	);
	return Response.json({
		user,
		organization,
		apiKey: apiKey.key,
		apiKeyId: apiKey.id,
		loginUrl: loginUrl(appUrlOf(deps.env), token),
	});
}

export function workspaceSlug(name: string, fallback: string): string {
	const slug = name
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/gu, "-")
		.replace(/-+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 48)
		.replace(/-+$/gu, "");
	return validateOrgSlug(slug) ? slug : fallback;
}

async function renameFirstWorkspace(
	sql: postgres.Sql,
	userId: string,
	workspaceName: string,
): Promise<void> {
	const [organization] = await sql<{ id: string; slug: string }[]>`
		SELECT o.id, o.slug
		FROM organization o
		JOIN member m ON m.organization_id = o.id
		WHERE m.user_id = ${userId} AND m.role = 'owner'
		ORDER BY o.created_at, o.id
		LIMIT 1
	`;
	if (!organization) return;
	const slug = workspaceSlug(workspaceName, organization.slug);
	await sql`
		UPDATE organization
		SET name = ${workspaceName},
			slug = CASE
				WHEN EXISTS (SELECT 1 FROM organization WHERE slug = ${slug} AND id <> ${organization.id})
				THEN slug ELSE ${slug} END
		WHERE id = ${organization.id}
	`;
}

type LoginLinkActor =
	| { readonly kind: "setup" }
	| { readonly kind: "user"; readonly userId: string; readonly via: string };

async function loginLinkActor(
	request: Request,
	deps: SelfHostDependencies,
): Promise<LoginLinkActor | Response> {
	const setupToken = request.headers.get(SETUP_TOKEN_HEADER);
	if (setupToken !== null) {
		const expected = deps.env.OPALINE_SETUP_TOKEN?.trim();
		return expected && sameSecret(setupToken.trim(), expected)
			? { kind: "setup" }
			: Response.json({ error: "invalid_setup_token" }, { status: 401 });
	}
	const key = apiKeyFromHeaders(request.headers);
	if (key) {
		const userId = await apiKeyUserId(deps.auth.api, key);
		return userId
			? { kind: "user", userId, via: "api key" }
			: Response.json(
					{
						error: "invalid_api_key",
						message: "Send the server's API key as x-api-key or Bearer.",
					},
					{ status: 401 },
				);
	}
	const session = await deps.auth.api
		.getSession({ headers: request.headers })
		.catch(() => null);
	return session
		? { kind: "user", userId: session.user.id, via: "browser session" }
		: Response.json(
				{
					error: "unauthorized",
					message:
						"Send the setup token, an API key, or a browser session cookie.",
				},
				{ status: 401 },
			);
}

async function loginLink(
	request: Request,
	deps: SelfHostDependencies,
): Promise<Response> {
	const actor = await loginLinkActor(request, deps);
	if (actor instanceof Response) return actor;
	const text = await request.text().catch(() => "");
	let raw: unknown = {};
	try {
		raw = text.trim() ? JSON.parse(text) : {};
	} catch {
		raw = null;
	}
	const parsed = LoginLinkBodySchema.safeParse(raw);
	if (!parsed.success)
		return Response.json(
			{ error: "invalid_body", message: "Send {} or { email }." },
			{ status: 400 },
		);
	const email = parsed.data.email;
	if (email === undefined && actor.kind === "setup")
		return Response.json(
			{
				error: "email_required",
				message: "Say whose sign-in link to make: { email }.",
			},
			{ status: 400 },
		);
	type Target = { id: string; email: string; name: string };
	const [target] =
		email === undefined && actor.kind === "user"
			? await deps.sql<Target[]>`
				SELECT id, email, name FROM "user" WHERE id = ${actor.userId}
			`
			: await deps.sql<Target[]>`
				SELECT id, email, name FROM "user"
				WHERE lower(email) = ${email ?? ""}
				ORDER BY created_at, id
				LIMIT 1
			`;
	if (!target)
		return Response.json(
			{
				error: "user_not_found",
				message: `No account on this server has the email ${email ?? ""}.`,
			},
			{ status: 404 },
		);
	const own = actor.kind === "user" && actor.userId === target.id;
	if (actor.kind === "user" && !own) {
		const [row] = await deps.sql<{ allowed: boolean }[]>`
			SELECT EXISTS (
				SELECT 1
				FROM member actor
				JOIN member target ON target.organization_id = actor.organization_id
				WHERE actor.user_id = ${actor.userId}
					AND target.user_id = ${target.id}
					AND (actor.role = 'owner' OR (actor.role = 'admin' AND target.role <> 'owner'))
			) AS allowed
		`;
		if (row?.allowed !== true)
			return Response.json(
				{
					error: "forbidden",
					message:
						"Only an owner or admin of a workspace this person belongs to can make their sign-in link; admins cannot make one for an owner.",
				},
				{ status: 403 },
			);
	}
	const ttlSeconds = own
		? LOGIN_TOKEN_TTL_SECONDS
		: MEMBER_LOGIN_TOKEN_TTL_SECONDS;
	const token = await issueLoginToken(deps.sql, target.id, ttlSeconds);
	if (!own)
		logger.info(
			"Sign-in link for user {targetUserId} issued by {issuer} ({via}), valid {minutes} minutes",
			{
				targetUserId: target.id,
				issuer: actor.kind === "setup" ? "the setup token" : actor.userId,
				via: actor.kind === "setup" ? "setup token" : actor.via,
				minutes: ttlSeconds / 60,
			},
		);
	return Response.json({
		loginUrl: loginUrl(appUrlOf(deps.env), token),
		expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
		user: { id: target.id, email: target.email, name: target.name },
	});
}

async function githubStatus(
	request: Request,
	deps: SelfHostDependencies,
): Promise<Response> {
	const actor = await loginLinkActor(request, deps);
	if (actor instanceof Response) return actor;
	if (
		actor.kind === "user" &&
		!(await isSelfHostedAdmin(deps.sql, actor.userId))
	)
		return Response.json(
			{
				error: "forbidden",
				message:
					"Only owners and admins of the server's first workspace can read its GitHub status.",
			},
			{ status: 403 },
		);
	return Response.json({
		github: await (deps.readGitHub ?? readGitHubStatus)(deps.sql, deps.env),
	});
}

async function readGitHubStatus(
	sql: postgres.Sql,
	env: Environment,
): Promise<GitHubTokenStatus> {
	const [token, repositories, status] = await Promise.all([
		import("../services/github-token.service.js"),
		import("../services/github-token-repositories.service.js"),
		import("../services/github-repository-evidence-status.service.js"),
	]);
	const [current, collection] = await Promise.all([
		token.readGitHubTokenStatus({ env }),
		repositories.readGitHubTokenCollection(sql, null),
	]);
	return status.toGitHubTokenStatusBody(
		current,
		collection,
		token.readGitHubHistoryDays(env),
	);
}

function sameSecret(given: string, expected: string): boolean {
	const left = Buffer.from(given);
	const right = Buffer.from(expected);
	return left.length === right.length && timingSafeEqual(left, right);
}

async function ingestTimings(
	request: Request,
	deps: SelfHostDependencies,
): Promise<Response> {
	const actor = await loginLinkActor(request, deps);
	if (actor instanceof Response) return actor;
	const { readIngestPhaseTotals, resetIngestPhaseTotals } = await import(
		"../services/ingest-phase-timings.js"
	);
	const phases = readIngestPhaseTotals();
	if (new URL(request.url).searchParams.get("reset") === "1")
		resetIngestPhaseTotals();
	return Response.json({ phases });
}

const NotifyBodySchema = z
	.object({
		paths: z.array(z.string().min(1).max(4_096)).max(256).default([]),
		final: z.boolean().default(false),
	})
	.strict();

async function ingestStatus(
	request: Request,
	deps: SelfHostDependencies,
): Promise<Response> {
	const { getLocalIngest } = await import("../selfhost/local-ingest/index.js");
	const ingest = getLocalIngest();
	if (!ingest) return Response.json({ error: "not_found" }, { status: 404 });
	const actor = await loginLinkActor(request, deps);
	if (actor instanceof Response) return actor;
	return Response.json(ingest.status());
}

async function ingestNotify(
	request: Request,
	deps: SelfHostDependencies,
): Promise<Response> {
	const { getLocalIngest } = await import("../selfhost/local-ingest/index.js");
	const ingest = getLocalIngest();
	if (!ingest) return Response.json({ error: "not_found" }, { status: 404 });
	const actor = await loginLinkActor(request, deps);
	if (actor instanceof Response) return actor;
	const parsed = NotifyBodySchema.safeParse(
		await request.json().catch(() => null),
	);
	if (!parsed.success)
		return Response.json(
			{
				error: "invalid_body",
				message: "Send { paths: string[], final?: boolean }.",
			},
			{ status: 400 },
		);
	const accepted = await ingest.notify(parsed.data.paths, parsed.data.final);
	return Response.json({ accepted }, { status: 202 });
}
