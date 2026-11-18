import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RUN_QUESTION_ANSWERS_MIGRATION } from "../../scripts/migrate-run-question-answers.js";

test("bootstrap and the production deploy both create the answers table through its runner", () => {
	expect(
		readFileSync(
			new URL("../../scripts/bootstrap.ts", import.meta.url),
			"utf8",
		),
	).toContain(
		`"${RUN_QUESTION_ANSWERS_MIGRATION}",\n\t\t"migrate-run-question-answers.ts",`,
	);
	const scripts = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	).scripts as Record<string, string>;
	expect(scripts["ch:migrate:production"]).toContain(
		"ch:migrate:run-question-answers",
	);
	expect(scripts["ch:migrate:run-question-answers"]).toBe(
		"bun scripts/migrate-run-question-answers.ts",
	);
});
