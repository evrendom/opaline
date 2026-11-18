import { expect, test } from "bun:test";
import type { SessionReaderStep } from "../model/session-reader-run-steps";
import { getContextMap } from "./session-reader-context-map";

const step = (
	fields: Partial<SessionReaderStep> & Pick<SessionReaderStep, "kind">,
): SessionReaderStep =>
	({
		children: [],
		detail: null,
		endMs: 0,
		icon: null,
		id: Math.random().toString(),
		isError: false,
		name: "",
		nativeId: null,
		result: null,
		startMs: 0,
		text: null,
		toolEvent: null,
		...fields,
	}) as SessionReaderStep;

const chars = (count: number) => "x".repeat(count);

test("skills hold their bodies: a call's, and one a slash command brought with the prompt", () => {
	const map = getContextMap({
		baseline: 0,
		earlier: null,
		prompt: `give me some ideas\nBase directory for this skill: /Users/me/.claude/skills/ideas\n${chars(8_000)}`,
		steps: [
			step({
				kind: "tool",
				name: "Skill",
				result: "Launching skill: dataviz",
				skill: "dataviz",
				toolEvent: {
					input: { skill: "dataviz" },
					kind: "tool",
					skillContent: {
						baseDirectory: "/tmp/dataviz",
						content: chars(4_000),
					},
					toolName: "Skill",
				} as unknown as SessionReaderStep["toolEvent"],
			}),
		],
		until: null,
		use: { model: null, tokens: 10_000, window: 200_000 },
	});
	const skills = map?.parts.find((part) => part.key === "skills");
	expect(skills?.kind).toBe("skill");
	expect(skills?.items?.map((item) => item.label).sort()).toEqual([
		"dataviz",
		"ideas",
	]);
	const you = map?.parts.find((part) => part.key === "you");
	expect(you?.tokens ?? 0).toBeLessThan(50);
	expect(skills?.tokens ?? 0).toBeGreaterThan(9_000);
});
