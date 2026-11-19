import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import { committedBuildSql } from "./run-index-reader.js";
import {
	buildRunMessagesStatement,
	RunMessagesRowSchema,
	runMessageColumns,
} from "./run-messages.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./sql.js";
import { MESSAGES_SINCE } from "./sql-measures.js";

export interface PromptReactionsSession {
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
}

const StoredRunSchema = z.object({
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	prompt_reactions: z.array(z.string()),
	revision: z.string(),
	parser_version: z.coerce.number(),
	index_version: z.coerce.number(),
	build_revision: z.string(),
});
type StoredRun = z.infer<typeof StoredRunSchema>;

const OWNER =
	"organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id = {sessionId:String}";

export function buildStoredReactionsStatement(
	session: PromptReactionsSession,
): ClickHouseStatement {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT agent_id, turn_idx, prompt_reactions, toString(revision) AS revision,
				parser_version, index_version, toString(build_revision) AS build_revision
			FROM ${table} FINAL
			WHERE ${OWNER} AND row_kind = 'run' AND index_version >= ${MESSAGES_SINCE}
				AND ${committedBuildSql(table, OWNER, ["user_id", "session_id"])}`,
		query_params: { ...session },
	};
}

export function buildReactionsRewriteStatement(
	session: PromptReactionsSession,
	build: StoredRun,
	runs: readonly { agentId: string; turn: number; reactions: string[] }[],
): ClickHouseStatement {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const keys = "arrayZip({agents:Array(String)}, {turns:Array(UInt32)})";
	return {
		clickhouse_settings: { insert_deduplicate: 0 },
		query: `INSERT INTO ${table}
			SELECT * REPLACE (
				CAST({reactions:Array(Array(String))}[indexOf(${keys}, (agent_id, turn_idx))]
					AS Array(LowCardinality(String))) AS prompt_reactions
			)
			FROM (
				SELECT * FROM ${table} FINAL
				WHERE ${OWNER} AND row_kind = 'run'
					AND revision = {revision:UInt64} AND parser_version = {parserVersion:UInt16}
					AND index_version = {indexVersion:UInt16} AND build_revision = {buildRevision:UInt64}
					AND has(${keys}, (agent_id, turn_idx))
			)`,
		query_params: {
			...session,
			revision: build.revision,
			parserVersion: build.parser_version,
			indexVersion: build.index_version,
			buildRevision: build.build_revision,
			agents: runs.map((run) => run.agentId),
			turns: runs.map((run) => run.turn),
			reactions: runs.map((run) => run.reactions),
		},
	};
}

export async function refreshPromptReactions(
	executor: ClickHouseExecutor,
	session: PromptReactionsSession,
	beforeWrite: () => Promise<void> = async () => {},
): Promise<number> {
	const stored = await query(
		executor,
		StoredRunSchema,
		buildStoredReactionsStatement(session),
	);
	const build = stored[0];
	if (!build) return 0;
	const messages = await query(
		executor,
		RunMessagesRowSchema,
		buildRunMessagesStatement(
			{ organizationId: session.organizationId, userId: session.userId },
			{
				sessionId: session.sessionId,
				revision: build.revision,
				parserVersion: build.parser_version,
			},
		),
	);
	const columns = runMessageColumns(messages);
	const changed = stored.flatMap((run) => {
		const reactions = columns(run.agent_id, run.turn_idx).prompt_reactions;
		return sameReactions(reactions, run.prompt_reactions)
			? []
			: [{ agentId: run.agent_id, turn: run.turn_idx, reactions }];
	});
	if (changed.length === 0) return 0;
	await beforeWrite();
	await executor.execute(
		buildReactionsRewriteStatement(session, build, changed),
	);
	return changed.length;
}

function sameReactions(
	left: readonly string[],
	right: readonly string[],
): boolean {
	const sorted = [...right].sort();
	return (
		left.length === sorted.length &&
		left.every((reaction, index) => reaction === sorted[index])
	);
}
