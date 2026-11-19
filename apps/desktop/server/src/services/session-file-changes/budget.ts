import {
	SESSION_FILE_CHANGES_TEXT_BUDGET,
	type SessionFileChanges,
} from "@rudel/api-routes";

const KEPT = 2_000;

type Text = { length: number; cut: () => void };

export function capSessionFileChanges(
	changes: SessionFileChanges,
	budget = SESSION_FILE_CHANGES_TEXT_BUDGET,
): SessionFileChanges {
	const seen: Text[] = [];
	const contents: Text[] = [];
	const before: Text[] = [];
	const after: Text[] = [];
	const files = changes.files.map((file) => ({
		...file,
		changes: file.changes.map((change) => ({ ...change })),
	}));
	const runs = changes.runs.map((run) => ({
		...run,
		steps: run.steps.map((step) => ({ ...step })),
	}));
	for (const run of runs)
		for (const step of run.steps) {
			const read = step.seen;
			if (read)
				seen.push({
					cut: () => {
						step.seen = { ...read, cut: true, text: read.text.slice(0, KEPT) };
					},
					length: read.text.length,
				});
		}
	for (const file of files) {
		const content = file.content;
		if (content !== null)
			contents.push({
				cut: () => {
					file.content = content.slice(0, KEPT);
					file.contentCut = true;
				},
				length: content.length,
			});
		for (const change of file.changes) {
			const was = change.before;
			const now = change.after;
			before.push({
				cut: () => {
					change.before = was.slice(0, KEPT);
					change.cut = true;
				},
				length: was.length,
			});
			after.push({
				cut: () => {
					change.after = now.slice(0, KEPT);
					change.cut = true;
				},
				length: now.length,
			});
		}
	}
	let total = [seen, contents, before, after]
		.flat()
		.reduce((sum, text) => sum + text.length, 0);
	if (total <= budget) return changes;
	for (const texts of [seen, contents, before, after])
		for (const text of texts.sort((a, b) => b.length - a.length)) {
			if (total <= budget) return { ...changes, files, runs };
			if (text.length <= KEPT) break;
			text.cut();
			total -= text.length - KEPT;
		}
	return { ...changes, files, runs };
}
