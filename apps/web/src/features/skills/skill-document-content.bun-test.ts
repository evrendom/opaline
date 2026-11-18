import { expect, test } from "bun:test";
import type { HistoricalSkillVersion } from "@rudel/api-routes";
import {
	getDistinctSkillVersions,
	getSkillAllowedTools,
} from "./skill-document-content";

test("reads inline lists without leaking other frontmatter", () => {
	expect(
		getSkillAllowedTools(
			"---\nname: testing\nallowed-tools: [Read, Edit, Grep, Glob]\ndescription: Read this guide\n---\n# Body",
		),
	).toEqual(["Read", "Edit", "Grep", "Glob"]);
});

test("preserves tool policies and removes comments and duplicate tools", () => {
	expect(
		getSkillAllowedTools(
			'---\nallowed-tools: ["Bash(git diff:*)", Read, Read] # tools\n---\n',
		),
	).toEqual(["Bash(git diff:*)", "Read"]);
});

test("reads scalar and quoted scalar declarations", () => {
	for (const declaration of [
		"Read, Edit, Grep Glob",
		'"Read, Edit, Grep Glob"',
	]) {
		expect(
			getSkillAllowedTools(`---\nallowed-tools: ${declaration}\n---\n`),
		).toEqual(["Read", "Edit", "Grep", "Glob"]);
	}
});

test("reads block lists and multiline arrays with CRLF", () => {
	expect(
		getSkillAllowedTools(
			'---\r\nallowed-tools:\r\n  - Read\r\n  - "Bash(npm run test:*)"\r\nname: example\r\n---\r\n',
		),
	).toEqual(["Read", "Bash(npm run test:*)"]);
	expect(
		getSkillAllowedTools(
			"---\nallowed-tools: [\n  Read,\n  Edit\n]\nname: example\n---\n",
		),
	).toEqual(["Read", "Edit"]);
});

test("does not infer tools when a version has no declaration", () => {
	expect(getSkillAllowedTools("# Title\nallowed-tools: [Read]")).toEqual([]);
	expect(
		getSkillAllowedTools("---\nname: testing\n---\nallowed-tools: [Read]"),
	).toEqual([]);
	expect(getSkillAllowedTools("---\nallowed-tools: []\n---\n")).toEqual([]);
});

test("identical documents across agents share one version with recorded tools", () => {
	const older: HistoricalSkillVersion = {
		sourceAgent: "claude",
		contentSha256: "a".repeat(64),
		content: "# Skill\n\nSame guidance.",
		sessionCount: 2,
		firstUsedAt: "2026-01-01",
		lastUsedAt: "2026-02-01",
	};
	const withTools: HistoricalSkillVersion = {
		...older,
		sourceAgent: "codex",
		contentSha256: "b".repeat(64),
		content:
			"---\nname: skill\nallowed-tools: [Read, Edit]\n---\n\n# Skill\n\nSame guidance.",
	};
	const different: HistoricalSkillVersion = {
		...older,
		contentSha256: "c".repeat(64),
		content: "# Skill\n\nDifferent guidance.",
	};
	expect(getDistinctSkillVersions([older, withTools, different])).toEqual([
		withTools,
		different,
	]);
	expect(getDistinctSkillVersions([withTools, older])).toEqual([withTools]);
});
