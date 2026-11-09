import { expect, test } from "bun:test";
import type {
	GitHubRepositoryConnectionStatus,
	GitHubTokenStatus,
} from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { GitHubRepositoryList } from "@/features/settings/github/GitHubRepositoryList";
import { GitHubTokenCard } from "./GitHubTokenCard";

const READY: GitHubTokenStatus = {
	state: "ready",
	source: "gh",
	host: "github.com",
	login: "octo",
	scopes: ["gist", "repo", "workflow"],
	missingScopes: [],
	rateLimit: {
		limit: 5000,
		remaining: 4100,
		resetAt: "2026-11-09T13:00:00.000Z",
	},
	message: null,
	fix: null,
	checkedAt: "2026-11-09T12:00:00.000Z",
	repositories: 2,
	unreadableRepositories: ["someone/private"],
	lastSweepAt: "2026-11-09T11:59:00.000Z",
	pausedUntil: null,
	historyDays: 90,
};

test("a gh login shows its account, scopes, repositories, sweep and rate limit", () => {
	const markup = renderToStaticMarkup(
		<GitHubTokenCard token={READY} dashboard="visible" />,
	);
	expect(markup).toContain(
		"The GitHub CLI&#x27;s login for <strong>octo</strong> on github.com.",
	);
	expect(markup).toContain("gist, repo, workflow");
	expect(markup).toContain("2 collected");
	expect(markup).toContain("Not readable with this token: someone/private.");
	expect(markup).toContain("History of the last 90 days.");
	expect(markup).toContain("4,100 of 5,000 requests left this hour");
	expect(markup).toContain("Within limit");
	expect(markup).toContain("Open dashboard");
	expect(markup).not.toContain("Connect GitHub");
	expect(markup).not.toContain("self-hosted-command");
});

test("without a token the card says why and gives the command that fixes it", () => {
	const markup = renderToStaticMarkup(
		<GitHubTokenCard
			token={{
				...READY,
				state: "missing",
				source: null,
				login: null,
				scopes: null,
				rateLimit: null,
				repositories: 0,
				unreadableRepositories: [],
				lastSweepAt: null,
				message:
					"No GitHub token: GITHUB_TOKEN and GH_TOKEN are not set, and the GitHub CLI is not signed in to github.com.",
				fix: "gh auth login --scopes repo",
			}}
			dashboard="notConnected"
		/>,
	);
	expect(markup).toContain('role="alert"');
	expect(markup).toContain("the GitHub CLI is not signed in to github.com.");
	expect(markup).toContain("No token");
	expect(markup).toContain("<code>gh auth login --scopes repo</code>");
	expect(markup).toContain("nothing needs a restart");
	expect(markup).toContain("Not yet");
	expect(markup).toContain("Not known yet.");
	expect(markup).toContain(">Unknown</span>");
	expect(markup).not.toContain("Within limit");
	expect(markup).not.toContain("Scopes");
	expect(markup).not.toContain("Open dashboard");
});

test("a token without the repo scope and a paused collection are flagged", () => {
	const markup = renderToStaticMarkup(
		<GitHubTokenCard
			token={{
				...READY,
				source: "GITHUB_TOKEN",
				scopes: ["read:org"],
				missingScopes: ["repo"],
				message:
					"The token has no repo scope, so private repositories and their CI logs cannot be read.",
				fix: null,
				pausedUntil: "2026-11-09T13:00:00.000Z",
			}}
			dashboard="syncing"
		/>,
	);
	expect(markup).toContain("GITHUB_TOKEN in the server&#x27;s environment");
	expect(markup).toContain("No repo scope");
	expect(markup).toContain("Waiting until");
	expect(markup).not.toContain("self-hosted-command");
});

test("the repository list says the repositories come from sessions", () => {
	const status: GitHubRepositoryConnectionStatus = {
		accountLogin: "octo",
		canManage: true,
		configurationError: null,
		configured: true,
		connected: true,
		installationId: null,
		manageUrl: null,
		repositories: [
			{
				defaultBranch: "main",
				isPrivate: true,
				name: "athena",
				nodeId: "R_athena",
				owner: "opalinehq",
				repositoryId: "55",
				sync: { state: "syncing", progress: 0.5 },
			},
		],
		repositorySelection: "selected",
		token: READY,
	};
	const markup = renderToStaticMarkup(<GitHubRepositoryList status={status} />);
	expect(markup).toContain(
		"From this workspace&#x27;s sessions, read with the token of octo.",
	);
	expect(markup).not.toContain("Reconnect");
	expect(markup).toContain("Syncing 50%");
});
