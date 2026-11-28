import { slimTranscriptText } from "@rudel/api-routes/transcript-slim";
import {
	assertFilteredJsonValidity,
	filterKnownSecrets,
	filterSessionTextFields,
	getUtf8ByteLength,
	mergeRedactionCounts,
	type RedactionCounts,
	type SecretFilterResult,
} from "@rudel/secret-filter";
import type {
	IngestFilterFields,
	IngestFilterResult,
} from "./ingest-filter.types.js";

/**
 * Every upload path (direct ingest, R2 commit and repair) filters here, so
 * every client, including CLIs that predate client-side slimming, stores
 * slimmed transcripts (image omission markers, deduplicated Codex command
 * output and compaction history). The CLI applies the same rules, so this is
 * a no-op on its uploads. Slimming runs first: secret filtering then never
 * scans removed bytes, and the redaction budget is measured against the text
 * that is stored, whichever client uploaded it. Each stream (main transcript,
 * each subagent) is slimmed on its own.
 */
export function slimAndFilterSecrets(
	fields: IngestFilterFields,
): IngestFilterResult {
	const slim = (text: string) =>
		fields.slimmed ? text : slimTranscriptText(text);
	const content = slim(fields.content);
	let filterInputBytes = getUtf8ByteLength(content);
	const subagents = fields.subagents?.map((subagent) => {
		const slimmed = slim(subagent.content);
		filterInputBytes += getUtf8ByteLength(slimmed);
		return { ...subagent, content: slimmed };
	});
	if (!fields.slimmed)
		return {
			...filterSessionTextFields({ content, subagents }),
			filterInputBytes,
		};
	// A local import sends the whole session again each time it grows, so
	// almost every line was filtered on the previous import: only new lines
	// are filtered (see `filterJsonLines`).
	const main = filterStream(content);
	let counts = main.counts;
	let redactedBytes = main.redactedBytes;
	const filteredSubagents = subagents?.map((subagent) => {
		const result = filterStream(subagent.content);
		counts = mergeRedactionCounts(counts, result.counts);
		redactedBytes += result.redactedBytes;
		return { ...subagent, content: result.text };
	});
	return {
		content: main.text,
		subagents: filteredSubagents,
		counts,
		redactedBytes,
		filterInputBytes,
	};
}

interface FilteredLine {
	readonly text: string;
	readonly counts: RedactionCounts;
	readonly redactedBytes: number;
}

/** Lines this thread already filtered: `null` when the filter left a line as it was. */
const filteredLines = new Map<string, FilteredLine | null>();
const MAX_REMEMBERED_LINES = 300_000;
const EMPTY_COUNTS: RedactionCounts = {};

function lineKey(line: string): string {
	return `${Bun.hash(line).toString(36)}:${line.length}`;
}

/** Every non-empty line is one JSON object, so a record boundary is a raw newline. */
function isJsonLines(text: string): boolean {
	let start = 0;
	while (start < text.length) {
		const end = text.indexOf("\n", start);
		const stop = end === -1 ? text.length : end;
		let first = start;
		while (first < stop && /\s/u.test(text[first] ?? "")) first += 1;
		let last = stop - 1;
		while (last >= first && /\s/u.test(text[last] ?? "")) last -= 1;
		if (first <= last && (text[first] !== "{" || text[last] !== "}"))
			return false;
		start = stop + 1;
	}
	return true;
}

/**
 * Filters a JSON Lines stream one record at a time and remembers each record's
 * result, so a growing transcript costs only its new lines. A secret never
 * spans records (a raw newline can only sit between two JSON objects), so the
 * output is the same bytes as filtering the whole stream at once; anything
 * that is not JSON Lines is filtered whole. The stream's JSON integrity is
 * still checked against its input, as `filterSessionTextFields` does.
 */
export function filterStream(text: string): SecretFilterResult {
	if (!isJsonLines(text)) {
		const whole = filterKnownSecrets(text);
		assertFilteredJsonValidity(text, whole.text);
		return whole;
	}
	const lines = text.split("\n");
	let counts = EMPTY_COUNTS;
	let redactedBytes = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line === "") continue;
		const key = lineKey(line);
		let remembered = filteredLines.get(key);
		if (remembered === undefined) {
			const result = filterKnownSecrets(line);
			remembered =
				result.redactedBytes === 0 && result.text === line
					? null
					: {
							text: result.text,
							counts: result.counts,
							redactedBytes: result.redactedBytes,
						};
			if (filteredLines.size >= MAX_REMEMBERED_LINES) filteredLines.clear();
			filteredLines.set(key, remembered);
		}
		if (remembered === null) continue;
		lines[index] = remembered.text;
		counts = mergeRedactionCounts(counts, remembered.counts);
		redactedBytes += remembered.redactedBytes;
	}
	const filtered = lines.join("\n");
	assertFilteredJsonValidity(text, filtered);
	return { text: filtered, counts, redactedBytes };
}

/** For tests: forget the remembered lines. */
export function clearFilteredLines(): void {
	filteredLines.clear();
}
