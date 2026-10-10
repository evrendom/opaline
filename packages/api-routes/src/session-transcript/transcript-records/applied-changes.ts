import { isRecord, type LineFacts } from "./line-items.js";
import { clippedText } from "./record-facts.js";
import { literalLineCount } from "./text-fields.js";
import {
	TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS,
	type TranscriptRecordFactKey,
} from "./types.js";

export function appliedChangesFacts(
	changes: unknown,
	confirmed: boolean,
): LineFacts {
	if (!confirmed || !isRecord(changes)) return {};
	const extra: Partial<Record<TranscriptRecordFactKey, string>> = {};
	const entries: Record<string, unknown>[] = [];
	let added = 0;
	let removed = 0;
	let hasLineCounts = false;
	let chars = 2;
	let more = 0;
	for (const [path, raw] of Object.entries(changes)) {
		if (!isRecord(raw)) continue;
		const entry: Record<string, unknown> = {
			path: clippedText(extra, "applied_changes", path),
		};
		for (const name of ["type", "move_path", "created", "deleted"])
			if (Object.hasOwn(raw, name))
				entry[name] =
					typeof raw[name] === "string"
						? clippedText(extra, "applied_changes", raw[name])
						: raw[name];
		if (typeof raw.unified_diff === "string") {
			hasLineCounts = true;
			const counts = unifiedDiffCounts(raw.unified_diff);
			added += counts.added;
			removed += counts.removed;
		} else if (typeof raw.content === "string") {
			hasLineCounts ||= raw.type === "add" || raw.type === "delete";
			const lines = literalLineCount(raw.content);
			if (raw.type === "add") added += lines;
			if (raw.type === "delete") removed += lines;
		}
		const length = JSON.stringify(entry).length + 1;
		if (chars + length > TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS) {
			more++;
			continue;
		}
		chars += length;
		entries.push(entry);
	}
	extra.applied_changes = JSON.stringify(entries);
	if (hasLineCounts) {
		extra.patch_lines_added = String(added);
		extra.patch_lines_removed = String(removed);
	}
	if (more > 0) {
		extra.applied_changes_more = String(more);
		extra.facts_clipped = [
			...new Set([
				...(extra.facts_clipped ?? "").split(",").filter(Boolean),
				"applied_changes",
			]),
		]
			.sort()
			.join(",");
	}
	return { extra };
}

export function unifiedDiffCounts(diff: string): {
	added: number;
	removed: number;
} {
	let added = 0;
	let removed = 0;
	let start = 0;
	let inHunk = false;
	while (start < diff.length) {
		const newline = diff.indexOf("\n", start);
		const end = newline === -1 ? diff.length : newline;
		const line = diff.slice(start, end);
		if (line.startsWith("@@")) inHunk = true;
		if (line.startsWith("+") && (inHunk || !line.startsWith("+++ "))) added++;
		if (line.startsWith("-") && (inHunk || !line.startsWith("--- "))) removed++;
		start = end + 1;
	}
	return { added, removed };
}
