import { sqlString } from "../analysis/retro-measure-sql.js";
import { agentRows, type CliDataContext } from "./statements.js";

export interface VisibleSession {
	readonly sessionId: string;
	readonly userId: string;
	readonly source: string;
	readonly firstStart: string;
	readonly repository: string;
}

export const ID_LIST_BATCH = 1000;

export function inList(values: readonly string[]): string {
	return `(${values.map(sqlString).join(", ")})`;
}

export function batches<T>(values: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let index = 0; index < values.length; index += size)
		out.push(values.slice(index, index + size));
	return out;
}

export function isoTime(value: unknown): string {
	const text = String(value ?? "");
	return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/u.test(text)
		? `${text.replace(" ", "T")}Z`
		: text;
}

export function sessionSummarySql(where: readonly string[]): string {
	return `SELECT session_id, any(user_id) AS owner_id, any(source) AS session_source,
		min(started_at) AS first_start, anyIf(repository, repository != '') AS session_repository
		FROM runs
		WHERE ${where.length > 0 ? where.join(" AND ") : "1"}
		GROUP BY session_id`;
}

export function toVisible(row: Record<string, unknown>): VisibleSession {
	return {
		sessionId: String(row.session_id),
		userId: String(row.owner_id ?? ""),
		source: String(row.session_source ?? ""),
		firstStart: String(row.first_start ?? ""),
		repository: String(row.session_repository ?? ""),
	};
}

export async function visibleSessions(
	context: CliDataContext,
	sessionIds: readonly string[],
): Promise<VisibleSession[]> {
	const found: VisibleSession[] = [];
	for (const batch of batches([...new Set(sessionIds)], ID_LIST_BATCH))
		for (const row of await agentRows(
			context,
			`${sessionSummarySql([`session_id IN ${inList(batch)}`])} ORDER BY session_id`,
		))
			found.push(toVisible(row));
	return found.sort(bySessionId);
}

export function bySessionId(
	left: { readonly sessionId: string },
	right: { readonly sessionId: string },
): number {
	return left.sessionId < right.sessionId
		? -1
		: left.sessionId > right.sessionId
			? 1
			: 0;
}
