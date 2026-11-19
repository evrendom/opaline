import { expect, test } from "bun:test";
import { runUsesSkill } from "./repo-skill-sessions";

test("a run uses a skill it lists or invoked, plugin prefix or not", () => {
	const run = (skills: string[], events: string[] = []) => ({
		skills,
		skillEvents: events.map((skill) => ({ at: "2026-10-01T09:00:00Z", skill })),
	});
	expect(runUsesSkill(run(["review"]), "review")).toBe(true);
	expect(runUsesSkill(run([], ["review"]), "review")).toBe(true);
	expect(runUsesSkill(run(["acme:review"]), "review")).toBe(true);
	expect(runUsesSkill(run(["code-review"]), "review")).toBe(false);
	expect(runUsesSkill(run([]), "review")).toBe(false);
});
