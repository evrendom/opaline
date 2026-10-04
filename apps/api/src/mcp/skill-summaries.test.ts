import { expect, test } from "bun:test";
import type { HistoricalSkillSummary } from "@rudel/api-routes";
import { compactSkills } from "./skill-summaries.js";

const preview = "Use this skill when ".repeat(80);
const skill = (index: number): HistoricalSkillSummary => ({
	name: `skill-${index}`,
	sessionCount: 40,
	claudeSessionCount: 30,
	codexSessionCount: 10,
	contentPreview: preview,
	versionCount: 3,
	attribution: {
		userCount: 4,
		topUsers: [{ userId: `user-${index}`, sessionCount: 20 }],
		repoCount: 2,
		topRepos: [
			{
				repoKey: `github.com/org/repo-${index}`,
				repoLabel: "repo",
				sessionCount: 25,
			},
		],
	},
});

test("list_skills stays small: 150 skills with full previews fit in 40k characters of JSON", () => {
	const skills = Array.from({ length: 150 }, (_, index) => skill(index));
	expect(JSON.stringify(skills).length).toBeGreaterThan(240_000);

	const text = JSON.stringify(compactSkills(skills));
	expect(text.length).toBeLessThan(40_000);
	expect(text).not.toContain("Use this skill when");
	expect(JSON.parse(text)[0]).toEqual({
		name: "skill-0",
		sessionCount: 40,
		claudeSessionCount: 30,
		codexSessionCount: 10,
		versionCount: 3,
		userCount: 4,
		repoCount: 2,
		topRepos: [{ repo: "repo", sessionCount: 25 }],
	});
});

test("legacy skills without attribution or versions say so with nulls", () => {
	expect(
		compactSkills([
			{
				name: "legacy",
				sessionCount: 1,
				claudeSessionCount: 0,
				codexSessionCount: 1,
				contentPreview: null,
			},
		]),
	).toEqual([
		{
			name: "legacy",
			sessionCount: 1,
			claudeSessionCount: 0,
			codexSessionCount: 1,
			versionCount: null,
			userCount: null,
			repoCount: null,
			topRepos: [],
		},
	]);
});
