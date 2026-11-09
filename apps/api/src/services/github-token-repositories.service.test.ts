import { afterEach, describe, expect, test } from "bun:test";
import type postgres from "postgres";
import {
	bindGitHubTokenRepositories,
	forgetGitHubTokenDiscoveryForTests,
	gitHubRepositoryFromRemote,
	listSessionRepositories,
	readGitHubTokenCollection,
	tokenInstallationId,
} from "./github-token-repositories.service.js";

const TOKEN = "gho_secretvalue0123456789abcdefghij";
const NOW = new Date("2026-11-09T12:00:00.000Z");
const ACCOUNT = { login: "octo", id: "42" };

afterEach(() => forgetGitHubTokenDiscoveryForTests());

function fakeDatabase(
	options: {
		organizations?: string[];
		bound?: Array<{ organization_id: string; name: string }>;
		unavailable?: Array<{ organization_id: string; repository_id: string }>;
	} = {},
) {
	const queries: Array<{ query: string; params: unknown[] }> = [];
	const unsafe = async (query: string, params: unknown[] = []) => {
		const text = query.replace(/\s+/gu, " ").trim();
		queries.push({ query: text, params });
		if (text.startsWith("SELECT id FROM organization"))
			return (options.organizations ?? []).map((id) => ({ id }));
		if (
			text.startsWith(
				"SELECT binding.organization_id, lower(binding.full_name)",
			)
		)
			return options.bound ?? [];
		if (text.startsWith("SELECT DISTINCT binding.organization_id"))
			return options.unavailable ?? [];
		return [];
	};
	const database = {
		unsafe,
		begin: async (work: (transaction: unknown) => Promise<unknown>) =>
			work({ unsafe }),
	} as unknown as postgres.Sql;
	return { database, queries };
}

function gitHub(
	answers: Record<
		string,
		{ status: number; body?: unknown; headers?: Record<string, string> }
	>,
	seen: string[] = [],
): typeof globalThis.fetch {
	return Object.assign(
		async (url: string | URL | Request, init?: RequestInit) => {
			const request =
				url instanceof Request ? url : new Request(String(url), init);
			const path = new URL(request.url).pathname;
			seen.push(
				`${request.method} ${path} ${request.headers.get("authorization")}`,
			);
			const answer = answers[path] ?? { status: 404, body: {} };
			return new Response(JSON.stringify(answer.body ?? {}), {
				status: answer.status,
				headers: answer.headers,
			});
		},
		{ preconnect: globalThis.fetch.preconnect },
	);
}

const repository = (id: number, fullName: string, isPrivate = true) => ({
	status: 200,
	body: {
		id,
		node_id: `R_${id}`,
		name: fullName.split("/")[1],
		full_name: fullName,
		owner: { login: fullName.split("/")[0] },
		private: isPrivate,
		default_branch: "main",
	},
});

describe("the GitHub repository a session's remote names", () => {
	test("https, ssh and scp remotes on the host, with or without .git", () => {
		for (const remote of [
			"https://github.com/opalinehq/athena.git",
			"https://user@github.com/opalinehq/athena",
			"http://github.com/opalinehq/athena/",
			"ssh://git@github.com:22/opalinehq/athena.git",
			"git://github.com/opalinehq/athena",
			"git@github.com:opalinehq/athena.git",
			"github.com/opalinehq/athena",
			"github.com:opalinehq/athena",
			"GitHub.com/opalinehq/athena",
		])
			expect(gitHubRepositoryFromRemote(remote, "github.com")).toBe(
				"opalinehq/athena",
			);
		expect(
			gitHubRepositoryFromRemote(
				"git@github.example.com:team/app.git",
				"github.example.com",
			),
		).toBe("team/app");
	});

	test("other hosts, bare names and paths are not GitHub repositories", () => {
		for (const remote of [
			"https://gitlab.com/opalinehq/athena.git",
			"git@github.example.com:team/app.git",
			"opalinehq/athena",
			"/Users/me/code/athena",
			"https://github.com/opalinehq",
			"https://github.com/opalinehq/athena/tree/main",
			"https://github.com.evil.example/opalinehq/athena",
			"https://github.com/opalinehq/..",
		])
			expect(gitHubRepositoryFromRemote(remote, "github.com")).toBeNull();
	});

	test("listing reads distinct workspace remotes and keeps one entry per repository", async () => {
		const statements: string[] = [];
		const repositories = await listSessionRepositories(
			"github.com",
			async <T>(statement: { query: string }) => {
				statements.push(statement.query);
				return [
					{
						organization_id: "org-1",
						git_remote: "https://github.com/a/b.git",
					},
					{ organization_id: "org-1", git_remote: "git@github.com:A/B.git" },
					{ organization_id: "org-1", git_remote: "/tmp/project" },
					{ organization_id: "org-2", git_remote: "github.com/a/b" },
				] as T[];
			},
		);
		expect(repositories).toEqual([
			{ organizationId: "org-1", fullName: "a/b" },
			{ organizationId: "org-2", fullName: "a/b" },
		]);
		expect(statements[0]).toContain("FROM rudel.session_analytics");
	});
});

