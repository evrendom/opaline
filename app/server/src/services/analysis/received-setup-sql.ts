import type { ReceivedSetupEntry } from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import type { ClickHouseStatement } from "../../clickhouse.js";
import {
	pinnedParams,
	pinnedRecords,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../transcript-generations/generations.js";
import {
	type GitStatus,
	parseGitStatus,
	type ReceivedSetupInput,
	type SetupReception,
} from "./received-setup.js";
import { ANALYSIS_QUERY_SETTINGS, records } from "./sql.js";

/**
 * What a run index build reads for received setup (`received-setup.ts`)
 * from one committed generation: the records that carried setup (parser 10,
 * `received_setup`), the compactions after which it may have left the
 * context, the files the session changed, and the git status Claude Code
 * recorded at the session's start.
 */

export const ReceivedSetupRecordSchema = z.object({
	agent_id: z.string(),
	record_idx: z.coerce.number(),
	block_idx: z.coerce.number(),
	at_ms: z.coerce.number(),
	kind: z.string(),
	file_path: z.string(),
	setup: z.string(),
	replayed: z.coerce.number(),
	environment: z.string(),
	environment_clipped: z.coerce.number(),
});
export type ReceivedSetupRecord = z.infer<typeof ReceivedSetupRecordSchema>;

const EntrySchema = z.object({
	kind: z.enum([
		"system_prompt",
		"instructions",
		"nested_memory",
		"skill_body",
		"mcp_instructions",
		"agents_md",
		"developer",
	]),
	path: z.string(),
	name: z.string(),
	cwd: z.string(),
	sha256: z.string().regex(/^[0-9a-f]{64}$/u),
	chars: z.number().int().nonnegative(),
});
const ComponentsSchema = z.array(
	z.object({ path: z.string(), value: z.unknown() }),
);

/** Where Claude Code records the git status at a session's start. */
const GIT_STATUS_COMPONENT = ".gitStatus";

export function buildReceivedSetupStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: receivedSetupSql(""),
		query_params: pinnedParams(scope, [generation]),
	};
}

export function buildReceivedSetupBatchStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	settings: Record<string, string | number> = {},
): ClickHouseStatement {
	return {
		clickhouse_settings: { ...ANALYSIS_QUERY_SETTINGS, ...settings },
		query: receivedSetupSql("session_id, "),
		query_params: pinnedParams(scope, generations),
	};
}

function receivedSetupSql(session: string): string {
	return `SELECT ${session}agent_id, record_idx, block_idx, toUnixTimestamp64Milli(ts) AS at_ms, kind, file_path,
				facts['received_setup'] AS setup, toUInt8(facts['fork_replayed'] = 'true') AS replayed,
				if(subtype = 'attachment:session_context', facts['environment_snapshot_components'], '') AS environment,
				toUInt8(has(splitByChar(',', facts['facts_clipped']), 'environment_snapshot_components')) AS environment_clipped
			FROM ${records()}
			WHERE ${pinnedRecords()} AND (
				facts['received_setup'] != ''
				OR kind = 'compaction'
				OR (kind = 'file_change' AND file_op IN ('write', 'edit', 'delete'))
				OR (agent_id = '' AND kind = 'meta' AND subtype = 'attachment:session_context'))
			ORDER BY ${session}agent_id, record_idx, block_idx`;
}

/** The build's records as the pure rows function takes them. */
export function receivedSetupParts(
	rows: readonly ReceivedSetupRecord[],
): Pick<
	ReceivedSetupInput,
	"receptions" | "compactions" | "edits" | "gitStatus"
> {
	const receptions: SetupReception[] = [];
	let gitStatus: GitStatus | null = null;
	for (const row of rows) {
		if (row.setup !== "") {
			const entries = parseEntries(row.setup);
			if (entries.length > 0)
				receptions.push({
					agentId: row.agent_id,
					record: row.record_idx,
					block: row.block_idx,
					atMs: row.at_ms,
					replayed: row.replayed > 0,
					entries,
				});
		}
		if (gitStatus === null && row.environment !== "") {
			const status = gitStatusOf(row.environment);
			// A status cut at the fact cap may miss changed files at its end.
			gitStatus =
				status !== null && row.environment_clipped > 0
					? { ...status, complete: false }
					: status;
		}
	}
	return {
		receptions,
		compactions: rows
			.filter((row) => row.kind === "compaction")
			.map((row) => ({ agentId: row.agent_id, record: row.record_idx })),
		edits: rows
			.filter((row) => row.kind === "file_change" && row.file_path !== "")
			.map((row) => ({ path: row.file_path, atMs: row.at_ms })),
		gitStatus,
	};
}

/** A record's `received_setup` list; a malformed one names nothing. */
function parseEntries(value: string): ReceivedSetupEntry[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return [];
	}
	const entries = z.array(EntrySchema).safeParse(parsed);
	return entries.success ? entries.data : [];
}

function gitStatusOf(components: string): GitStatus | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(components);
	} catch {
		return null;
	}
	const list = ComponentsSchema.safeParse(parsed);
	if (!list.success) return null;
	const status = list.data.find((component) =>
		component.path.endsWith(GIT_STATUS_COMPONENT),
	)?.value;
	return typeof status === "string" ? parseGitStatus(status) : null;
}
