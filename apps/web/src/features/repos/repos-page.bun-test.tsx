import { expect, test } from "bun:test";
import type { RepositorySummary } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { RepoMetrics } from "./repos-page";

const repo: RepositorySummary = {
	estimatedCost: 12.34,
	identity: {
		repoKey: "path:athena",
		repoLabel: "athena",
		repoName: "athena",
		source: "worktree",
		worktree: null,
	},
	sessionCount: 4,
	signals: {
		complete: false,
		modelApologies: 9,
		userNegative: 8,
		userPositive: 7,
	},
	topUsers: [],
	totalTokens: 1234,
	userCount: 1,
};

test("shows available repository signals without an indexing state", () => {
	const markup = renderToStaticMarkup(<RepoMetrics repo={repo} />);

	expect(markup).toContain("Cost");
	expect(markup).toContain("tokens");
	expect(markup).toContain("Language signals");
	expect(markup).not.toContain("Signals still processing");
	expect(markup).toContain(">7</span> positive");
	expect(markup).toContain(">8</span> negative");
	expect(markup).toContain(">9</span> apologies");
});

test("shows repository language signals once every session is indexed", () => {
	const markup = renderToStaticMarkup(
		<RepoMetrics
			repo={{ ...repo, signals: { ...repo.signals, complete: true } }}
		/>,
	);

	expect(markup).toContain("Language signals");
	expect(markup).toContain(">7</span> positive");
	expect(markup).toContain(">8</span> negative");
	expect(markup).toContain(">9</span> apologies");
});
