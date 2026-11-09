import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import { apiKeyFromHeaders, apiKeyUserId } from "../selfhost/api-key-auth.js";
import {
	consumeLoginToken,
	issueLoginToken,
	loginUrl,
} from "../selfhost/login-tokens.js";
import {
	handleSelfHostRoute,
	type SelfHostAuth,
	type SelfHostDependencies,
	workspaceSlug,
} from "./selfhost-http.js";

type Answer = (query: string, values: unknown[]) => unknown[];

function fakeSql(answer: Answer) {
	const queries: { query: string; values: unknown[] }[] = [];
	const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
		const query = strings.join("?").replace(/\s+/gu, " ").trim();
		queries.push({ query, values });
		return Promise.resolve(answer(query, values));
	}) as unknown as postgres.Sql;
	return { sql, queries };
}

const ENV = {
	OPALINE_SELF_HOSTED: "1",
	APP_URL: "http://localhost:4100",
	OPALINE_SETUP_TOKEN: "setup-token-0123456789",
};

function fakeAuth(overrides: Partial<SelfHostAuth["api"]> = {}) {
	const calls: string[] = [];
	const auth: SelfHostAuth = {
		api: {
			verifyApiKey: async ({ body }) =>
				body.key === "good-key"
					? { valid: true, key: { referenceId: "user-1" } }
					: { valid: false, key: null },
			signUpEmail: async ({ body }) => {
				calls.push(`signUp ${body.email} ${body.name} ${body.password.length}`);
				return { user: { id: "user-1" } };
			},
			createApiKey: async ({ body }) => {
				calls.push(`apiKey ${body.userId} ${body.name} ${body.expiresIn}`);
				return { id: "key-id", key: "secret-key" };
			},
			getSession: async ({ headers }) =>
				headers.get("cookie")?.includes("better-auth.session_token=admin")
					? { user: { id: "user-2" } }
					: null,
			...overrides,
		},
		handler: async (request) => {
			calls.push(
				`auth ${new URL(request.url).pathname}${new URL(request.url).search}`,
			);
			return new Response(null, { status: 302, headers: { Location: "/" } });
		},
	};
	return { auth, calls };
}

function deps(
	answer: Answer,
	env: Record<string, string | undefined> = ENV,
	auth = fakeAuth(),
): {
	deps: SelfHostDependencies;
	queries: ReturnType<typeof fakeSql>["queries"];
	calls: string[];
} {
	const { sql, queries } = fakeSql(answer);
	return {
		deps: { auth: auth.auth, sql, env, socialProviders: ["github"] },
		queries,
		calls: auth.calls,
	};
}

const call = (
	d: SelfHostDependencies,
	method: string,
	path: string,
	init: RequestInit = {},
) => {
	const url = new URL(`http://localhost:4100${path}`);
	return handleSelfHostRoute(
		new Request(url.toString(), { method, ...init }),
		url,
		d,
	);
};