describe("binding what the token can read", () => {
	test("a readable repository gets a token installation, a binding and a sweep; an unreadable one is remembered", async () => {
		const { database, queries } = fakeDatabase({ organizations: ["org-1"] });
		const seen: string[] = [];
		const result = await bindGitHubTokenRepositories({
			database,
			repositories: [
				{ organizationId: "org-1", fullName: "opalinehq/athena" },
				{ organizationId: "org-1", fullName: "someone/private" },
				{ organizationId: "gone", fullName: "opalinehq/cli" },
			],
			token: TOKEN,
			apiBaseUrl: "https://api.github.com",
			account: ACCOUNT,
			historyDays: 7,
			fetch: gitHub(
				{ "/repos/opalinehq/athena": repository(101, "opalinehq/athena") },
				seen,
			),
			now: () => NOW,
		});
		expect(result).toEqual({
			bound: ["opalinehq/athena"],
			unreadable: ["someone/private"],
			reopened: 0,
			stopped: null,
		});
		expect(seen).toEqual([
			`GET /repos/opalinehq/athena Bearer ${TOKEN}`,
			`GET /repos/someone/private Bearer ${TOKEN}`,
		]);
		const installation = queries.find((entry) =>
			entry.query.startsWith("INSERT INTO github_app_installation"),
		);
		expect(installation?.params).toEqual([
			tokenInstallationId("org-1"),
			"org-1",
			"42",
			"octo",
			NOW.toISOString(),
		]);
		const binding = queries.find((entry) =>
			entry.query.startsWith("INSERT INTO github_repository_binding"),
		);
		expect(binding?.params).toEqual([
			"org-1",
			"101",
			"token:org-1",
			"R_101",
			"opalinehq",
			"athena",
			"opalinehq/athena",
			"main",
			true,
			NOW.toISOString(),
		]);
		const windows = queries.filter((entry) =>
			entry.query.startsWith("INSERT INTO github_repository_sweep"),
		);
		expect(windows.map((entry) => entry.params[2])).toContain("pulls");
		expect(
			windows.find((entry) => entry.params[2] === "pulls")?.params[3],
		).toBe("2026-11-02T12:00:00.000Z");
		expect(
			queries.some((entry) => entry.query.includes("l1_edge_scope_dependency")),
		).toBe(true);
		expect(JSON.stringify(queries)).not.toContain(TOKEN);

		seen.length = 0;
		const again = await bindGitHubTokenRepositories({
			database,
			repositories: [{ organizationId: "org-1", fullName: "someone/private" }],
			token: TOKEN,
			apiBaseUrl: "https://api.github.com",
			account: ACCOUNT,
			historyDays: 7,
			fetch: gitHub({}, seen),
			now: () => new Date(NOW.getTime() + 60_000),
		});
		expect(again.unreadable).toEqual(["someone/private"]);
		expect(seen).toEqual([]);
		expect(
			(await readGitHubTokenCollection(database, "org-1", NOW)).unreadable,
		).toEqual(["someone/private"]);
	});

	test("repositories already bound are not asked about; a rejected token or the rate limit stops the pass", async () => {
		const { database } = fakeDatabase({
			organizations: ["org-1"],
			bound: [{ organization_id: "org-1", name: "opalinehq/athena" }],
		});
		const seen: string[] = [];
		const rejected = await bindGitHubTokenRepositories({
			database,
			repositories: [
				{ organizationId: "org-1", fullName: "OpalineHQ/Athena" },
				{ organizationId: "org-1", fullName: "opalinehq/cli" },
				{ organizationId: "org-1", fullName: "opalinehq/web" },
			],
			token: TOKEN,
			apiBaseUrl: "https://api.github.com",
			account: ACCOUNT,
			historyDays: 7,
			fetch: gitHub({ "/repos/opalinehq/cli": { status: 401 } }, seen),
			now: () => NOW,
		});
		expect(rejected).toMatchObject({ bound: [], stopped: "rejected" });
		expect(seen).toEqual([`GET /repos/opalinehq/cli Bearer ${TOKEN}`]);

		const limited = await bindGitHubTokenRepositories({
			database,
			repositories: [{ organizationId: "org-1", fullName: "opalinehq/cli" }],
			token: TOKEN,
			apiBaseUrl: "https://api.github.com",
			account: ACCOUNT,
			historyDays: 7,
			fetch: gitHub({
				"/repos/opalinehq/cli": {
					status: 403,
					headers: { "x-ratelimit-remaining": "0" },
				},
			}),
			now: () => NOW,
		});
		expect(limited.stopped).toBe("rate-limited");
		expect(limited.unreadable).toEqual([]);
	});

	test("a repository the sweep found unavailable is swept again once the token can read it", async () => {
		const { database, queries } = fakeDatabase({
			unavailable: [{ organization_id: "org-1", repository_id: "101" }],
		});
		const result = await bindGitHubTokenRepositories({
			database,
			repositories: [],
			token: TOKEN,
			apiBaseUrl: "https://github.example.com/api/v3",
			account: ACCOUNT,
			historyDays: 90,
			fetch: gitHub({
				"/api/v3/repositories/101": repository(101, "opalinehq/athena"),
			}),
			now: () => NOW,
		});
		expect(result.reopened).toBe(1);
		expect(
			queries.some((entry) =>
				entry.query.startsWith(
					"UPDATE github_repository_sweep SET status = 'pending'",
				),
			),
		).toBe(true);
	});
});
