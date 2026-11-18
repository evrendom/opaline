import type { RunRef } from "@rudel/api-routes";
import {
	FINDING_RUNS_MEASURES,
	FINDING_RUNS_TABLE,
} from "@rudel/ch-schema/finding-runs";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	chunkByParamBytes,
	query,
	REF_RUNS_SQL,
	refParams,
} from "../analysis/sql.js";
import { findSqlView, SQL_SCOPE_PARAMS } from "../analysis/sql-views.js";
import { purgeClickHouseRows } from "../org-session.service.js";
import { type FindingImpact, runKey } from "./finding-impact.js";

/**
 * The deletion fence (`clickhouse-purge-tombstone.service.ts`): which of
 * these accounts, and whether the workspace, have a purge job. Rows of a
 * purged account or workspace are never written; the purge's follow-up pass
 * removes what a write already in flight published.
 */
export type FindingImpactFence = (target: {
	workspaceId: string;
	accounts: readonly string[];
}) => Promise<{ workspace: boolean; accounts: ReadonlySet<string> }>;

/** The fence over `clickhouse_purge_job`, the purge's tombstone. */
export function createPostgresFindingImpactFence(
	database: postgres.Sql,
): FindingImpactFence {
	return async ({ workspaceId, accounts }) => {
		const rows = await database<{ target_type: string; target_id: string }[]>`
			SELECT DISTINCT target_type, target_id FROM clickhouse_purge_job
			WHERE (target_type = 'account' AND target_id = ANY(${[...accounts]}))
				OR (target_type = 'organization' AND target_id = ${workspaceId})
		`;
		return {
			workspace: rows.some((row) => row.target_type === "organization"),
			accounts: new Set(
				rows
					.filter((row) => row.target_type === "account")
					.map((row) => row.target_id),
			),
		};
	};
}

/** Rows in ClickHouse, read by the runs view's statement for the cited runs. */
export function createClickHouseFindingImpact(
	executor: ClickHouseExecutor,
	fence: FindingImpactFence,
): FindingImpact {
	return {
		async record(saved) {
			const cited = new Map<string, RunRef>();
			for (const citation of saved.citations)
				for (const run of citation.runs) cited.set(runKey(run), run);
			if (cited.size === 0) return;
			const measures = new Map<string, MeasureRow>();
			for (const chunk of chunkByParamBytes([...cited.values()], (run) => [
				run.sessionId,
				run.agentId,
				run.turn,
			]))
				for (const row of await readMeasures(
					executor,
					saved.workspaceId,
					saved.onlyMember,
					chunk,
				))
					measures.set(
						runKey({
							sessionId: row.session_id,
							agentId: row.agent_id,
							turn: row.turn_idx,
						}),
						row,
					);
			// Nothing of a purged workspace, author or quoted member, and no run
			// of a purged member.
			const purged = await fence({
				workspaceId: saved.workspaceId,
				accounts: [
					saved.authorId,
					...saved.quotedOwners,
					...[...measures.values()].map((row) => row.user_id),
				],
			});
			if (
				purged.workspace ||
				purged.accounts.has(saved.authorId) ||
				saved.quotedOwners.some((owner) => purged.accounts.has(owner))
			)
				return;
			const values = saved.citations.flatMap((citation) =>
				citation.runs.flatMap((run) => {
					const measured = measures.get(runKey(run));
					return measured && !purged.accounts.has(measured.user_id)
						? [
								{
									organization_id: saved.workspaceId,
									analysis_id: saved.analysisId,
									step_id: citation.stepId,
									finding: citation.finding,
									author_id: saved.authorId,
									shared: saved.visibility.shared ? 1 : 0,
									visibility_revision: saved.visibility.revision,
									quoted_owners: saved.quotedOwners,
									saved_at: clickHouseTime(saved.savedAt),
									...measured,
								},
							]
						: [];
				}),
			);
			if (values.length === 0) return;
			await executor.insert({
				table: getSafeClickHouseTable(FINDING_RUNS_TABLE),
				asyncInsert: false,
				values,
			});
		},
		async share(analysis, { shared, revision }) {
			const table = getSafeClickHouseTable(FINDING_RUNS_TABLE);
			// The rows again at this revision; FINAL reads the highest, so a
			// write of an older revision landing later changes nothing. The
			// filter sits in a subquery: beside the REPLACE alias of the same
			// name it would compare the new revision, not the stored one.
			await executor.execute({
				query: `INSERT INTO ${table}
					SELECT * REPLACE (
						{shared:UInt8} AS shared,
						{revision:UInt64} AS visibility_revision
					)
					FROM (
						SELECT * FROM ${table} FINAL
						WHERE organization_id = {workspaceId:String}
							AND analysis_id = {analysisId:String}
							AND visibility_revision < {revision:UInt64}
					)`,
				query_params: {
					shared: shared ? 1 : 0,
					revision,
					workspaceId: analysis.workspaceId,
					analysisId: analysis.analysisId,
				},
			});
		},
	};
}

