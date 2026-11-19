import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createGhAuthToken,
	describeGitHubTokenStatus,
	forgetGitHubTokenForTests,
	type GhAuthToken,
	gitHubApiBaseUrl,
	inspectGitHubToken,
	isGitHubRepositoryCollectionConfigured,
	isGitHubTokenCredentials,
	readGitHubHost,
	readGitHubRepositoryCredentials,
	readGitHubTokenStatus,
	resolveGitHubToken,
} from "./github-token.service.js";

const TOKEN = "gho_secretvalue0123456789abcdefghij";

afterEach(() => forgetGitHubTokenForTests());

function ghAnswering(
	result: Awaited<ReturnType<GhAuthToken>>,
	calls: string[] = [],
): GhAuthToken {
	return async (host) => {
		calls.push(host);
		return result;
	};
}

function userFetch(
	status: number,
	headers: Record<string, string> = {},
	body: unknown = { login: "octo", id: 42 },
	seen: Request[] = [],
): typeof globalThis.fetch {
	return Object.assign(
		async (url: string | URL | Request, init?: RequestInit) => {
			seen.push(url instanceof Request ? url : new Request(String(url), init));
			return new Response(JSON.stringify(body), { status, headers });
		},
		{ preconnect: globalThis.fetch.preconnect },
	);
}

const RATE = {
	"x-ratelimit-limit": "5000",
	"x-ratelimit-remaining": "4990",
	"x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1800),
};

