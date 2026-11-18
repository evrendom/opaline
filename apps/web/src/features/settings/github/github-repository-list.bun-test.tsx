import { expect, test } from "bun:test";
import type { GitHubRepositoryConnectionStatus } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { markupText } from "@/test/markup-text";
import { GitHubRepositoryList } from "./GitHubRepositoryList";

const REPOSITORY: GitHubRepositoryConnectionStatus["repositories"][number] = {
	defaultBranch: "main",
	isPrivate: true,
	name: "athena",
	nodeId: "R_athena",
	owner: "opalinehq",
	repositoryId: "55",
};

const STATUS: GitHubRepositoryConnectionStatus = {
	accountLogin: "opalinehq",
	canManage: true,
	configurationError: null,
	configured: true,
	connected: true,
	installationId: "1234",
	manageUrl: null,
	repositories: [
		{ ...REPOSITORY, sync: { state: "ready" } },
		{
			...REPOSITORY,
			name: "web",
			repositoryId: "56",
			isPrivate: false,
			sync: { state: "syncing", progress: 0.42 },
		},
		{
			...REPOSITORY,
			name: "legacy",
			repositoryId: "57",
			sync: { state: "unavailable", reason: "not-found" },
		},
		{
			...REPOSITORY,
			name: "tools",
			repositoryId: "58",
			sync: { state: "unavailable", reason: "no-access" },
		},
	],
	repositorySelection: "selected",
};

test("lists every repository with the Automatic uploads table layout", () => {
	const markup = renderToStaticMarkup(<GitHubRepositoryList status={STATUS} />);

	expect(markup).toContain("sessions-settings-table");
	expect(markup).toContain("Selected repositories on opalinehq.");
	expect(markup).toContain("Reconnect to include them");
	for (const name of ["athena", "web", "legacy", "tools"])
		expect(markup).toContain(`opalinehq/${name}`);
	expect(markup).toContain("Private");
	expect(markup).toContain("Public");
});

test("labels every sync state and pauses a suspended installation", () => {
	const markup = renderToStaticMarkup(<GitHubRepositoryList status={STATUS} />);
	expect(markup).toContain(">Synced<");
	expect(markupText(markup)).toContain("Syncing 42%");
	expect(markup).toContain(">Not found<");
	expect(markup).toContain(">No access<");

	const suspended = renderToStaticMarkup(
		<GitHubRepositoryList status={{ ...STATUS, suspended: true }} />,
	);
	expect(suspended).toContain(">Paused<");
	expect(suspended).not.toContain(">Synced<");
});

test("keeps the reconnect hint admin-only", () => {
	const markup = renderToStaticMarkup(
		<GitHubRepositoryList status={{ ...STATUS, canManage: false }} />,
	);
	expect(markup).not.toContain("Reconnect to include them");
});