describe("self-hosted HTTP routes", () => {
	test("do not exist unless the server is self-hosted", () => {
		const off = deps(
			() => {
				throw new Error("Postgres reached");
			},
			{ APP_URL: "https://opaline.so" },
		);
		for (const path of [
			"/api/selfhost/info",
			"/api/selfhost/setup",
			"/api/selfhost/login",
		])
			expect(call(off.deps, "GET", path)).toBeNull();
		const on = deps(() => []);
		expect(call(on.deps, "GET", "/api/other")).toBeNull();
	});

	test("info says what the server offers", async () => {
		const d = deps(() => [{ users: false }], {
			...ENV,
			RESEND_API_KEY: "re_1",
			OPALINE_VERSION: "1.2.3",
		});
		const response = await call(d.deps, "GET", "/api/selfhost/info");
		expect(await response?.json()).toEqual({
			selfHosted: true,
			version: "1.2.3",
			appUrl: "http://localhost:4100",
			mcpUrl: "http://localhost:4100/api/mcp",
			setupComplete: false,
			auth: {
				password: true,
				emailCodes: true,
				social: ["github"],
				openSignup: false,
			},
		});
		expect(
			(await (
				await call(
					deps(() => [{ users: true }]).deps,
					"GET",
					"/api/selfhost/info",
				)
			)?.json()) as object,
		).toMatchObject({
			setupComplete: true,
			version: "dev",
			auth: { emailCodes: false, openSignup: false },
		});
		expect(
			(await (
				await call(
					deps(() => [{ users: true }], { ...ENV, OPALINE_OPEN_SIGNUP: "1" })
						.deps,
					"GET",
					"/api/selfhost/info",
				)
			)?.json()) as object,
		).toMatchObject({ auth: { openSignup: true } });
		expect((await call(d.deps, "GET", "/api/selfhost/nope"))?.status).toBe(404);
	});

	test("setup needs the setup token and a valid body", async () => {
		const unreachable = () => {
			throw new Error("Postgres reached");
		};
		const body = JSON.stringify({
			email: "Owner@Example.com",
			name: "Owner",
			workspaceName: "Acme Team",
		});
		const disabled = deps(unreachable, { OPALINE_SELF_HOSTED: "1" });
		expect(
			(await call(disabled.deps, "POST", "/api/selfhost/setup", { body }))
				?.status,
		).toBe(403);
		const d = deps(unreachable);
		expect(
			(
				await call(d.deps, "POST", "/api/selfhost/setup", {
					body,
					headers: { "X-Opaline-Setup-Token": "setup-token-012345678X" },
				})
			)?.status,
		).toBe(401);
		const invalid = await call(d.deps, "POST", "/api/selfhost/setup", {
			body: JSON.stringify({ email: "nope" }),
			headers: { "X-Opaline-Setup-Token": ENV.OPALINE_SETUP_TOKEN },
		});
		expect(invalid?.status).toBe(400);
		expect(d.calls).toEqual([]);
	});

	test("setup creates the first user, names the workspace and returns a key and a login link", async () => {
		const d = deps((query) => {
			if (query.includes('count(*)::int FROM "user"'))
				return [{ users: 0, existing: null }];
			if (query.startsWith("SELECT o.id, o.slug FROM organization"))
				return [{ id: "user-1", slug: "owner-user1" }];
			if (query.startsWith('SELECT id, email, name FROM "user"'))
				return [{ id: "user-1", email: "owner@example.com", name: "Owner" }];
			if (query.startsWith("SELECT o.id, o.slug, o.name FROM organization"))
				return [{ id: "user-1", slug: "acme-team", name: "Acme Team" }];
			return [];
		});
		const response = await call(d.deps, "POST", "/api/selfhost/setup", {
			body: JSON.stringify({
				email: "Owner@Example.com",
				name: "Owner",
				workspaceName: "Acme Team",
			}),
			headers: { "X-Opaline-Setup-Token": ENV.OPALINE_SETUP_TOKEN },
		});
		const json = (await response?.json()) as Record<string, unknown>;
		expect(json).toMatchObject({
			user: { id: "user-1", email: "owner@example.com", name: "Owner" },
			organization: { id: "user-1", slug: "acme-team", name: "Acme Team" },
			apiKey: "secret-key",
			apiKeyId: "key-id",
		});
		expect(json.loginUrl).toMatch(
			/^http:\/\/localhost:4100\/api\/selfhost\/login\?token=[A-Za-z0-9_-]{43}$/u,
		);
		expect(d.calls).toEqual([
			"signUp owner@example.com Owner 32",
			"apiKey user-1 rudel-cli-ingest null",
		]);
		const statements = d.queries.map((entry) => entry.query);
		expect(statements).toContainEqual(
			expect.stringContaining('UPDATE "user" SET email_verified = true'),
		);
		expect(
			d.queries.find((entry) => entry.query.startsWith("UPDATE organization"))
				?.values,
		).toEqual(["Acme Team", "acme-team", "user-1", "acme-team", "user-1"]);
		expect(statements).toContainEqual(
			expect.stringContaining("INSERT INTO verification"),
		);
	});

	test("setup again with the same email returns a fresh key; another email is refused", async () => {
		const again = deps((query) => {
			if (query.includes('count(*)::int FROM "user"'))
				return [{ users: 1, existing: "user-1" }];
			if (query.startsWith('SELECT id, email, name FROM "user"'))
				return [{ id: "user-1", email: "owner@example.com", name: "Owner" }];
			if (query.startsWith("SELECT o.id, o.slug, o.name FROM organization"))
				return [{ id: "user-1", slug: "acme-team", name: "Acme Team" }];
			return [];
		});
		const body = JSON.stringify({
			email: "owner@example.com",
			name: "Owner",
			workspaceName: "Other",
		});
		const headers = { "X-Opaline-Setup-Token": ENV.OPALINE_SETUP_TOKEN };
		expect(
			(await call(again.deps, "POST", "/api/selfhost/setup", { body, headers }))
				?.status,
		).toBe(200);
		expect(again.calls).toEqual(["apiKey user-1 rudel-cli-ingest null"]);

		const taken = deps((query) =>
			query.includes('count(*)::int FROM "user"')
				? [{ users: 1, existing: null }]
				: [],
		);
		const refused = await call(taken.deps, "POST", "/api/selfhost/setup", {
			body,
			headers,
		});
		expect(refused?.status).toBe(409);
		expect(taken.calls).toEqual([]);
	});

	test("a login link needs a valid API key; the login itself is handed to Better Auth", async () => {
		const d = deps((query) =>
			query.startsWith('SELECT id, email, name FROM "user" WHERE id')
				? [{ id: "user-1", email: "owner@example.com", name: "Owner" }]
				: [],
		);
		expect(
			(
				await call(d.deps, "POST", "/api/selfhost/login-link", {
					headers: { Authorization: "Bearer bad-key" },
				})
			)?.status,
		).toBe(401);
		expect(
			(await call(d.deps, "POST", "/api/selfhost/login-link"))?.status,
		).toBe(401);
		const link = await call(d.deps, "POST", "/api/selfhost/login-link", {
			headers: { "x-api-key": "good-key" },
		});
		const json = (await link?.json()) as {
			loginUrl: string;
			expiresAt: string;
			user: unknown;
		};
		expect(json.loginUrl).toStartWith(
			"http://localhost:4100/api/selfhost/login?token=",
		);
		expect(json.user).toEqual({
			id: "user-1",
			email: "owner@example.com",
			name: "Owner",
		});
		expect(Date.parse(json.expiresAt) - Date.now()).toBeWithin(
			590_000,
			601_000,
		);
		expect(
			d.queries.find((entry) =>
				entry.query.startsWith("INSERT INTO verification"),
			)?.values[3],
		).toBe(600);
		await call(d.deps, "GET", "/api/selfhost/login?token=abc");
		expect(d.calls).toEqual(["auth /api/auth/selfhost/login?token=abc"]);
	});

	const MEMBER = { id: "user-3", email: "bob@example.com", name: "Bob" };
	const memberLookup =
		(allowed: boolean): Answer =>
		(query, values) => {
			if (
				query.startsWith(
					'SELECT id, email, name FROM "user" WHERE lower(email)',
				)
			)
				return values[0] === MEMBER.email ? [MEMBER] : [];
			if (query.startsWith("SELECT EXISTS ( SELECT 1 FROM member actor"))
				return [{ allowed }];
			return [];
		};
	const memberLink = (
		d: SelfHostDependencies,
		headers: Record<string, string>,
		body: unknown,
	) =>
		call(d, "POST", "/api/selfhost/login-link", {
			headers,
			body: JSON.stringify(body),
		});

	test("the setup token makes an hour-long sign-in link for anyone, by email", async () => {
		const d = deps(memberLookup(false));
		const headers = { "X-Opaline-Setup-Token": ENV.OPALINE_SETUP_TOKEN };
		const response = await memberLink(d.deps, headers, {
			email: " Bob@Example.com ",
		});
		expect(response?.status).toBe(200);
		const json = (await response?.json()) as {
			user: unknown;
			expiresAt: string;
		};
		expect(json.user).toEqual(MEMBER);
		expect(Date.parse(json.expiresAt) - Date.now()).toBeWithin(
			3_590_000,
			3_601_000,
		);
		const insert = d.queries.find((entry) =>
			entry.query.startsWith("INSERT INTO verification"),
		);
		expect(insert?.values.slice(2)).toEqual(["user-3", 3600]);
		expect(
			d.queries.some((entry) => entry.query.includes("FROM member actor")),
		).toBe(false);

		expect((await memberLink(d.deps, headers, {}))?.status).toBe(400);
		expect(
			(await memberLink(d.deps, headers, { email: "nobody@example.com" }))
				?.status,
		).toBe(404);
		expect(
			(
				await memberLink(
					d.deps,
					{ "X-Opaline-Setup-Token": "setup-token-012345678X" },
					{ email: MEMBER.email },
				)
			)?.status,
		).toBe(401);
		expect(
			(await memberLink(d.deps, headers, { email: "not an email" }))?.status,
		).toBe(400);
	});

	test("an owner or admin makes a member's link with an API key or the browser session; others are refused", async () => {
		const allowed = deps(memberLookup(true));
		const byKey = await memberLink(
			allowed.deps,
			{ "x-api-key": "good-key" },
			{ email: MEMBER.email },
		);
		expect(byKey?.status).toBe(200);
		const check = allowed.queries.find((entry) =>
			entry.query.includes("FROM member actor"),
		);
		expect(check?.values).toEqual(["user-1", "user-3"]);
		expect(check?.query).toContain(
			"actor.role = 'owner' OR (actor.role = 'admin' AND target.role <> 'owner')",
		);
		const bySession = await memberLink(
			allowed.deps,
			{ cookie: "better-auth.session_token=admin.sig" },
			{ email: MEMBER.email },
		);
		expect(bySession?.status).toBe(200);
		expect(
			allowed.queries.filter((entry) =>
				entry.query.includes("FROM member actor"),
			)[1]?.values,
		).toEqual(["user-2", "user-3"]);

		const refused = deps(memberLookup(false));
		const response = await memberLink(
			refused.deps,
			{ "x-api-key": "good-key" },
			{ email: MEMBER.email },
		);
		expect(response?.status).toBe(403);
		expect(((await response?.json()) as { error: string }).error).toBe(
			"forbidden",
		);
		expect(
			refused.queries.some((entry) =>
				entry.query.startsWith("INSERT INTO verification"),
			),
		).toBe(false);
	});

	test("asking for your own email with an API key is your own ten-minute link", async () => {
		const d = deps((query, values) =>
			query.startsWith(
				'SELECT id, email, name FROM "user" WHERE lower(email)',
			) && values[0] === "owner@example.com"
				? [{ id: "user-1", email: "owner@example.com", name: "Owner" }]
				: [],
		);
		const response = await memberLink(
			d.deps,
			{ "x-api-key": "good-key" },
			{ email: "owner@example.com" },
		);
		expect(response?.status).toBe(200);
		expect(
			d.queries.some((entry) => entry.query.includes("FROM member actor")),
		).toBe(false);
		expect(
			d.queries.find((entry) =>
				entry.query.startsWith("INSERT INTO verification"),
			)?.values[3],
		).toBe(600);
	});
});

