import { ORPCError } from "@orpc/server";
import type { AnalysisPeekOutput } from "@rudel/api-routes";
import { cliHint, pullCommand } from "./cli-hint.js";

export const PEEK_INPUT = {
	type: "boolean",
	default: false,
	description:
		"true: load nothing; only count what this call would return (rows, groups, sessions, first and last time, the 5 largest groups or first 5 rows) and estimate its size and pages, with a suggestion how to load it. Fast and under 1,500 characters: peek before a call that may be large.",
} as const;

const PAGE_CHARS = 80_000;
const SMALL_CHARS = 20_000;

const ROW_CHARS: Record<string, number> = {
	runs: 420,
	runGroups: 260,
	tool: 1_400,
	sessions: 330,
	user: 650,
	git: 520,
	calls: 520,
	callGroups: 1_000,
	weekly: 450,
};

export interface FindPeekPlan {
	readonly query: string;
	readonly unit: string;
	readonly groupLabel: string;
	readonly estimate: (peek: AnalysisPeekOutput) => {
		rows: number;
		rowChars: number;
		upperBound: boolean;
	};
	readonly limit: number;
	readonly notApplied: string[];
	readonly suggestGroupBy?: string;
}

type Args = Record<string, unknown>;

export function isPeek(value: unknown): boolean {
	if (value === undefined || value === null || value === false) return false;
	if (value === true) return true;
	throw new ORPCError("BAD_REQUEST", {
		message: `peek must be true or false, not ${JSON.stringify(value)}`,
	});
}

export function sqlString(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function day(value: unknown, fallback: Date): string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
		? value
		: fallback.toISOString().slice(0, 10);
}

export function peekWindow(
	args: Args,
	now = new Date(),
): { from: string; to: string } {
	const to = day(args.to, now);
	const back = args.source === "weekly" ? 7 * 11 + 6 : 6;
	const from = day(
		args.from,
		new Date(Date.parse(`${to}T00:00:00Z`) - back * 86_400_000),
	);
	return { from, to };
}

const NOT_COUNTED = [
	"latest",
	"refs",
	"parentSessionId",
	"filters",
	"pullRequest",
	"commandSimhash",
	"cause",
	"kind",
	"detail",
	"toolGroup",
	"reaction",
];

const EXACT_CALLS_DAYS = 7;

