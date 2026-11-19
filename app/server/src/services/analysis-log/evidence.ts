import { carriesText } from "../analysis/sql-guard.js";

/**
 * What a stored call returned from the sessions it read, for account
 * deletion (ADR 0001 as amended): a result that returned any text from them
 * (a prompt head, a quote, an excerpt, a command, a path) quotes them, and
 * deleting any member it read deletes its analysis; a result that returned
 * only numbers and ids counts them, and deleting a member removes the result
 * and keeps the analysis. Arguments that may carry text copied from a
 * transcript (an SQL literal, a command prefix) go with a removed result.
 *
 * Every check fails closed: a field, column value or argument not known to
 * be a number, time or id is text.
 */
export interface CallEvidence {
	/** The result returned only numbers and ids from the sessions it read. */
	counts: boolean;
	/**
	 * For a counting call whose arguments may carry transcript text: the
	 * arguments without them, kept once the result is removed. Null when no
	 * argument does (or the call quotes, so its analysis goes whole).
	 */
	keptArgs: Record<string, unknown> | null;
}

/**
 * `quotes` is the sql gateway's verdict on the rows it showed (`rowsQuote`);
 * the stored sql output holds only the rendered table. Find and read are
 * judged from their output.
 */
export function classifyCall(call: {
	tool: "find" | "read" | "sql";
	args: Record<string, unknown>;
	output: unknown;
	quotes?: boolean;
}): CallEvidence {
	const counts =
		call.tool === "find"
			? !findQuotes(call.output)
			: call.tool === "sql"
				? call.quotes === false
				: false;
	if (!counts) return { counts, keptArgs: null };
	const kept = Object.fromEntries(
		Object.entries(call.args).filter(([key, value]) =>
			call.tool === "sql"
				? key === "title" ||
					(key === "query" && typeof value === "string" && !carriesText(value))
				: FIND_PLAIN_ARGS.has(key),
		),
	);
	return {
		counts,
		keptArgs:
			Object.keys(kept).length === Object.keys(call.args).length ? null : kept,
	};
}

/**
 * Whether sql result rows carry text: any string that is not empty, a number,
 * a date or time, or an id (one of `ids`, a UUID, or a hex id such as a
 * commit). Map keys count as values.
 */
export function rowsQuote(
	rows: readonly Record<string, unknown>[],
	ids: ReadonlySet<string>,
): boolean {
	const quotes = (value: unknown): boolean => {
		if (typeof value === "string") return !isPlainValue(value, ids);
		if (Array.isArray(value)) return value.some(quotes);
		if (value && typeof value === "object")
			return Object.entries(value).some(
				([key, item]) => quotes(key) || quotes(item),
			);
		return false;
	};
	return rows.some((row) => Object.values(row).some(quotes));
}

/** Find arguments that never carry transcript text: enums, dates, numbers and ids. */
const FIND_PLAIN_ARGS: ReadonlySet<string> = new Set([
	"source",
	"from",
	"to",
	"latest",
	"repository",
	"agent",
	"model",
	"sessionId",
	"userId",
	"toolGroup",
	"kind",
	"includeNoise",
	"commandFrom",
	"commandFingerprint",
	"commandSimhash",
	"reaction",
	"groupBy",
	"refs",
	"limit",
	"sort",
	"pullRequest",
]);

/**
 * Find result fields that hold metadata, never transcript text: ids, times,
 * the repository, model and agent, and fixed vocabularies. `key` is a run
 * group's key, which groups by week, model, repository, agent or session.
 */
const FIND_PLAIN_FIELDS: ReadonlySet<string> = new Set([
	"sessionId",
	"agentId",
	"parentSessionId",
	"startedAt",
	"at",
	"firstSeen",
	"lastSeen",
	"model",
	"models",
	"repository",
	"agent",
	"type",
	"nextReaction",
	"week",
	"member",
	"commandFrom",
	"commandFingerprint",
	"commandSimhash",
]);

/** The server writes a find's header and snapshot; everything else comes from the sessions. */
const FIND_SERVER_FIELDS: ReadonlySet<string> = new Set([
	"source",
	"header",
	"snapshot",
	"trace",
]);

function findQuotes(output: unknown): boolean {
	if (!output || typeof output !== "object" || Array.isArray(output))
		return true;
	const runGroups = (output as { source?: unknown }).source === "runs";
	const quotes = (value: unknown, key: string): boolean => {
		if (typeof value === "string")
			return (
				value !== "" &&
				!FIND_PLAIN_FIELDS.has(key) &&
				!(runGroups && key === "key")
			);
		if (Array.isArray(value)) return value.some((item) => quotes(item, key));
		if (value && typeof value === "object")
			return Object.entries(value).some(([field, item]) => quotes(item, field));
		return false;
	};
	return Object.entries(output).some(
		([field, value]) => !FIND_SERVER_FIELDS.has(field) && quotes(value, field),
	);
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const TIME =
	/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** A hex id of at least 7 characters with a digit: a commit, a hash, a subagent id. */
const HEX_ID = /^(?=[a-f]*\d)[0-9a-f]{7,64}$/iu;

function isPlainValue(value: string, ids: ReadonlySet<string>): boolean {
	return (
		value === "" ||
		ids.has(value) ||
		NUMBER.test(value) ||
		TIME.test(value) ||
		UUID.test(value) ||
		HEX_ID.test(value) ||
		["nan", "inf", "-inf", "+inf"].includes(value.toLowerCase())
	);
}
