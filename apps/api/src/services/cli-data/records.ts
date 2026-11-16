import { SETUP_TEXTS_TABLE } from "@rudel/ch-schema/received-setup";
import { redactReturnedValue } from "@rudel/secret-filter";
import {
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import { chunkByParamBytes, records as recordsTable } from "../analysis/sql.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import { contentRow } from "../transcript-generations/generations.js";
import {
	type CliDataContext,
	ExportRefused,
	trustedLines,
	trustedRows,
} from "./statements.js";
import { batches, bySessionId, type VisibleSession } from "./visible.js";

export const RECORD_COLUMNS = [
	"session_id",
	"agent_id",
	"turn_idx",
	"record_idx",
	"block_idx",
	"ts",
	"kind",
	"subtype",
	"tool_name",
	"command_class",
	"call_id",
	"is_error",
	"exit_code",
	"file_path",
	"file_op",
	"spawned_agent_id",
	"text",
] as const;

export const SETUP_TEXT_COLUMNS = [
	"user_id",
	"version",
	"version_name",
	"chars",
	"stored_chars",
	"text_cut",
	"text",
] as const;

export const RECORD_LINE_OVERHEAD = 256;
const RECORD_BATCH = 20;

const OWNER = `organization_id = {ws:String} AND user_id IN {users:Array(String)}
	AND session_id IN {ids:Array(String)}
	AND has(arrayZip({owners:Array(String)}, {ids:Array(String)}), (user_id, session_id))`;

function ownerParams(workspaceId: string, sessions: readonly VisibleSession[]) {
	return {
		ws: workspaceId,
		users: [...new Set(sessions.map((session) => session.userId))],
		ids: sessions.map((session) => session.sessionId),
		owners: sessions.map((session) => session.userId),
	};
}

function committedGeneration(): string {
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	return `(user_id, source, session_id, revision, parser_version) IN (
			SELECT user_id, source, session_id, revision, parser_version
			FROM ${runIndex} FINAL
			WHERE ${OWNER} AND row_kind = 'receipt'
				AND ${committedBuildSql(runIndex, OWNER, ["user_id", "session_id"])}
		)
		AND ${contentRow()}`;
}

export function recordSizesStatement(
	workspaceId: string,
	sessions: readonly VisibleSession[],
): ClickHouseStatement {
	return {
		query: `SELECT session_id, count() AS records,
				sum(greatest(length(text), length(head))) AS text_bytes
			FROM ${recordsTable()} FINAL
			WHERE ${OWNER} AND ${committedGeneration()}
			GROUP BY session_id`,
		query_params: ownerParams(workspaceId, sessions),
	};
}

export function recordsStatement(
	workspaceId: string,
	sessions: readonly VisibleSession[],
): ClickHouseStatement {
	return {
		query: `SELECT session_id, agent_id, turn_idx, record_idx, block_idx, toString(ts) AS ts, kind, subtype, tool_name,
				command_class, call_id, is_error, exit_code, file_path, file_op, spawned_agent_id,
				if(lengthUTF8(text) >= lengthUTF8(head), text, head) AS shown, lengthUTF8(shown) AS shown_chars, text_chars,
				facts['fork_replayed'] = 'true' AS fork_replayed
			FROM ${recordsTable()} FINAL
			WHERE ${OWNER} AND ${committedGeneration()}
			ORDER BY session_id, agent_id, record_idx, block_idx`,
		query_params: ownerParams(workspaceId, sessions),
	};
}

export async function recordSizes(
	context: CliDataContext,
	sessions: readonly VisibleSession[],
): Promise<Map<string, { records: number; bytes: number }>> {
	const sizes = new Map<string, { records: number; bytes: number }>();
	for (const group of chunkByParamBytes(sessions, (session) => [
		session.sessionId,
		session.userId,
		session.userId,
	]))
		for (const row of await trustedRows(
			context,
			recordSizesStatement(context.caller.workspaceId, group),
		)) {
			const records = Number(row.records);
			sizes.set(String(row.session_id), {
				records,
				bytes: Number(row.text_bytes) + records * RECORD_LINE_OVERHEAD,
			});
		}
	return sizes;
}

export function recordLine(row: Record<string, unknown>): string {
	const record: Record<string, unknown> = {
		session_id: row.session_id,
		agent_id: row.agent_id,
		turn_idx: row.turn_idx,
		record_idx: row.record_idx,
		block_idx: row.block_idx,
		ts: `${String(row.ts).replace(" ", "T")}Z`,
		kind: row.kind,
		subtype: row.subtype,
		tool_name: row.tool_name,
		command_class: row.command_class,
		call_id: row.call_id,
		is_error: Boolean(row.is_error),
		exit_code: row.exit_code,
		file_path: row.file_path,
		file_op: row.file_op,
		spawned_agent_id: row.spawned_agent_id,
		text: row.shown,
	};
	if (Number(row.text_chars) > Number(row.shown_chars))
		record._cut = {
			stored_chars: Number(row.shown_chars),
			original_chars: Number(row.text_chars),
		};
	if (row.fork_replayed) record.fork_replayed = true;
	return JSON.stringify(redactReturnedValue(record));
}

const isLimit = (error: unknown) =>
	error instanceof ExportRefused && error.failure.limit !== undefined;

export async function* recordLines(
	context: CliDataContext,
	sessions: readonly VisibleSession[],
): AsyncGenerator<string> {
	const queue = batches([...sessions].sort(bySessionId), RECORD_BATCH);
	while (queue.length > 0) {
		const batch = queue.shift() as VisibleSession[];
		let lines: AsyncIterable<readonly string[]>;
		try {
			lines = await trustedLines(
				context,
				recordsStatement(context.caller.workspaceId, batch),
			);
		} catch (error) {
			if (batch.length > 1 && isLimit(error)) {
				const half = Math.ceil(batch.length / 2);
				queue.unshift(batch.slice(0, half), batch.slice(half));
				continue;
			}
			throw error;
		}
		for await (const part of lines)
			for (const line of part)
				yield recordLine(JSON.parse(line) as Record<string, unknown>);
	}
}

export interface SetupVersion {
	readonly userId: string;
	readonly version: string;
	readonly versionName: string;
}

export function setupTextsStatement(
	workspaceId: string,
	versions: readonly SetupVersion[],
): ClickHouseStatement {
	return {
		query: `SELECT user_id, version, any(chars) AS chars, any(text) AS text
			FROM ${getSafeClickHouseTable(SETUP_TEXTS_TABLE)} FINAL
			WHERE organization_id = {ws:String}
				AND has(arrayZip({users:Array(String)}, {versions:Array(String)}), (user_id, version))
			GROUP BY user_id, version
			ORDER BY user_id, version`,
		query_params: {
			ws: workspaceId,
			users: versions.map((entry) => entry.userId),
			versions: versions.map((entry) => entry.version),
		},
	};
}

export async function* setupTextLines(
	context: CliDataContext,
	versions: readonly SetupVersion[],
): AsyncGenerator<string> {
	const names = new Map(
		versions.map((entry) => [
			`${entry.userId}|${entry.version}`,
			entry.versionName,
		]),
	);
	for (const group of chunkByParamBytes(versions, (entry) => [
		entry.userId,
		entry.version,
	]))
		for await (const part of await trustedLines(
			context,
			setupTextsStatement(context.caller.workspaceId, group),
		))
			for (const line of part) {
				const row = JSON.parse(line) as {
					user_id: string;
					version: string;
					chars: number;
					text: string;
				};
				const stored = [...row.text].length;
				yield JSON.stringify(
					redactReturnedValue({
						user_id: row.user_id,
						version: row.version,
						version_name:
							names.get(`${row.user_id}|${row.version}`) ??
							row.version.slice(0, 12),
						chars: Number(row.chars),
						stored_chars: stored,
						text_cut: stored < Number(row.chars),
						text: row.text,
					}),
				);
			}
}
