import { expect, test } from "bun:test";
import { skillDescription } from "./repo-skills-table";

test("reads the description from a SKILL.md front matter", () => {
	expect(
		skillDescription(
			"---\nname: review\ndescription: Reviews a diff for bugs\n---\n# Review",
		),
	).toBe("Reviews a diff for bugs");
	expect(
		skillDescription('---\ndescription: "Quoted: with a colon"\n---\nBody'),
	).toBe("Quoted: with a colon");
	expect(skillDescription("# No front matter")).toBeNull();
	expect(skillDescription(null)).toBeNull();
});