export function findPeekPlan(
	args: Args,
	now = new Date(),
): FindPeekPlan | null {
	const source = String(args.source ?? "");
	if (source === "weekly") return null;
	const { from, to } = peekWindow(args, now);
	const days =
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
			86_400_000 +
		1;
	const groupBy = typeof args.groupBy === "string" ? args.groupBy : undefined;
	const exactCalls = source === "calls" && days <= EXACT_CALLS_DAYS;
	const view =
		source === "git"
			? { name: "git_events", time: "at" }
			: exactCalls
				? { name: "calls", time: "started_at" }
				: { name: "runs", time: "started_at" };
	const conditions = [
		`${view.time} >= toDateTime64(${sqlString(`${from} 00:00:00`)}, 3, 'UTC')`,
		`${view.time} < toDateTime64(${sqlString(`${to} 00:00:00`)}, 3, 'UTC') + INTERVAL 1 DAY`,
	];
	const notApplied = NOT_COUNTED.filter(
		(name) => args[name] !== undefined && args[name] !== null,
	);
	const equal = (column: string | null, value: unknown, name: string) => {
		if (typeof value !== "string" || value === "") return;
		if (column) conditions.push(`${column} = ${sqlString(value)}`);
		else notApplied.push(name);
	};
	const onRuns = view.name === "runs";
	equal("session_id", args.sessionId, "sessionId");
	equal("source", args.agent, "agent");
	equal(onRuns ? "repository" : null, args.repository, "repository");
	equal(onRuns ? "model" : null, args.model, "model");
	equal(exactCalls ? "command_class" : null, args.commandClass, "commandClass");
	equal(exactCalls ? "command_from" : null, args.commandFrom, "commandFrom");
	equal(exactCalls ? "command_argv0" : null, args.commandArgv0, "commandArgv0");
	equal(
		exactCalls ? "command_prefix" : null,
		args.commandPrefix,
		"commandPrefix",
	);
	equal(
		exactCalls ? "command_fingerprint" : null,
		args.commandFingerprint,
		"commandFingerprint",
	);
	if (exactCalls) conditions.push("command_from != ''");
	const weight =
		source === "tool"
			? "failed_calls"
			: source === "user"
				? "genuine_prompts"
				: source === "calls" && !exactCalls
					? "tool_calls"
					: "1";
	if (weight !== "1") conditions.push(`${weight} > 0`);
	const key =
		groupBy === "session" || source === "tool" || source === "user"
			? { expression: "session_id", label: "session" }
			: source === "runs"
				? groupBy === "week"
					? { expression: "toMonday(started_at)", label: "week" }
					: groupBy === "model"
						? { expression: "model", label: "model" }
						: groupBy === "agent"
							? { expression: "source", label: "agent" }
							: { expression: "repository", label: "repository" }
				: source === "git"
					? { expression: "kind", label: "kind" }
					: exactCalls && groupBy === "commandFingerprint"
						? { expression: "command_fingerprint", label: "fingerprint" }
						: exactCalls && groupBy === "commandPrefix"
							? { expression: "command_prefix", label: "prefix" }
							: exactCalls
								? { expression: "command_argv0", label: "program" }
								: { expression: "session_id", label: "session" };
	const query = `SELECT key, sum(w) AS n, uniqExact(session_id) AS sessions, min(t) AS first, max(t) AS last,
	any(all_sessions) AS total_sessions, sum(sum(w)) OVER () AS total_rows,
	min(min(t)) OVER () AS total_first, max(max(t)) OVER () AS total_last
FROM (
	SELECT toString(${key.expression}) AS key, session_id, ${view.time} AS t, toUInt64(${weight}) AS w,
		uniqExact(session_id) OVER () AS all_sessions
	FROM ${view.name}
	WHERE ${conditions.join("\n\t\tAND ")}
)
GROUP BY key
ORDER BY n DESC, key`;
	const limit =
		typeof args.limit === "number"
			? args.limit
			: source === "tool" && groupBy !== "session"
				? 20
				: 50;
	const total = (peek: AnalysisPeekOutput) =>
		Number(peek.head[0]?.total_rows ?? 0);
	const sessionRows = groupBy === "session" && key.label === "session";
	const estimate = (peek: AnalysisPeekOutput) => {
		if (sessionRows)
			return {
				rows: peek.rows,
				rowChars: ROW_CHARS.sessions ?? 0,
				upperBound: notApplied.length > 0 || source === "user",
			};
		if (source === "runs" && groupBy)
			return {
				rows: peek.rows,
				rowChars: ROW_CHARS.runGroups ?? 0,
				upperBound: false,
			};
		if (source === "tool")
			return {
				rows: Math.min(total(peek), 500),
				rowChars: ROW_CHARS.tool ?? 0,
				upperBound: true,
			};
		if (source === "calls")
			return {
				rows: groupBy && exactCalls ? peek.rows : total(peek),
				rowChars: (groupBy ? ROW_CHARS.callGroups : ROW_CHARS.calls) ?? 0,
				upperBound: !exactCalls || notApplied.length > 0,
			};
		return {
			rows: total(peek),
			rowChars: ROW_CHARS[source] ?? 500,
			upperBound: source === "user" || notApplied.length > 0,
		};
	};
	return {
		query,
		unit:
			source === "runs"
				? "runs"
				: source === "tool"
					? "failed calls"
					: source === "user"
						? "typed prompts (reactions are classified when loaded)"
						: source === "git"
							? "git events"
							: exactCalls
								? "commands"
								: `tool calls (commands are a subset; peeks of ${EXACT_CALLS_DAYS} days or less count commands exactly)`,
		groupLabel: key.label,
		estimate,
		limit,
		notApplied: notApplied.concat(
			source === "tool" && args.includeNoise !== true
				? ["noise (counted here, hidden by default)"]
				: [],
		),
		...(groupBy
			? {}
			: source === "runs"
				? { suggestGroupBy: "week, repository or session" }
				: source === "calls"
					? { suggestGroupBy: "commandFingerprint or session" }
					: source === "tool" || source === "user"
						? { suggestGroupBy: "session" }
						: {}),
	};
}

