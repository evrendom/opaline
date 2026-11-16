import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";

export interface TranscriptReadScope {
	readonly organizationId: string;
	readonly userId: string;
}

export interface Generation {
	readonly parserVersion: number;
	readonly revision: string;
}

export interface SessionGeneration extends Generation {
	readonly sessionId: string;
}

export interface CommittedGeneration extends SessionGeneration {
	readonly receipt: string;
	readonly source: string;
}

export const TRANSCRIPT_RECORDS = "rudel.transcript_records";

const LOOKUP_SETTINGS = {
	max_bytes_to_read: String(4 * 1024 * 1024 * 1024),
	max_execution_time: 30,
	max_rows_to_read: "50000000",
	max_result_rows: "100000",
	max_result_bytes: "16777216",
	result_overflow_mode: "throw",
} as const;

function columns(alias: string) {
	return (name: string) => (alias ? `${alias}.${name}` : name);
}

export function receiptRow(alias = ""): string {
	const column = columns(alias);
	return `${column("agent_id")} = '' AND ${column("record_idx")} = ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX} AND ${column("block_idx")} = 0`;
}

export function contentRow(alias = ""): string {
	return `${columns(alias)("record_idx")} < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}`;
}

export function pinnedRows(alias = ""): string {
	const column = columns(alias);
	return `${column("organization_id")} = {organizationId:String} AND ${column("user_id")} = {userId:String}
		AND ${column("session_id")} IN {sessionIds:Array(String)}
		AND ${column("revision")} IN CAST({revisions:Array(String)}, 'Array(UInt64)')
		AND (${column("session_id")}, ${column("revision")}, ${column("parser_version")}) IN arrayZip({sessionIds:Array(String)},
			arrayMap(r -> toUInt64(r), {revisions:Array(String)}), {parserVersions:Array(UInt16)})`;
}

export function pinnedRecords(alias = ""): string {
	return `${pinnedRows(alias)}
		AND ${contentRow(alias)}`;
}

export function pinnedParams(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
) {
	return {
		organizationId: scope.organizationId,
		userId: scope.userId,
		sessionIds: generations.map((generation) => generation.sessionId),
		revisions: generations.map((generation) => generation.revision),
		parserVersions: generations.map((generation) => generation.parserVersion),
	};
}

export function newestGenerations(
	options: {
		readonly by?: readonly string[];
		readonly and?: string;
		readonly columns?: string;
		readonly table?: string;
	} = {},
): string {
	const by = (options.by ?? ["organization_id", "user_id", "session_id"]).join(
		", ",
	);
	return `SELECT ${by}, max((revision, parser_version)) AS generation${options.columns ? `, ${options.columns}` : ""}
		FROM ${getSafeClickHouseTable(options.table ?? TRANSCRIPT_RECORDS)}
		WHERE ${receiptRow()} ${options.and ?? ""}
		GROUP BY ${by}`;
}

export function committedGenerationsStatement(
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
): ClickHouseStatement {
	return {
		clickhouse_settings: LOOKUP_SETTINGS,
		query: `
			SELECT session_id, toString(revision) AS revision_text, parser_version, source, head AS receipt
			FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS)}
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
				AND session_id IN {sessionIds:Array(String)}
				AND ${receiptRow()}
			ORDER BY session_id, revision DESC, parser_version DESC
			LIMIT 1 BY session_id
		`,
		query_params: {
			organizationId: scope.organizationId,
			userId: scope.userId,
			sessionIds: [...sessionIds],
		},
	};
}

const CommittedRowSchema = z
	.object({
		session_id: z.string(),
		revision_text: z.string(),
		parser_version: z.coerce.number(),
		source: z.string(),
		receipt: z.string(),
	})
	.transform(
		(row): CommittedGeneration => ({
			sessionId: row.session_id,
			revision: row.revision_text,
			parserVersion: row.parser_version,
			source: row.source,
			receipt: row.receipt,
		}),
	);

export async function readCommittedGenerations(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
	abortSignal?: AbortSignal,
): Promise<CommittedGeneration[]> {
	if (sessionIds.length === 0) return [];
	return z.array(CommittedRowSchema).parse(
		await executor.query<unknown>({
			...committedGenerationsStatement(scope, sessionIds),
			abortSignal,
		}),
	);
}

export function generationKey(generation: SessionGeneration): string {
	return `${generation.sessionId}\u0000${generation.revision}\u0000${generation.parserVersion}`;
}
