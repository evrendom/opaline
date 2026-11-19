import { expect, test } from "bun:test";
import type { GitHubRepositoryConnectionStatus } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { GitHubConnectionCard } from "./GitHubConnectionCard";
import {
	readGitHubCallbackResult,
	WorkspaceGitHubConnectionView,
} from "./WorkspaceGitHubConnection";

const REPOSITORY: GitHubRepositoryConnectionStatus["repositories"][number] = {
	defaultBranch: "main",
	isPrivate: true,
	name: "athena",
	nodeId: "R_athena",
	owner: "opalinehq",
	repositoryId: "55",
	sync: { state: "ready" },
};

const CONNECTED_STATUS: GitHubRepositoryConnectionStatus = {
	accountLogin: "opalinehq",
	canManage: true,
	configurationError: null,
	configured: true,
	connected: true,
	installationId: "1234",
	manageUrl:
		"https://github.com/organizations/opalinehq/settings/installations",
	repositories: [REPOSITORY],
	repositorySelection: "selected",
};

function renderCard(
	status: GitHubRepositoryConnectionStatus | undefined,
	options: { isError?: boolean; withDisconnect?: boolean } = {},
) {
	return renderToStaticMarkup(
		<GitHubConnectionCard
			status={status}
			isPending={false}
			isError={options.isError ?? false}
			isConnecting={false}
			actionError={null}
			onConnect={() => {}}
			onDisconnect={
				options.withDisconnect === false ? undefined : async () => true
			}
			onRetry={() => {}}
		/>,
	);
}

test("dashboard syncing and visible states, and admin-only retention advice", () => {
	const card = (status: GitHubRepositoryConnectionStatus) =>
		renderToStaticMarkup(
			<GitHubConnectionCard
				status={status}
				isPending={false}
				isError={false}
				isConnecting={false}
				actionError={null}
				onConnect={() => {}}
				onRetry={() => {}}
			/>,
		);
	expect(card({ ...CONNECTED_STATUS, dashboard: "syncing" })).toContain(
		"Reading pull request and CI history from GitHub. 1 of 1 repository ready",
	);
	expect(card({ ...CONNECTED_STATUS, dashboard: "visible" })).toContain(
		"Merged PRs and CI runs are on the dashboard.",
	);
	expect(card({ ...CONNECTED_STATUS, dashboard: "visible" })).toContain(
		"Open dashboard",
	);
	expect(card(CONNECTED_STATUS)).toContain("Raise Actions retention on GitHub");
	expect(card({ ...CONNECTED_STATUS, canManage: false })).not.toContain(
		"Raise Actions retention on GitHub",
	);
});

test("renders verified connection details and admin actions", () => {
	const markup = renderCard(CONNECTED_STATUS);

	expect(markup).toContain("Connected to <strong>opalinehq</strong>");
	expect(markup).not.toContain("opalinehq/athena");
	expect(markup).toContain("Manage on GitHub");
	expect(markup).toContain("Reconnect");
	expect(markup).toContain("Disconnect GitHub");
	expect(markup).not.toContain("npx opaline@latest");
});

test("shows a suspended installation without Reconnect or dashboard rows", () => {
	const markup = renderCard({ ...CONNECTED_STATUS, suspended: true });

	expect(markup).toContain("is suspended, so syncing is paused");
	expect(markup).toContain("Unsuspend on GitHub");
	expect(markup).not.toContain("Reconnect</button>");
	expect(markup).not.toContain("Open dashboard");
	expect(markup).toContain("Disconnect GitHub");
});

test("keeps management of a connected workspace admin-only", () => {
	const markup = renderCard({
		...CONNECTED_STATUS,
		canManage: false,
		manageUrl: null,
	});

	expect(markup).toContain("Ask a workspace admin to change it.");
	expect(markup).not.toContain("Manage on GitHub");
	expect(markup).not.toContain("Reconnect");
	expect(markup).not.toContain("Disconnect GitHub");
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
		"GitHub connections aren&#x27;t set up on this deployment yet.",
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

test("renders the connection card once the server shows the section", () => {
	const markup = renderSection({
		visibility: "visible",
		dashboard: "syncing",
		connection: CONNECTED_STATUS,
	});

	expect(markup).toContain("GitHub");
	expect(markup).toContain("Connected to <strong>opalinehq</strong>");
});

test("accepts only documented callback results", () => {
	for (const result of [
		"connected",
		"cancelled",
		"session-required",
		"forbidden",
		"already-connected",
		"error",
	] as const) {
		expect(readGitHubCallbackResult(`?github=${result}`)).toBe(result);
	}
	expect(readGitHubCallbackResult("?github=connected-later")).toBeNull();
	expect(readGitHubCallbackResult("?other=value")).toBeNull();
});

test("shows history progress across repositories while syncing", () => {
	const markup = renderCard({
		...CONNECTED_STATUS,
		dashboard: "syncing",
		repositories: [
			{
				...REPOSITORY,
				repositoryId: "1",
				sync: { state: "ready" },
			},
			{
				...REPOSITORY,
				repositoryId: "2",
				sync: { state: "syncing", progress: 0.5 },
			},
			{
				...REPOSITORY,
				repositoryId: "3",
				sync: { state: "syncing" },
			},
			{
				...REPOSITORY,
				repositoryId: "4",
				sync: { state: "unavailable", reason: "no-access" },
			},
		],
	});

	expect(markup).toContain("1 of 4 repositories ready");
	expect(markup).toContain('aria-valuenow="62"');
	expect(markup).toContain(">62%<");
});
