import { describe, expect, test } from "bun:test";
import type { RepositorySummary } from "@rudel/api-routes";
import {
	hasMoreRepositories,
	REPOSITORY_HUES,
	repositoryHue,
	topRepositories,
} from "./sidebar-repositories-model";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const DAY = 86_400_000;

function repo(
	label: string,
	sessionCount: number,
	daysAgo = 1,
): RepositorySummary {
	const name = label.split("/").at(-1) ?? label;
	return {
		identity: {
			repoKey: `remote:github.com/${label}`,
			repoLabel: label,
			repoName: name,
			source: "remote",
			worktree: null,
		},
		sessionCount,
		lastActiveAt: new Date(NOW - daysAgo * DAY).toISOString(),
		totalTokens: 0,
		estimatedCost: null,
		userCount: 1,
		topUsers: [],
		signals: {
			modelApologies: 0,
			userNegative: 0,
			userPositive: 0,
			complete: true,
		},
	};
}

describe("topRepositories", () => {
	test("keeps the ten with the most sessions, most first", () => {
		const repos = Array.from({ length: 14 }, (_, index) =>
			repo(`owner/repo-${index}`, index + 1),
		);
		const top = topRepositories(repos, NOW);
		expect(top).toHaveLength(10);
		expect(top[0]?.label).toBe("repo-13");
		expect(top.at(-1)?.label).toBe("repo-4");
	});

	test("names a repo by its name, with the owner only where names clash", () => {
		const top = topRepositories(
			[
				repo("opalinehq/athena", 502),
				repo("evrendom/rudel", 192),
				repo("opalinehq/rudel", 177),
			],
			NOW,
		);
		expect(top.map((each) => each.label)).toEqual([
			"athena",
			"evrendom/rudel",
			"opalinehq/rudel",
		]);
	});

	test("leaves out repos without sessions", () => {
		expect(topRepositories([repo("owner/empty", 0)], NOW)).toEqual([]);
	});

	test("lists only repos with a session in the last two months", () => {
		const top = topRepositories(
			[repo("o/old", 900, 90), repo("o/recent", 3, 59)],
			NOW,
		);
		expect(top.map((each) => each.label)).toEqual(["recent"]);
	});

	test("has more whenever a repo with sessions is left out", () => {
		const repos = [repo("o/a", 5), repo("o/b", 4, 90), repo("o/c", 0)];
		expect(hasMoreRepositories(repos, 2)).toBe(false);
		expect(hasMoreRepositories(repos, 1)).toBe(true);
	});
});

describe("repositoryHue", () => {
	test("gives a repo the hue of its sidebar row, and none off the list", () => {
		const repos = [repo("o/a", 9), repo("o/b", 7), repo("o/old", 900, 90)];
		expect(repositoryHue(repos, "remote:github.com/o/b", NOW)).toBe(
			REPOSITORY_HUES[1],
		);
		expect(repositoryHue(repos, "remote:github.com/o/old", NOW)).toBeNull();
	});
});
