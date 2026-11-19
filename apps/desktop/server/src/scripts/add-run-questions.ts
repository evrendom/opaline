import { sqlClient } from "../db.js";
import {
	importRunQuestions,
	parseQuestionFile,
} from "../services/run-questions/import-questions.js";
import { parseRunQuestionsAddArgs } from "./l1-script-args.js";

// Adds run questions from a JSON file through the catalogue the internal form
// uses, as drafts (--on turns them on, so every run is answered for them).
// A wording already in the catalogue is not added again. Prints each
// question's key, id and state.
const args = parseRunQuestionsAddArgs(Bun.argv.slice(2));
const entries = parseQuestionFile(await Bun.file(args.file).text());
try {
	const imported = await importRunQuestions(sqlClient, entries, {
		turnOn: args.on,
	});
	console.log(JSON.stringify(imported, null, 2));
	if (imported.some((question) => question.status === "conflict"))
		console.error(
			"Some wordings are in the catalogue with other criteria: change them in /admin/run-questions.",
		);
	if (
		imported.some(
			(question) =>
				question.status === "refused" || question.status === "conflict",
		)
	)
		process.exitCode = 2;
} finally {
	await sqlClient.end();
}
