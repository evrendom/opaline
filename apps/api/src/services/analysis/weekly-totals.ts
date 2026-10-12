import { ORPCError } from "@orpc/server";
import {
	type AnalysisFindInput,
	type AnalysisFindOutput,
	type AnalysisWeeklyTotals,
	findLimit,
	WEEKLY_MEASURES,
	WEEKLY_NULLABLE_MEASURES,
	type WeeklyMeasure,
} from "@rudel/api-routes";
import {
	WEEKLY_TOTALS_MEASURES,
	WEEKLY_TOTALS_TABLE,
	weeklyTotalsSnapshotSql,
} from "@rudel/ch-schema/weekly-totals";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { CLASSIFIER_VERSION } from "./failure-classifier.js";
import {
	type CursorKey,
	type CursorOrder,
	readFindCursor,
	takePage,
	writeFindCursor,
} from "./find-cursor.js";
import type { AnalysisScope } from "./scope.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./sql.js";

/**
 * `find source=weekly` (docs/l1-literal-schema.md, "Weekly totals"): sums of
 * the run index per member, agent and ISO week, read from the newest
 * complete nightly snapshot of `rudel.weekly_totals` instead of scanning
 * runs, so a team-wide question over months is one lookup. A cursor keeps
 * reading the snapshot its first page read.
 */

/** Weeks a call covers when `from` is absent: the week of `to` and the 11 before it. */
export const WEEKLY_DEFAULT_WEEKS = 12;
const DAY_MS = 86_400_000;

/** `cache_write_5m_input_tokens` → `cacheWrite5mInputTokens`. */
export function measureKey(column: string): WeeklyMeasure | "sessions" {
	return column.replace(/_([a-z0-9])/gu, (_, next: string) =>
		next.toUpperCase(),
	) as WeeklyMeasure | "sessions";
}

const COLUMNS = WEEKLY_TOTALS_MEASURES.filter(
	(measure) => measure.name !== "sessions",
);
/** Each `…KnownRuns` measure with the gated measures whose runs it counts. */
const KNOWN_GROUPS = new Map<string, string[]>();
for (const measure of COLUMNS)
	if (measure.known)
		KNOWN_GROUPS.set(measureKey(measure.known), [
			...(KNOWN_GROUPS.get(measureKey(measure.known)) ?? []),
			measureKey(measure.name),
		]);
const FLOATS = new Set<WeeklyMeasure>([
	"minutes",
	"activeMinutes",
	"costUsd",
	"unattributedCostUsd",
]);

const SnapshotSchema = z.object({
	refresh_id: z.string(),
	refreshed_text: z.string(),
});
const count = z.coerce.number();
const WeeklyRowSchema = z.object({
	user_id: z.string(),
	agent: z.enum(["claude_code", "codex"]),
	week: z.string(),
	sessions: count,
	...Object.fromEntries(
		COLUMNS.map((measure) => [
			measure.name,
			measure.type.startsWith("Nullable(") ? count.nullable() : count,
		]),
	),
});
type WeeklyRow = {
	user_id: string;
	agent: "claude_code" | "codex";
	week: string;
	sessions: number;
} & Record<string, number | null>;

/** The newest complete snapshot, or the one `refreshId` names while it is complete and kept. */
export function buildWeeklySnapshotStatement(
	refreshId?: string,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: weeklyTotalsSnapshotSql(
			getSafeClickHouseTable(WEEKLY_TOTALS_TABLE),
			refreshId !== undefined,
		),
		query_params: refreshId === undefined ? {} : { refreshId },
	};
}

/**
 * The snapshot's rows of the workspace in the weeks from the Monday of
 * `fromWeek` through `to`: only the caller's own unless `userId` is null (a
 * workspace admin across members).
 */
