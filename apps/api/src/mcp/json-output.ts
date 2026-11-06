import { ORPCError } from "@orpc/server";
import type { AnalysisReadOutput, AnalysisRunOutput } from "@rudel/api-routes";
import { omittedMarker, truncateString } from "../services/analysis/compact.js";

export const OUTPUT_FORMATS = ["text", "json"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const FORMAT_INPUT = {
	type: "string",
	enum: [...OUTPUT_FORMATS],
	default: "text",
	description:
		"text (default): the compact text view. json: the same data as one JSON object, with the same cut markers and an _opalineUrl, for the skill's scripts when the result is saved to a file.",
} as const;

export function outputFormat(value: unknown): OutputFormat {
	if (value === undefined || value === null || value === "text") return "text";
	if (value === "json") return "json";
	throw new ORPCError("BAD_REQUEST", {
		message: `format must be text or json, not ${JSON.stringify(value)}`,
	});
}

export function capStrings<T>(value: T): T {
	if (typeof value === "string") return truncateString(value) as T;
	if (Array.isArray(value)) return value.map(capStrings) as T;
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, capStrings(item)]),
		) as T;
	return value;
}

export function readJson(
	output: AnalysisReadOutput,
	urlOf: (sessionId: string) => string,
): string {
	const markers = [
		...(output.omitted?.sections
			? [omittedMarker(output.omitted.sections, "sections")]
			: []),
		...(output.omitted?.runs
			? [omittedMarker(output.omitted.runs, "runs")]
			: []),
	];
	const [first] = output.reads;
	return JSON.stringify({
		tool: "read",
		truncated: output.truncated,
		...(output.maxChars === undefined ? {} : { maxChars: output.maxChars }),
		...(output.trace ? { trace: output.trace } : {}),
		...(output.omitted ? { omitted: output.omitted } : {}),
		reads: output.reads.map((read) => ({
			...read,
			_opalineUrl: urlOf(read.ref.sessionId),
		})),
		_markers: markers,
		...(first ? { _opalineUrl: urlOf(first.ref.sessionId) } : {}),
	});
}

export const RUN_CUT_NOTE =
	"note: cut to maxChars; expand fewer ids at once, ask for fewer sections, or raise maxChars";

export function runJson(output: AnalysisRunOutput, url: string | null): string {
	return JSON.stringify({
		tool: "run",
		id: output.id,
		...(output.ref ? { ref: output.ref } : {}),
		phaseRule: output.phaseRule,
		truncated: output.truncated,
		...(output.view ? { view: capStrings(output.view) } : {}),
		text: output.text,
		_markers: output.truncated ? [RUN_CUT_NOTE] : [],
		...(url ? { _opalineUrl: url } : {}),
	});
}