function short(value: unknown, max = 60): string {
	const text = (
		typeof value === "string" ? value : (JSON.stringify(value) ?? "")
	).replace(/\s+/gu, " ");
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function minute(value: unknown): string {
	return typeof value === "string" ? value.replace(" ", "T").slice(0, 16) : "?";
}

export function suggestion(input: {
	rows: number;
	chars: number;
	pages: number;
	days: number;
	suggestGroupBy?: string;
}): string {
	if (input.rows === 0)
		return "nothing matches: widen from/to or drop a filter before loading";
	if (input.chars <= SMALL_CHARS && input.pages <= 1)
		return "small: call again without peek";
	const parts: string[] = [];
	if (input.suggestGroupBy && input.pages > 1)
		parts.push(`use groupBy=${input.suggestGroupBy} to get one row per group`);
	if (input.days > 14 && input.chars > PAGE_CHARS) parts.push("narrow from/to");
	return parts.length
		? parts.join("; ")
		: `load it in ${input.pages} pages with the cursor`;
}

function hintLines(pages: number, command: string | null): string[] {
	return command && pages > 1 ? [cliHint(command)] : [];
}

export function renderFindPeek(
	args: Args,
	plan: FindPeekPlan,
	peek: AnalysisPeekOutput,
	now = new Date(),
): string {
	const { from, to } = peekWindow(args, now);
	const first = peek.head[0] ?? {};
	const total = Number(first.total_rows ?? 0);
	const sessions = Number(first.total_sessions ?? 0);
	const estimate = plan.estimate(peek);
	const chars = estimate.rows * estimate.rowChars;
	const pages = Math.max(
		Math.ceil(estimate.rows / plan.limit),
		Math.ceil(chars / PAGE_CHARS),
		estimate.rows ? 1 : 0,
	);
	const days =
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
			86_400_000 +
		1;
	const lines = [
		`peek find source=${String(args.source)}${args.groupBy ? ` groupBy=${String(args.groupBy)}` : ""} ${from}..${to}: ${total.toLocaleString("en-US")} ${plan.unit} in ${sessions.toLocaleString("en-US")} sessions${total ? `, ${minute(first.total_first)}..${minute(first.total_last)}` : ""}`,
		...(plan.notApplied.length
			? [`counted before: ${plan.notApplied.join(", ")}`]
			: []),
		`${peek.rows.toLocaleString("en-US")} groups by ${plan.groupLabel}; largest: ${peek.head
			.map(
				(row) =>
					`${short(row.key, 48) || "(none)"} ${Number(row.n).toLocaleString("en-US")}${plan.groupLabel === "session" ? "" : ` (${Number(row.sessions)} sessions)`}`,
			)
			.join("; ")}`,
		`full call: ${estimate.upperBound ? "at most " : "~"}${estimate.rows.toLocaleString("en-US")} rows × ~${estimate.rowChars} chars ≈ ${chars.toLocaleString("en-US")} chars; ${pages} page${pages === 1 ? "" : "s"} at limit ${plan.limit} (a page also stops at 80,000 chars)`,
		`suggest: ${suggestion({ rows: estimate.rows, chars, pages, days, ...(plan.suggestGroupBy ? { suggestGroupBy: plan.suggestGroupBy } : {}) })}`,
		...hintLines(pages, pullCommand({ repository: args.repository, from, to })),
		`peek: ${peek.ms} ms`,
	];
	return lines.join("\n");
}

export function renderSqlPeek(
	tool: "sql" | "measures" | "patterns" | "search",
	peek: AnalysisPeekOutput,
	shownRows: number,
	command: string | null,
): string {
	const pages = Math.ceil(peek.rows / shownRows);
	const avg = peek.rows ? Math.round(peek.chars / peek.rows) : 0;
	const head = peek.head.map((row) =>
		short(
			Object.values(row)
				.map((value) => short(value, 40))
				.join(" | "),
			220,
		),
	);
	return [
		`peek ${tool}: ${peek.rows.toLocaleString("en-US")} rows, ${peek.chars.toLocaleString("en-US")} chars as JSON (~${avg} a row); columns: ${short(peek.columns.join(", "), 300)}`,
		...(head.length ? [`first ${head.length} rows:`, ...head] : []),
		`full call: ${Math.min(peek.rows, shownRows)} rows shown of ${peek.rows.toLocaleString("en-US")}${pages > 1 ? `; the rest needs ${tool === "sql" ? "aggregating in SQL" : "narrower arguments"}` : ""}`,
		`suggest: ${suggestion({ rows: peek.rows, chars: peek.chars, pages, days: 0 })}`,
		...hintLines(pages, command),
		`peek: ${peek.ms} ms`,
	].join("\n");
}

export function searchPeekQuery(args: Args, now = new Date()): string {
	const filters = (args.filters ?? {}) as Record<string, unknown>;
	const since =
		typeof filters.since === "string"
			? Date.parse(`${filters.since}T00:00:00Z`)
			: now.getTime() - 29 * 86_400_000;
	const days = Math.min(
		180,
		Math.max(1, Math.ceil((now.getTime() - since) / 86_400_000) + 1),
	);
	return `SELECT * FROM search(${sqlString(String(args.text ?? ""))}, 'exact', ${sqlString(String(days))})`;
}