/**
 * Account deletion: the rows of the account's analyses and of every analysis
 * its deletion deletes (`quoted_owners`: a query of it quoted the account's
 * sessions, or a finding's result names one; ADR 0001 as amended). The rows of its own runs
 * go with the other owner-keyed tables (`getClickHouseSessionPurgePlans`).
 */
export async function purgeFindingImpact(target: {
	targetType: "account" | "organization";
	targetId: string;
}): Promise<void> {
	if (target.targetType !== "account") return;
	await purgeClickHouseRows(
		FINDING_RUNS_TABLE,
		"author_id = {targetId:String} OR has(quoted_owners, {targetId:String})",
		{ targetId: target.targetId },
	);
}

const MeasureRowSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	started_at: z.string(),
	minutes: z.number(),
	active_minutes: z.number(),
	cost_usd: z.number().nullable(),
	// UInt64 arrives quoted; it is written back as it came.
	uncached_input_tokens: z.union([z.string(), z.number()]).nullable(),
	cache_read_input_tokens: z.union([z.string(), z.number()]).nullable(),
	cache_write_5m_input_tokens: z.union([z.string(), z.number()]).nullable(),
	cache_write_1h_input_tokens: z.union([z.string(), z.number()]).nullable(),
	output_tokens: z.union([z.string(), z.number()]).nullable(),
	reasoning_output_tokens: z.union([z.string(), z.number()]).nullable(),
	unrecorded_facts: z.array(z.string()),
});
type MeasureRow = z.infer<typeof MeasureRowSchema>;
// The writer copies exactly the run index measures the table defines.
if (
	JSON.stringify(Object.keys(MeasureRowSchema.shape)) !==
	JSON.stringify([
		"user_id",
		"session_id",
		"agent_id",
		"turn_idx",
		...FINDING_RUNS_MEASURES,
	])
)
	throw new Error("Finding impact measures differ from FINDING_RUNS_MEASURES");

/**
 * The cited runs' measures from each session's committed build, as `runs`
 * shows them to the saver: only `onlyMember`'s runs when the saver reads
 * only their own sessions.
 */
function readMeasures(
	executor: ClickHouseExecutor,
	workspaceId: string,
	onlyMember: string | null,
	runs: readonly RunRef[],
): Promise<MeasureRow[]> {
	const view = findSqlView("runs");
	if (!view) throw new Error("The runs view is missing");
	return query(executor, MeasureRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT ${Object.keys(MeasureRowSchema.shape).join(", ")}
			FROM (${view.sql(onlyMember !== null)})
			WHERE (session_id, agent_id, turn_idx) IN (SELECT r.1, r.2, r.3 FROM (${REF_RUNS_SQL}))`,
		query_params: {
			[SQL_SCOPE_PARAMS.workspace]: workspaceId,
			...(onlyMember === null ? {} : { [SQL_SCOPE_PARAMS.member]: onlyMember }),
			...refParams(runs),
		},
	});
}

/** ClickHouse's DateTime64 text for an ISO time. */
function clickHouseTime(iso: string): string {
	return iso.replace("T", " ").replace("Z", "");
}