describe("GitHub status for the CLI", () => {
	const GITHUB = {
		state: "ready" as const,
		source: "gh" as const,
		host: "github.com",
		login: "octo",
		scopes: ["repo"],
		missingScopes: [],
		rateLimit: null,
		message: null,
		fix: null,
		checkedAt: "2026-11-09T12:00:00.000Z",
		repositories: 2,
		unreadableRepositories: [],
		lastSweepAt: null,
		pausedUntil: null,
		historyDays: 90,
	};
	const withGitHub = (admin: boolean) => {
		const d = deps((query) =>
			query.includes("FROM member m") ? [{ admin }] : [],
		);
		return { ...d, deps: { ...d.deps, readGitHub: async () => GITHUB } };
	};

	test("the setup token or a server admin's API key reads it; anyone else is refused", async () => {
		const admin = withGitHub(true);
		const bySetup = await call(admin.deps, "GET", "/api/selfhost/github", {
			headers: { "X-Opaline-Setup-Token": ENV.OPALINE_SETUP_TOKEN },
		});
		expect(bySetup?.status).toBe(200);
		expect(await bySetup?.json()).toEqual({ github: GITHUB });
		const byKey = await call(admin.deps, "GET", "/api/selfhost/github", {
			headers: { "x-api-key": "good-key" },
		});
		expect(byKey?.status).toBe(200);

		const member = withGitHub(false);
		const refused = await call(member.deps, "GET", "/api/selfhost/github", {
			headers: { "x-api-key": "good-key" },
		});
		expect(refused?.status).toBe(403);
		expect(
			(await call(member.deps, "GET", "/api/selfhost/github"))?.status,
		).toBe(401);
		expect(
			(
				await call(member.deps, "GET", "/api/selfhost/github", {
					headers: { "X-Opaline-Setup-Token": "wrong-token-0123456789" },
				})
			)?.status,
		).toBe(401);
	});
});