export function buildWeeklyRowsStatement(options: {
	organizationId: string;
	userId: string | null;
	refreshId: string;
	fromWeek: string;
	to: string;
	agent?: "claude_code" | "codex";
}): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT user_id, agent, toString(week) AS week, sessions,
				${COLUMNS.map((measure) => measure.name).join(", ")}
			FROM ${getSafeClickHouseTable(WEEKLY_TOTALS_TABLE)}
			WHERE organization_id = {organizationId:String}
				AND refresh_id = {refreshId:String}
				AND week >= {fromWeek:Date} AND week <= {to:Date}${
					options.userId === null
						? ""
						: "\n\t\t\t\tAND user_id = {userId:String}"
				}${options.agent === undefined ? "" : "\n\t\t\t\tAND agent = {agent:String}"}
			ORDER BY week DESC, user_id, agent`,
		query_params: {
			organizationId: options.organizationId,
			refreshId: options.refreshId,
			fromWeek: options.fromWeek,
			to: options.to,
			...(options.userId === null ? {} : { userId: options.userId }),
			...(options.agent === undefined ? {} : { agent: options.agent }),
		},
	};
}

/** Monday (UTC) of the ISO week holding `day` (YYYY-MM-DD). */
export function mondayOf(day: string): string {
	const date = new Date(`${day}T00:00:00Z`);
	return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS)
		.toISOString()
		.slice(0, 10);
}

/** The weeks a call covers: whole ISO weeks from the Monday on or before `from` through the week of `to`. */
export function weeklyRange(
	input: Pick<AnalysisFindInput, "from" | "to">,
	today = new Date().toISOString().slice(0, 10),
): { fromWeek: string; to: string } {
	const to = input.to ?? today;
	const from =
		input.from ??
		new Date(
			new Date(`${mondayOf(to)}T00:00:00Z`).getTime() -
				(WEEKLY_DEFAULT_WEEKS - 1) * 7 * DAY_MS,
		)
			.toISOString()
			.slice(0, 10);
	return { fromWeek: mondayOf(from), to };
}

/**
 * The rows summed per `groupBy` key (week, member or agent), or as stored
 * (one per week, member and agent). A sum of a measure some rows cannot
 * know covers the rows that can, and is null only when none can; `sessions`
 * is null for a row spanning several weeks, where a session could count more
 * than once.
 */
export function weeklyTotals(
	rows: readonly WeeklyRow[],
	groupBy: AnalysisFindInput["groupBy"],
): AnalysisWeeklyTotals[] {
	const groups = new Map<
		string,
		{ total: AnalysisWeeklyTotals; weeks: Set<string> }
	>();
	for (const row of rows) {
		const key =
			groupBy === "week"
				? row.week
				: groupBy === "member"
					? row.user_id
					: groupBy === "agent"
						? row.agent
						: `${row.week}\u0000${row.user_id}\u0000${row.agent}`;
		let group = groups.get(key);
		if (!group) {
			group = {
				weeks: new Set(),
				total: {
					week: groupBy === undefined || groupBy === "week" ? row.week : null,
					member:
						groupBy === undefined || groupBy === "member" ? row.user_id : null,
					agent:
						groupBy === undefined || groupBy === "agent" ? row.agent : null,
					weeks: 0,
					sessions: 0,
					...(Object.fromEntries(WEEKLY_MEASURES.map((name) => [name, 0])) as {
						[K in (typeof WEEKLY_MEASURES)[number]]: number;
					}),
					...(Object.fromEntries(
						WEEKLY_NULLABLE_MEASURES.map((name) => [name, null]),
					) as { [K in (typeof WEEKLY_NULLABLE_MEASURES)[number]]: null }),
				},
			};
			groups.set(key, group);
		}
		const { total } = group;
		group.weeks.add(row.week);
		total.sessions = (total.sessions ?? 0) + row.sessions;
		for (const measure of COLUMNS) {
			const name = measureKey(measure.name) as WeeklyMeasure;
			const value = row[measure.name] ?? null;
			if (value === null) continue;
			// No run of the row can record it: unknown, whatever was stored (a
			// snapshot taken before the known-runs column existed holds 0 runs).
			if (measure.known && !row[measure.known]) continue;
			const totals = total as Record<WeeklyMeasure, number | null>;
			totals[name] = (totals[name] ?? 0) + value;
		}
	}
	return [...groups.values()].map(({ total, weeks }) => {
		const rounded = { ...total, weeks: weeks.size } as AnalysisWeeklyTotals &
			Record<WeeklyMeasure, number | null>;
		if (weeks.size > 1) rounded.sessions = null;
		for (const name of FLOATS) {
			const value = rounded[name];
			if (value !== null) rounded[name] = Math.round(value * 10_000) / 10_000;
		}
		return rounded;
	});
}

/** Sort order of the totals; the snapshot id comes first, so a cursor names it. */
export function weeklyOrder(
	groupBy: AnalysisFindInput["groupBy"],
): CursorOrder {
	if (groupBy === undefined) return ["asc", "desc", "asc", "asc"];
	return groupBy === "week" ? ["asc", "desc"] : ["asc", "desc", "asc"];
}

function weeklyKey(
	refreshId: string,
	groupBy: AnalysisFindInput["groupBy"],
): (total: AnalysisWeeklyTotals) => CursorKey {
	if (groupBy === undefined)
		return (total) => [refreshId, total.week, total.member, total.agent];
	if (groupBy === "week") return (total) => [refreshId, total.week];
	return (total) => [
		refreshId,
		total.runs,
		groupBy === "member" ? total.member : total.agent,
	];
}

/**
 * The weekly totals of the scope (newest week first, or the busiest group
 * first), one page of them, every member whose rows were read, and the sort
 * key of each item for the output ceiling's cursors.
 */
export async function findWeeklyTotals(
	executor: ClickHouseExecutor,
	scope: AnalysisScope,
	input: AnalysisFindInput,
	today?: string,
): Promise<{
	output: AnalysisFindOutput;
	owners: string[];
	keys: CursorKey[];
}> {
	const order = weeklyOrder(input.groupBy);
	const after = readFindCursor(input, order);
	const pinned = after === undefined ? undefined : String(after[0]);
	const { fromWeek, to } = weeklyRange(input, today);
	const header: AnalysisFindOutput["header"] = {
		from: fromWeek,
		to,
		sessionsInScope: 0,
		indexedSessions: 0,
		runsInScope: 0,
		minutes: 0,
		activeMinutes: 0,
		pricedCostUsd: 0,
		unattributedCostUsd: 0,
		unpricedRuns: 0,
		rawChars: 0,
		truncated: false,
		notes: [],
		classifierVersion: CLASSIFIER_VERSION,
	};
	const [snapshot] = await query(
		executor,
		SnapshotSchema,
		buildWeeklySnapshotStatement(pinned),
	);
	if (!snapshot) {
		if (pinned !== undefined)
			throw new ORPCError("BAD_REQUEST", {
				message:
					"cursor: the weekly snapshot it pages through was replaced and has expired; omit cursor to start from the first page of the newest snapshot",
			});
		header.notes.push(
			"weekly totals have no snapshot yet (the first refresh runs when the view is created, then nightly at 03:00 UTC); use source=runs groupBy=week meanwhile",
		);
		return {
			output: { source: "weekly", header, snapshot: null, totals: [] },
			owners: [],
			keys: [],
		};
	}
	const rows = (await query(
		executor,
		WeeklyRowSchema,
		buildWeeklyRowsStatement({
			organizationId: scope.organizationId,
			userId: scope.userId,
			refreshId: snapshot.refresh_id,
			fromWeek,
			to,
			agent: input.agent,
		}),
	)) as WeeklyRow[];
	const all = weeklyTotals(rows, input.groupBy);
	const keyOf = weeklyKey(snapshot.refresh_id, input.groupBy);
	const { page, more } = takePage(all, keyOf, order, after, findLimit(input));
	const refreshedAt = `${snapshot.refreshed_text.replace(" ", "T").slice(0, 23)}Z`;
	addHeader(header, weeklyTotals(rows, "agent"), refreshedAt, input);
	header.truncated = more;
	const keys = page.map(keyOf);
	const last = keys.at(-1);
	if (more && last) header.cursor = writeFindCursor(input, last);
	return {
		output: {
			source: "weekly",
			header,
			snapshot: { id: snapshot.refresh_id, refreshedAt },
			totals: page,
		},
		owners: [...new Set(rows.map((row) => row.user_id))].sort(),
		keys,
	};
}

/** Header totals over every row read (all pages), and notes that apply to this answer. */
function addHeader(
	header: AnalysisFindOutput["header"],
	byAgent: readonly AnalysisWeeklyTotals[],
	refreshedAt: string,
	input: AnalysisFindInput,
): void {
	const sum = (pick: (total: AnalysisWeeklyTotals) => number | null) =>
		byAgent.reduce((total, row) => total + (pick(row) ?? 0), 0);
	const runs = sum((row) => row.runs);
	const usageKnown = sum((row) => row.usageKnownRuns);
	header.runsInScope = runs;
	header.sessionsInScope = sum((row) => row.sessionsStarted);
	header.indexedSessions = header.sessionsInScope;
	header.minutes = Math.round(sum((row) => row.minutes) * 10_000) / 10_000;
	header.activeMinutes =
		Math.round(sum((row) => row.activeMinutes) * 10_000) / 10_000;
	header.pricedCostUsd =
		Math.round(sum((row) => row.costUsd) * 10_000) / 10_000;
	header.unattributedCostUsd =
		Math.round(sum((row) => row.unattributedCostUsd) * 10_000) / 10_000;
	header.unpricedRuns = runs - usageKnown;
	const lastMonday = mondayOf(header.to);
	header.notes.push(
		`nightly snapshot of ${refreshedAt}: the runs indexed by then, summed per member, agent and ISO week (Monday, UTC) from ${header.from} through the week of ${lastMonday}; runs indexed later appear after the next refresh at 03:00 UTC`,
		"sessionsInScope counts sessions whose first run falls in these weeks",
	);
	const snapshotWeek = mondayOf(refreshedAt.slice(0, 10));
	if (snapshotWeek >= header.from && snapshotWeek <= lastMonday)
		header.notes.push(
			`the week of ${snapshotWeek} is partial: it holds runs up to ${refreshedAt}`,
		);
	if (input.groupBy === "member" || input.groupBy === "agent")
		header.notes.push(
			"sessions is null for rows that span several weeks, since a session can run in more than one; sessionsStarted adds up",
		);
	if (usageKnown < runs)
		header.notes.push(
			`usage is unknown for ${runs - usageKnown} of ${runs} runs (their session's usage extraction was incomplete): costUsd and tokens leave them out, and unpricedRuns counts them`,
		);
	const partial = [...KNOWN_GROUPS]
		.map(([known, measures]) => ({
			measures,
			known: sum((row) => row[known as WeeklyMeasure]),
		}))
		.filter(({ known }) => known < runs);
	if (partial.length > 0)
		header.notes.push(
			`a sum of a fact that not every run can record covers only the runs that can (its …KnownRuns), and is null when none can: ${partial
				.map(
					({ measures, known }) => `${measures.join("/")} ${known} of ${runs}`,
				)
				.join(", ")}`,
		);
}
