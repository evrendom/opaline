import { SEARCH_KINDS } from "@rudel/api-routes";
import { getSafeClickHouseTable } from "../../clickhouse.js";

export const TRANSCRIPT_RECORDS_TABLE = getSafeClickHouseTable(
	"rudel.transcript_records",
);

export type LiteralMode = "exact" | "regex";

export const INJECTED_RECORD_KINDS = [
	"injected_context",
	"compaction",
] as const;

export function literalOf(mode: string): LiteralMode {
	return mode === "regex" ? "regex" : "exact";
}

export function escapeLikePattern(term: string): string {
	return term
		.replaceAll("\\", "\\\\")
		.replaceAll("%", "\\%")
		.replaceAll("_", "\\_");
}

export function recordPattern(text: string, literal: LiteralMode): string {
	return literal === "regex" ? text : `%${escapeLikePattern(text)}%`;
}

export function recordKinds(kinds: readonly string[]): string[] {
	const searched = kinds.length > 0 ? [...kinds] : [...SEARCH_KINDS];
	return searched.includes("user_prompt")
		? [...searched, ...INJECTED_RECORD_KINDS]
		: searched;
}

export function recordMatchSql(
	literal: LiteralMode,
	bound: { text: string; pattern: string; snippetChars: number },
): { matched: string; partial: string; snippet: string } {
	const test = (column: string) =>
		literal === "regex"
			? `match(${column}, ${bound.pattern})`
			: `${column} ILIKE ${bound.pattern}`;
	const at = (column: string) =>
		literal === "regex"
			? `positionUTF8(${column}, regexpExtract(${column}, ${bound.pattern}, 0))`
			: `positionCaseInsensitiveUTF8(${column}, ${bound.text})`;
	const around = (column: string) =>
		`substringUTF8(${column}, greatest(1, toInt64(${at(column)}) - 80), ${bound.snippetChars})`;
	return {
		matched: `(${test("text")} OR (empty(text) AND ${test("head")}) OR ${test("tail")})`,
		partial:
			"(text_chars > if(empty(text), lengthUTF8(head), lengthUTF8(text)) + lengthUTF8(tail))",
		snippet: `multiIf(${test("text")}, ${around("text")}, empty(text) AND ${test("head")}, ${around("head")}, ${around("tail")})`,
	};
}