describe("where the token comes from", () => {
	test("GITHUB_TOKEN, then GH_TOKEN, then the GitHub CLI", async () => {
		const calls: string[] = [];
		const gh = ghAnswering({ status: "ok", token: "from-gh" }, calls);
		expect(
			await resolveGitHubToken(
				{ GITHUB_TOKEN: " env-1 ", GH_TOKEN: "env-2" },
				gh,
			),
		).toEqual({ token: "env-1", source: "GITHUB_TOKEN" });
		expect(await resolveGitHubToken({ GH_TOKEN: "env-2" }, gh)).toEqual({
			token: "env-2",
			source: "GH_TOKEN",
		});
		expect(calls).toEqual([]);
		expect(await resolveGitHubToken({ GITHUB_TOKEN: "  " }, gh)).toEqual({
			token: "from-gh",
			source: "gh",
		});
		expect(calls).toEqual(["github.com"]);
	});

	test("GH_HOST picks the host gh is asked about and the API it talks to", async () => {
		const calls: string[] = [];
		await resolveGitHubToken(
			{ GH_HOST: "https://GitHub.Example.com/" },
			ghAnswering({ status: "signed-out" }, calls),
		);
		expect(calls).toEqual(["github.example.com"]);
		expect(readGitHubHost({})).toBe("github.com");
		expect(readGitHubHost({ GH_HOST: "bad host!" })).toBe("github.com");
		expect(gitHubApiBaseUrl("github.com")).toBe("https://api.github.com");
		expect(gitHubApiBaseUrl("github.example.com")).toBe(
			"https://github.example.com/api/v3",
		);
		expect(gitHubApiBaseUrl("acme.ghe.com")).toBe("https://api.acme.ghe.com");
	});

	test("gh's own answers: a token, signed out, not installed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "opaline-gh-"));
		try {
			const script = (name: string, body: string) => {
				const path = join(dir, name);
				writeFileSync(path, `#!/bin/sh\n${body}\n`);
				chmodSync(path, 0o755);
				return path;
			};
			const signedIn = script(
				"gh-ok",
				'[ "$1 $2 $3 $4" = "auth token --hostname github.com" ] && [ "$GH_PROMPT_DISABLED" = 1 ] && echo "gho_fromscript" && exit 0; exit 3',
			);
			const signedOut = script(
				"gh-out",
				"echo 'no oauth token found for github.com' >&2; exit 1",
			);
			expect(
				await createGhAuthToken([join(dir, "absent"), signedIn])("github.com", {
					PATH: "/usr/bin:/bin",
				}),
			).toEqual({ status: "ok", token: "gho_fromscript" });
			expect(
				await createGhAuthToken([signedOut, signedIn])("github.com", {
					PATH: "/usr/bin:/bin",
				}),
			).toEqual({ status: "signed-out" });
			expect(
				await createGhAuthToken([join(dir, "absent")])("github.com", {
					PATH: "/usr/bin:/bin",
				}),
			).toEqual({ status: "missing" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("who the token belongs to", () => {
	test("GET /user gives the login, the classic scopes and the rate limit", async () => {
		const seen: Request[] = [];
		const result = await inspectGitHubToken({
			token: TOKEN,
			apiBaseUrl: "https://api.github.com",
			fetch: userFetch(
				200,
				{ ...RATE, "x-oauth-scopes": "repo, read:org,  workflow" },
				undefined,
				seen,
			),
		});
		expect(result).toMatchObject({
			status: "ok",
			identity: {
				login: "octo",
				id: "42",
				scopes: ["repo", "read:org", "workflow"],
			},
			rateLimit: { limit: 5000, remaining: 4990 },
		});
		expect(seen[0]?.url).toBe("https://api.github.com/user");
		expect(seen[0]?.method).toBe("GET");
		expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
	});

	test("a fine-grained token has no scopes header; 401 is a rejected token", async () => {
		expect(
			await inspectGitHubToken({
				token: TOKEN,
				apiBaseUrl: "https://api.github.com",
				fetch: userFetch(200, RATE),
			}),
		).toMatchObject({ status: "ok", identity: { scopes: null } });
		expect(
			await inspectGitHubToken({
				token: TOKEN,
				apiBaseUrl: "https://api.github.com",
				fetch: userFetch(401, {}, { message: "Bad credentials" }),
			}),
		).toMatchObject({ status: "rejected" });
		expect(
			await inspectGitHubToken({
				token: TOKEN,
				apiBaseUrl: "https://api.github.com",
				fetch: userFetch(403, { ...RATE, "x-ratelimit-remaining": "0" }, {}),
			}),
		).toMatchObject({
			status: "unreachable",
			detail: expect.stringContaining("rate limited until"),
		});
	});
});

describe("the status shown in settings, the CLI and the log", () => {
	const status = (
		resolution: Awaited<ReturnType<typeof resolveGitHubToken>>,
		fetch = userFetch(200, { ...RATE, "x-oauth-scopes": "repo, workflow" }),
		env: Record<string, string> = {},
	) =>
		readGitHubTokenStatus({
			env,
			fetch,
			resolve: async () => resolution,
			now: () => new Date("2026-11-09T12:00:00Z"),
		});

	test("signed in through gh with the repo scope", async () => {
		const result = await status({ token: TOKEN, source: "gh" });
		expect(result).toMatchObject({
			state: "ready",
			source: "gh",
			host: "github.com",
			login: "octo",
			scopes: ["repo", "workflow"],
			missingScopes: [],
			message: null,
			fix: null,
		});
		expect(describeGitHubTokenStatus(result)).toBe(
			"token from the GitHub CLI (gh) for octo on github.com, scopes repo, workflow",
		);
		expect(JSON.stringify(result)).not.toContain(TOKEN);
	});

	test("without the repo scope the fix depends on where the token comes from", async () => {
		const gh = await status(
			{ token: TOKEN, source: "gh" },
			userFetch(200, { ...RATE, "x-oauth-scopes": "read:org" }),
		);
		expect(gh).toMatchObject({
			state: "ready",
			missingScopes: ["repo"],
			fix: "gh auth refresh --scopes repo",
		});
		forgetGitHubTokenForTests();
		const env = await status(
			{ token: TOKEN, source: "GITHUB_TOKEN" },
			userFetch(200, { ...RATE, "x-oauth-scopes": "read:org" }),
		);
		expect(env).toMatchObject({ missingScopes: ["repo"], fix: null });
		expect(env.message).toContain("no repo scope");
	});

	test("no token at all names the command that fixes it", async () => {
		expect(await status({ problem: "gh-signed-out" })).toMatchObject({
			state: "missing",
			source: null,
			login: null,
			fix: "gh auth login --scopes repo",
			message:
				"No GitHub token: GITHUB_TOKEN and GH_TOKEN are not set, and the GitHub CLI is not signed in to github.com.",
		});
		expect(
			await status({ problem: "gh-missing" }, undefined, {
				GH_HOST: "github.example.com",
			}),
		).toMatchObject({
			state: "missing",
			fix: "gh auth login --hostname github.example.com --scopes repo",
		});
		expect(await status({ problem: "gh-failed" })).toMatchObject({
			fix: "gh auth status",
		});
	});

	test("a rejected token", async () => {
		const result = await status(
			{ token: TOKEN, source: "GH_TOKEN" },
			userFetch(401, {}, {}),
		);
		expect(result).toMatchObject({ state: "rejected", fix: null });
		expect(result.message).toBe(
			"GitHub rejected the token in GH_TOKEN. Replace it with a valid token that has the repo scope and restart the server.",
		);
		expect(JSON.stringify(result)).not.toContain(TOKEN);
	});
});

describe("which credentials the collectors use", () => {
	test("production keeps the GitHub App; a self-hosted server reads the token", async () => {
		expect(await readGitHubRepositoryCredentials({})).toBeNull();
		expect(isGitHubRepositoryCollectionConfigured({})).toBe(false);
		expect(
			isGitHubRepositoryCollectionConfigured({ OPALINE_SELF_HOSTED: "1" }),
		).toBe(true);
		const credentials = await readGitHubRepositoryCredentials({
			OPALINE_SELF_HOSTED: "1",
			GITHUB_TOKEN: "env-token",
		});
		expect(credentials && isGitHubTokenCredentials(credentials)).toBe(true);
		if (!credentials || !isGitHubTokenCredentials(credentials))
			throw new Error("expected token credentials");
		expect(credentials.apiBaseUrl).toBe("https://api.github.com");
		expect(await credentials.read()).toBe("env-token");
		await expect(
			readGitHubRepositoryCredentials({ GITHUB_REPOSITORY_APP_ID: "x" }),
		).rejects.toThrow(
			"GITHUB_REPOSITORY_APP_ID must be a positive integer string",
		);
	});
});