describe("helpers", () => {
	test("workspace slugs are DNS labels, with the old slug when nothing usable is left", () => {
		expect(workspaceSlug("Acme Team", "fallback")).toBe("acme-team");
		expect(workspaceSlug("  Café / R&D  ", "fallback")).toBe("cafe-r-d");
		expect(workspaceSlug("!!!", "fallback")).toBe("fallback");
		expect(workspaceSlug("x".repeat(80), "fallback")).toHaveLength(48);
	});

	test("the API key comes from x-api-key first, then a Bearer token", () => {
		expect(apiKeyFromHeaders(new Headers({ "x-api-key": " k1 " }))).toBe("k1");
		expect(
			apiKeyFromHeaders(
				new Headers({ "x-api-key": "k1", Authorization: "Bearer k2" }),
			),
		).toBe("k1");
		expect(apiKeyFromHeaders(new Headers({ Authorization: "bearer k2" }))).toBe(
			"k2",
		);
		expect(
			apiKeyFromHeaders(new Headers({ Authorization: "Basic k2" })),
		).toBeNull();
		expect(apiKeyFromHeaders(new Headers())).toBeNull();
	});

	test("an API key names its user only when it verifies with ingest permission", async () => {
		const seen: unknown[] = [];
		const api = {
			verifyApiKey: async (input: { body: unknown }) => {
				seen.push(input.body);
				return { valid: true, key: { referenceId: "user-1" } };
			},
		};
		expect(await apiKeyUserId(api, "k")).toBe("user-1");
		expect(seen).toEqual([{ key: "k", permissions: { ingest: ["write"] } }]);
		expect(await apiKeyUserId(api, null)).toBeNull();
		expect(
			await apiKeyUserId(
				{
					verifyApiKey: async () => {
						throw new Error("rate limited");
					},
				},
				"k",
			),
		).toBeNull();
	});

	test("login tokens are stored hashed, used once and rejected when malformed", async () => {
		const issued = fakeSql(() => []);
		const token = await issueLoginToken(issued.sql, "user-1");
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
		const stored = issued.queries[0]?.values ?? [];
		expect(stored[1]).toMatch(/^selfhost-login:[0-9a-f]{64}$/u);
		expect(stored).not.toContain(token);
		expect(stored[2]).toBe("user-1");

		const live = fakeSql(() => [{ value: "user-1", live: true }]);
		expect(await consumeLoginToken(live.sql, token)).toBe("user-1");
		expect(live.queries[0]?.query).toStartWith("DELETE FROM verification");
		expect(live.queries[0]?.values).toEqual([stored[1]]);
		expect(
			await consumeLoginToken(
				fakeSql(() => [{ value: "user-1", live: false }]).sql,
				token,
			),
		).toBeNull();
		expect(await consumeLoginToken(fakeSql(() => []).sql, token)).toBeNull();
		const malformed = fakeSql(() => []);
		expect(await consumeLoginToken(malformed.sql, "x' OR 1=1")).toBeNull();
		expect(malformed.queries).toEqual([]);
		expect(loginUrl("http://nas.local:4100/", "t")).toBe(
			"http://nas.local:4100/api/selfhost/login?token=t",
		);
	});
});
