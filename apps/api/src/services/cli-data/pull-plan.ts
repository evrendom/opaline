import { ORPCError } from "@orpc/server";
import {
	CLI_DATA_LIMITS,
	type CliDataPullPlanInput,
	type CliDataPullPlanOutput,
} from "@rudel/api-routes/cli-data";
import { patternStatement } from "../../handlers/analysis/pattern-statement.js";
import { sqlString } from "../analysis/retro-measure-sql.js";
import { partRows } from "../analysis/sql-gateway.js";
import { recordSizes } from "./records.js";
import {
	agentRows,
	asCliDataError,
	type CliDataContext,
	ExportRefused,
	type Row,
} from "./statements.js";
import {
	batches,
	bySessionId,
	ID_LIST_BATCH,
	inList,
	isoTime,
	sessionSummarySql,
	toVisible,
	type VisibleSession,
} from "./visible.js";

const PATTERN_DRILL_ROWS = 200;
const PATTERN_LIST_ROWS = 100;

interface Evidence {
	readonly scope: { repository: string | null; from: string; to: string };
	readonly pattern: Row | null;
	readonly runs: Row[];
	readonly notices: string[];
}

async function patternEvidence(
	context: CliDataContext,
	id: string,
	input: CliDataPullPlanInput,
	today: Date,
): Promise<Evidence> {
	const scope = {
		...(input.from ? { from: input.from } : {}),
		...(input.to ? { to: input.to } : {}),
		...(input.repository ? { repository: input.repository } : {}),
	};
	const drill = patternStatement(
		{ action: "drill", ...scope, id, limit: PATTERN_DRILL_ROWS },
		today,
	);
	const list = patternStatement(
		{ action: "list", ...scope, minCount: 1, limit: PATTERN_LIST_ROWS },
		today,
	);
	const notices: string[] = [];
	const run = async (statement: typeof drill) => {
		const outcome = await partRows(
			context.caller,
			statement,
			context.env,
			context.signal,
		);
		if (!outcome.ok) throw new ExportRefused(outcome.error);
		notices.push(...outcome.notices);
		return outcome.value;
	};
	const runs = await run(drill);
	const { from, to } = drill.measure;
	if (runs.length === 0)
		throw new ORPCError("PATTERN_NOT_FOUND", {
			status: 404,
			message: `Pattern ${id} has no runs from ${from} to ${to}${input.repository ? ` in ${input.repository}` : ""}. Pass the repository, from and to of the patterns call that listed it.`,
			data: { pattern: id, from, to },
		});
	const pattern = (await run(list)).find((row) => row.id === id) ?? null;
	return {
		scope: { repository: input.repository ?? null, from, to },
		pattern,
		runs,
		notices: [...new Set(notices)],
	};
}

function selectionWhere(input: CliDataPullPlanInput): string[] {
	if (input.pattern) return [];
	return [
		...(input.repository
			? [
					`(repository = ${sqlString(input.repository)} OR endsWith(repository, ${sqlString(`/${input.repository}`)}))`,
				]
			: []),
		...(input.from
			? [
					`session_date >= toDateTime64(${sqlString(`${input.from} 00:00:00`)}, 3, 'UTC')`,
				]
			: []),
		...(input.to
			? [
					`session_date < toDateTime64(${sqlString(`${input.to} 00:00:00`)}, 3, 'UTC') + INTERVAL 1 DAY`,
				]
			: []),
	];
}

function pullTooLarge(sessions: number): ORPCError<string, unknown> {
	return new ORPCError("PULL_TOO_LARGE", {
		status: 413,
		message: `The pull selects ${sessions.toLocaleString("en-US")} sessions; one pull takes at most ${CLI_DATA_LIMITS.planSessions.toLocaleString("en-US")}. Narrow it: a shorter --from/--to, a --repo, or fewer --sessions.`,
		data: { sessions, maxSessions: CLI_DATA_LIMITS.planSessions },
	});
}

async function selectSessions(
	context: CliDataContext,
	where: readonly string[],
	listed: readonly string[] | null,
): Promise<VisibleSession[]> {
	const cap = CLI_DATA_LIMITS.planSessions;
	if (listed === null) {
		const rows = await agentRows(
			context,
			`${sessionSummarySql(where)} ORDER BY first_start, session_id LIMIT ${cap + 1}`,
		);
		if (rows.length <= cap) return rows.map(toVisible);
		const [counted] = await agentRows(
			context,
			`SELECT uniqExact(session_id) AS sessions FROM runs WHERE ${where.join(" AND ")}`,
		);
		throw pullTooLarge(Number(counted?.sessions ?? rows.length));
	}
	const found: VisibleSession[] = [];
	for (const batch of batches(listed, ID_LIST_BATCH))
		for (const row of await agentRows(
			context,
			sessionSummarySql([...where, `session_id IN ${inList(batch)}`]),
		))
			found.push(toVisible(row));
	if (found.length > cap) throw pullTooLarge(found.length);
	return found;
}

export async function pullPlan(
	context: CliDataContext,
	workspace: { id: string; slug: string },
	input: CliDataPullPlanInput,
	today: Date = new Date(),
): Promise<CliDataPullPlanOutput> {
	try {
		const notices: string[] = [];
		let scope: CliDataPullPlanOutput["scope"] = {
			repository: input.repository ?? null,
			from: input.from ?? null,
			to: input.to ?? null,
		};
		let listed: string[] | null = input.sessions ? [...input.sessions] : null;
		let pattern: unknown = null;
		if (input.pattern) {
			const evidence = await patternEvidence(
				context,
				input.pattern,
				input,
				today,
			);
			scope = evidence.scope;
			notices.push(...evidence.notices);
			const behind = [
				...new Set(evidence.runs.map((run) => String(run.session_id))),
			];
			const asked = listed ? new Set(listed) : null;
			listed = asked ? behind.filter((id) => asked.has(id)) : behind;
			pattern = {
				id: input.pattern,
				scope: evidence.scope,
				pattern: evidence.pattern,
				sessions: behind,
				runs: evidence.runs.map(({ pattern: _about, ...run }) => run),
			};
		}
		const selected =
			listed !== null && listed.length === 0
				? []
				: await selectSessions(context, selectionWhere(input), listed);
		if (input.sessions && !input.pattern) {
			const missing = input.sessions.length - selected.length;
			if (missing > 0)
				notices.push(
					`${missing} of ${input.sessions.length} listed sessions are not indexed, outside the selection or not yours to read; they are left out.`,
				);
		}
		if (selected.length === 0)
			notices.push(
				`No sessions match${input.repository ? " (repositories are keyed like github.com/owner/name; the last parts match too)" : ""}.`,
			);
		const sizes = selected.length
			? await recordSizes(context, selected)
			: new Map<string, { records: number; bytes: number }>();
		const sessions = [...selected]
			.sort(
				(left, right) =>
					(left.firstStart < right.firstStart
						? -1
						: left.firstStart > right.firstStart
							? 1
							: 0) || bySessionId(left, right),
			)
			.map((session) => ({
				sessionId: session.sessionId,
				source: session.source,
				startedAt: isoTime(session.firstStart),
				records: sizes.get(session.sessionId)?.records ?? 0,
				bytes: sizes.get(session.sessionId)?.bytes ?? 0,
			}));
		const unrecorded = sessions.filter((session) => session.records === 0);
		if (unrecorded.length > 0)
			notices.push(
				`${unrecorded.length} sessions have no stored records in their committed build; their records table is empty.`,
			);
		return { workspace, scope, sessions, pattern, notices };
	} catch (error) {
		throw asCliDataError(error, context);
	}
}
