import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { TRANSCRIPT_RECORD_COMMANDS_TABLE } from "@rudel/ch-schema/transcript-record-commands";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { isSelfHosted } from "../../lib/self-hosted.js";
import {
	generationKey,
	pinnedParams,
	pinnedRecords,
	pinnedRows,
	readCommittedGenerations,
	receiptRow,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../transcript-generations/generations.js";
import { commandColumnsSql } from "./command-identity.js";
import { query, records } from "./sql.js";

type Environment = Readonly<Record<string, string | undefined>>;

export const commandsTable = () =>
	getSafeClickHouseTable(TRANSCRIPT_RECORD_COMMANDS_TABLE);

const MATERIALIZE_SETTINGS = {
	max_execution_time: 120,
	max_memory_usage: "1073741824",
	join_use_nulls: 0,
} as const;

const GENERATIONS_PER_INSERT = 200;

export function storedCallCommandsEnabled(
	env: Environment = process.env,
): boolean {
	return isSelfHosted(env) && env.OPALINE_STORED_CALL_COMMANDS !== "0";
}

const KEY_COLUMNS = [
	"organization_id",
	"user_id",
	"session_id",
	"revision",
	"parser_version",
	"agent_id",
	"record_idx",
	"block_idx",
] as const;

const RECORD_COLUMNS = [
	"source",
	"session_date",
	"turn_idx",
	"ts",
	"tool_name",
	"file_path",
	"call_id",
	"head",
] as const;

const COMMAND_COLUMNS = [
	"command_from",
	"command_text",
	"command_argv0",
	"command_prefix",
	"command_normalized",
	"command_fingerprint",
	"command_simhash",
] as const;

const INSERT_COLUMNS = [
	...KEY_COLUMNS,
	...RECORD_COLUMNS,
	...COMMAND_COLUMNS,
	"built_at",
].join(", ");

export function materializeCallCommandsStatements(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): ClickHouseStatement[] {
	const params = pinnedParams(scope, generations);
	return [
		{
			clickhouse_settings: MATERIALIZE_SETTINGS,
			query: `INSERT INTO ${commandsTable()} (${INSERT_COLUMNS})
				SELECT ${[...KEY_COLUMNS, ...RECORD_COLUMNS, ...COMMAND_COLUMNS].join(", ")}, now64(3)
				FROM (
					SELECT ${[...KEY_COLUMNS, ...RECORD_COLUMNS].join(", ")}, ${commandColumnsSql()}
					FROM ${records()} FINAL
					PREWHERE kind = 'tool_call' OR (kind = 'file_change' AND file_op = 'write')
					WHERE ${pinnedRecords()}
				)
				WHERE command_from != ''`,
			query_params: params,
		},
		{
			clickhouse_settings: MATERIALIZE_SETTINGS,
			query: `INSERT INTO ${commandsTable()} (${INSERT_COLUMNS})
				SELECT organization_id, user_id, session_id, revision, parser_version, '', ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}, 0,
					any(source), min(session_date), 0, now64(3), '', '', '', '',
					'', NULL, NULL, NULL, NULL, NULL, NULL, now64(3)
				FROM ${records()}
				WHERE ${pinnedRows()}
				GROUP BY organization_id, user_id, session_id, revision, parser_version`,
			query_params: params,
		},
	];
}

const ReceiptSchema = z.object({
	session_id: z.string(),
	revision: z.coerce.string(),
	parser_version: z.coerce.number(),
});

export async function missingCallCommandGenerations(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): Promise<SessionGeneration[]> {
	if (generations.length === 0) return [];
	const done = await query(executor, ReceiptSchema, {
		clickhouse_settings: MATERIALIZE_SETTINGS,
		query: `SELECT session_id, toString(revision) AS revision, parser_version
			FROM ${commandsTable()}
			WHERE ${pinnedRows()} AND ${receiptRow()}
			GROUP BY session_id, revision, parser_version`,
		query_params: pinnedParams(scope, generations),
	});
	const present = new Set(
		done.map((row) =>
			generationKey({
				sessionId: row.session_id,
				revision: row.revision,
				parserVersion: row.parser_version,
			}),
		),
	);
	return generations.filter(
		(generation) => !present.has(generationKey(generation)),
	);
}

export async function materializeCallCommands(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): Promise<number> {
	for (
		let start = 0;
		start < generations.length;
		start += GENERATIONS_PER_INSERT
	) {
		const chunk = generations.slice(start, start + GENERATIONS_PER_INSERT);
		for (const statement of materializeCallCommandsStatements(scope, chunk))
			await executor.execute(statement);
	}
	return generations.length;
}

export async function ensureCallCommands(
	executor: ClickHouseExecutor,
	batches: readonly {
		readonly scope: TranscriptReadScope;
		readonly generations: readonly SessionGeneration[];
	}[],
): Promise<number> {
	let built = 0;
	for (const batch of batches) {
		const missing = await missingCallCommandGenerations(
			executor,
			batch.scope,
			batch.generations,
		);
		if (missing.length > 0)
			built += await materializeCallCommands(executor, batch.scope, missing);
	}
	return built;
}

export async function materializeSessionCallCommands(
	executor: ClickHouseExecutor,
	session: {
		readonly organizationId: string;
		readonly userId: string;
		readonly sessionId: string;
	},
): Promise<number> {
	return materializeSessionsCallCommands(
		executor,
		{ organizationId: session.organizationId, userId: session.userId },
		[session.sessionId],
	);
}

export async function materializeSessionsCallCommands(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
): Promise<number> {
	if (sessionIds.length === 0) return 0;
	const generations = (
		await readCommittedGenerations(executor, scope, sessionIds)
	).map(({ sessionId, revision, parserVersion }) => ({
		sessionId,
		revision,
		parserVersion,
	}));
	const missing = await missingCallCommandGenerations(
		executor,
		scope,
		generations,
	);
	return missing.length > 0
		? materializeCallCommands(executor, scope, missing)
		: 0;
}
