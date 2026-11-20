import { slimTranscriptText } from "@rudel/api-routes/transcript-slim";
import {
	filterSessionTextFields,
	getUtf8ByteLength,
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
	return {
		...filterSessionTextFields({ content, subagents }),
		filterInputBytes,
	};
}
