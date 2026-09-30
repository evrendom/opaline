import { expect, test } from "bun:test";
import type { GitHubRepositoryConnectionStatus } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { GitHubConnectionCard } from "./GitHubConnectionCard";
import {
	readGitHubCallbackResult,
	WorkspaceGitHubConnectionView,
} from "./WorkspaceGitHubConnection";

const CONNECTED_STATUS: GitHubRepositoryConnectionStatus = {
	accountLogin: "opalinehq",
	canManage: true,
	configurationError: null,
	configured: true,
	connected: true,
	installationId: "1234",
	manageUrl:
		"https://github.com/organizations/opalinehq/settings/installations",
	repositories: [
		{
			defaultBranch: "main",
			isPrivate: true,
			name: "athena",
			nodeId: "R_athena",
			owner: "opalinehq",
			repositoryId: "55",
		},
	],
	repositorySelection: "selected",
};

test("renders verified connection details and admin actions", () => {
	const markup = renderToStaticMarkup(
		<GitHubConnectionCard
			status={CONNECTED_STATUS}
			isPending={false}
			isError={false}
			isConnecting={false}
			actionError={null}
			onConnect={() => {}}
			onRetry={() => {}}
		/>,
	);

	expect(markup).toContain("Connected to <strong>opalinehq</strong>");
	expect(markup).toContain("Selected repositories (1)");
	expect(markup).toContain("opalinehq/athena");
	expect(markup).toContain("Private · main");
	expect(markup).toContain("Manage on GitHub");
	expect(markup).toContain("Reconnect");
	expect(markup).toContain("The capture update has not been published yet.");
	expect(markup).toContain("npx opaline@latest update");
	expect(markup).toContain("npx opaline@latest");
});

test("keeps connection actions admin-only", () => {
	const markup = renderToStaticMarkup(
		<GitHubConnectionCard
			status={{
				...CONNECTED_STATUS,
				accountLogin: null,
				canManage: false,
				connected: false,
				installationId: null,
				manageUrl: null,
				repositories: [],
				repositorySelection: null,
			}}
			isPending={false}
			isError={false}
			isConnecting={false}
			actionError={null}
			onConnect={() => {}}
			onRetry={() => {}}
		/>,
	);

	expect(markup).toContain("Ask a workspace admin to connect GitHub.");
	expect(markup).toContain("Not connected");
	expect(markup).not.toContain(">Connect GitHub</button>");
	expect(markup).not.toContain("Reconnect");
});

test("shows unavailable and retry states without implying a connection", () => {
	const unavailable = renderToStaticMarkup(
		<GitHubConnectionCard
			status={{
				...CONNECTED_STATUS,
				accountLogin: null,
				configurationError: "Server configuration is unavailable.",
				configured: false,
				connected: false,
				installationId: null,
				manageUrl: null,
				repositories: [],
				repositorySelection: null,
			}}
			isPending={false}
			isError={false}
			isConnecting={false}
			actionError={null}
			onConnect={() => {}}
			onRetry={() => {}}
		/>,
	);
	const failed = renderToStaticMarkup(
		<GitHubConnectionCard
			status={undefined}
			isPending={false}
			isError={true}
			isConnecting={false}
			actionError={null}
			onConnect={() => {}}
			onRetry={() => {}}
		/>,
	);

	expect(unavailable).toContain(
		"GitHub connections are not available right now.",
	);
	expect(unavailable).toContain("Unavailable");
	expect(unavailable).not.toContain(">Connect GitHub</button>");
	expect(failed).toContain("Connection status could not be loaded.");
	expect(failed).toContain("Try again");
});

function renderSection(
	evidenceStatus: Parameters<
		typeof WorkspaceGitHubConnectionView
	>[0]["evidenceStatus"],
	isError = false,
) {
	return renderToStaticMarkup(
		<WorkspaceGitHubConnectionView
			evidenceStatus={evidenceStatus}
			isError={isError}
			isConnecting={false}
			actionError={null}
			onConnect={() => {}}
			onRetry={() => {}}
		/>,
	);
}

test("renders no GitHub section while the server keeps it hidden", () => {
	expect(renderSection({ visibility: "hidden" })).toBe("");
});

test("renders no GitHub section before visibility is known or when it fails to load", () => {
	expect(renderSection(undefined)).toBe("");
	expect(renderSection(undefined, true)).toBe("");
});

test("renders the connection card and CLI note once the server shows the section", () => {
	const markup = renderSection({
		visibility: "visible",
		connection: CONNECTED_STATUS,
	});

	expect(markup).toContain("GitHub");
	expect(markup).toContain("Connected to <strong>opalinehq</strong>");
	expect(markup).toContain("Opaline CLI");
	expect(markup).toContain("npx opaline@latest update");
});

test("accepts only documented callback results", () => {
	for (const result of [
		"connected",
		"cancelled",
		"session-required",
		"forbidden",
		"error",
	] as const) {
		expect(readGitHubCallbackResult(`?github=${result}`)).toBe(result);
	}
	expect(readGitHubCallbackResult("?github=connected-later")).toBeNull();
	expect(readGitHubCallbackResult("?other=value")).toBeNull();
});
