import { describe, expect, test } from "bun:test";
import {
	describeGitHubStatus,
	fetchSelfHostGitHubStatus,
	readGitHubStatusLines,
	type SelfHostGitHubStatus,
} from "../src/github-status.js";

const READY: SelfHostGitHubStatus = {
	state: "ready",
	source: "gh",
	host: "github.com",
	login: "octo",
	scopes: ["repo", "workflow"],
	missingScopes: [],
	message: null,
	fix: null,
	repositories: 2,
	unreadableRepositories: [],
	pausedUntil: null,
};

function answering(status: number, body: unknown, seen: Request[] = []) {
	return (async (url: string | URL | Request, init?: RequestInit) => {
		seen.push(new Request(url, init));
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
}

describe("the GitHub line of opaline server start and status", () => {
	test("asks the local server with the setup token", async () => {
		const seen: Request[] = [];
		const status = await fetchSelfHostGitHubStatus(
			"http://127.0.0.1:4820/",
			"setup-token",
			answering(200, { github: { ...READY, checkedAt: "x", extra: 1 } }, seen),
		);
		expect(status).toEqual(READY);
		expect(seen[0]?.url).toBe("http://127.0.0.1:4820/api/selfhost/github");
		expect(seen[0]?.headers.get("x-opaline-setup-token")).toBe("setup-token");
		expect(
			await fetchSelfHostGitHubStatus(
				"http://127.0.0.1:4820",
				"setup-token",
				answering(404, { error: "not_found" }),
			),
		).toBeNull();
	});

	test("signed in via gh, with what it cannot read and the rate limit", () => {
		expect(describeGitHubStatus(READY, "/data")).toEqual([
			"  GitHub      signed in via gh as octo on github.com (scopes repo, workflow); 2 repositories collected",
		]);
		expect(
			describeGitHubStatus(
				{
					...READY,
					source: "GITHUB_TOKEN",
					scopes: ["read:org"],
					missingScopes: ["repo"],
					message:
						"The token has no repo scope, so private repositories and their CI logs cannot be read.",
					repositories: 1,
					unreadableRepositories: ["a/1", "a/2", "a/3", "a/4", "a/5", "a/6"],
					pausedUntil: "2026-11-09T13:00:00.000Z",
				},
				"/data",
			),
		).toEqual([
			"  GitHub      token from GITHUB_TOKEN for octo on github.com (scopes read:org); 1 repository collected",
			"              The token has no repo scope, so private repositories and their CI logs cannot be read.",
			"              Not readable with this token: a/1, a/2, a/3, a/4, a/5 and 1 more",
			"              Waiting for the GitHub rate limit until 2026-11-09T13:00:00.000Z",
		]);
	});

	test("not signed in names the command and the server.env alternative", () => {
		expect(
			describeGitHubStatus(
				{
					...READY,
					state: "missing",
					source: null,
					login: null,
					scopes: null,
					repositories: 0,
					message:
						"No GitHub token: GITHUB_TOKEN and GH_TOKEN are not set, and the GitHub CLI is not signed in to github.com.",
					fix: "gh auth login --scopes repo",
				},
				"/home/me/.opaline/server",
			),
		).toEqual([
			"  GitHub      not signed in: No GitHub token: GITHUB_TOKEN and GH_TOKEN are not set, and the GitHub CLI is not signed in to github.com.",
			"              Fix: gh auth login --scopes repo where the server runs (no restart needed),",
			"              or put GITHUB_TOKEN=<token> in /home/me/.opaline/server/server.env and run `opaline server stop && opaline server`.",
		]);
		expect(describeGitHubStatus(null, "/data")).toEqual([
			"  GitHub      this server version does not report its GitHub status",
		]);
	});

	test("a failing request becomes one line instead of an error", async () => {
		expect(
			await readGitHubStatusLines(
				"http://127.0.0.1:4820",
				"setup-token",
				"/data",
				answering(500, {}),
			),
		).toEqual([
			"  GitHub      status unavailable (the server answered HTTP 500)",
		]);
	});
});
