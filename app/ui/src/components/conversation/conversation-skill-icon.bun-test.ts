import { describe, expect, test } from "bun:test";
import { getSkillIcon } from "./conversation-skill-icon";

describe("skill icon selection", () => {
	test("keeps an unfamiliar skill stable across calls and casing", () => {
		expect(getSkillIcon("custom-workflow")).toEqual(
			getSkillIcon(" CUSTOM-WORKFLOW "),
		);
	});

	test("distributes skill names across multiple tool silhouettes", () => {
		const names = [
			"pr-creation",
			"conductor",
			"clickhouse-best-practices",
			"clickhouse-query",
			"typescript-standards",
			"testing-bun",
			"design",
		].map((skill) => getSkillIcon(skill).name);
		expect(new Set(names).size).toBeGreaterThanOrEqual(4);
	});

	test("always supplies a library icon even for an empty name", () => {
		expect(getSkillIcon("").icon).toBeTruthy();
	});
});
