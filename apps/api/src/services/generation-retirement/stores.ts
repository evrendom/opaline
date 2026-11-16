import { TupleParam } from "@clickhouse/client-web";
import { decodeTranscriptRecordsReceipt } from "@rudel/api-routes/transcript-records";
import { CALL_FACTS_TABLE } from "@rudel/ch-schema/call-facts";
import { RUN_SETUP_TABLE } from "@rudel/ch-schema/received-setup";
import { TRANSCRIPT_RECORD_COMMANDS_TABLE } from "@rudel/ch-schema/transcript-record-commands";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { storedCallCommandsEnabled } from "../analysis/call-commands.js";
import {
	CENSUS_WINDOW_INDEX_ROWS,
	CENSUS_WINDOW_SETTINGS,
	type CensusWindow,
	censusWindowFilter,
} from "../census-windows.js";
import type { KeyedDeleteColumn } from "../clickhouse-batched-delete.js";
import {
	RUN_INDEX_TABLE,
	RUN_REQUESTS_TABLE,
} from "../l1-edges/l1-edge-tables.js";
import {
	receiptRow,
	TRANSCRIPT_RECORDS,
} from "../transcript-generations/generations.js";
import {
	type GenerationStore,
	MAX_RETIRED_PER_SESSION,
	RETIREMENT_GRACE_MS,
	type SessionGenerations,
	type StoredGeneration,
	type StoredSession,
} from "./retirement.js";

const SESSION_GIT_OBSERVATIONS = "rudel.session_git_observations";
const TRANSCRIPT_CHUNK_HITS = "rudel.transcript_chunk_hits";

const READ_SETTINGS = {
	max_bytes_to_read: String(4 * 1024 * 1024 * 1024),
	max_execution_time: 60,
	max_rows_to_read: "50000000",
	result_overflow_mode: "throw",
} as const;

const BELOW_RECEIPT_CENSUS_SETTINGS = {
	...CENSUS_WINDOW_SETTINGS,
	max_memory_usage: String(1024 * 1024 * 1024),
} as const;

const USER_SESSION: readonly KeyedDeleteColumn[] = [
	{ name: "user_id", type: "String" },
	{ name: "session_id", type: "String" },
];
const USER_SOURCE_SESSION: readonly KeyedDeleteColumn[] = [
	{ name: "user_id", type: "String" },
	{ name: "source", type: "String" },
	{ name: "session_id", type: "String" },
];
const GENERATION: readonly KeyedDeleteColumn[] = [
	{ name: "revision", type: "UInt64" },
	{ name: "parser_version", type: "UInt16" },
];
const SNAPSHOT: readonly KeyedDeleteColumn[] = [
	...GENERATION,
	{ name: "index_version", type: "UInt16" },
	{ name: "build_revision", type: "UInt64" },
];

interface CensusInput {
	readonly window: CensusWindow;
	readonly limit: number;
	readonly retireBefore: number;
	readonly organizationId?: string;
	readonly signal?: AbortSignal;
	readonly settings?: Record<string, string | number>;
}

const SessionRowSchema = z
	.object({ organization_id: z.string() })
	.catchall(z.unknown());

async function readSessions(
	executor: ClickHouseExecutor,
	columns: readonly KeyedDeleteColumn[],
	input: CensusInput,
	query: (filters: string) => string,
	settings: Record<string, string | number>,
	params: Record<string, unknown> = {},
): Promise<StoredSession[]> {
	const bounds = censusWindowFilter(input.window);
	const rows = z.array(SessionRowSchema).parse(
		await executor.query<unknown>({
			abortSignal: input.signal,
			clickhouse_settings: input.settings ?? settings,
			query: query(
				`${organizationFilter(input.organizationId)} ${bounds.sql}`,
			),
			query_params: {
				...params,
				...bounds.params,
				limit: input.limit,
				organizationId: input.organizationId,
			},
		}),
	);
	return rows.map((row) => ({
		organizationId: row.organization_id,
		key: columns.map((column) => String(row[column.name])),
	}));
}

function organizationFilter(organizationId: string | undefined): string {
	return organizationId === undefined
		? ""
		: "AND organization_id = {organizationId:String}";
}

const GenerationRowSchema = z
	.object({
		revision_text: z.string(),
		parser_version: z.coerce.number(),
		receipts: z.coerce.number(),
		published_ms: z.coerce.number(),
		written_ms: z.coerce.number(),
		receipt_head: z.string().default(""),
		index_version: z.coerce.number().optional(),
		build_revision_text: z.string().optional(),
	})
	.catchall(z.unknown());

type GenerationRow = z.infer<typeof GenerationRowSchema>;

async function readGenerations(
	executor: ClickHouseExecutor,
	spec: {
		readonly table: string;
		readonly sessionColumns: readonly KeyedDeleteColumn[];
		readonly generationColumns: readonly KeyedDeleteColumn[];
		readonly receipt: string;
		readonly published: string;
		readonly written: string;
		readonly limit: number;
		readonly receiptHead?: boolean;
		readonly toGeneration: (row: GenerationRow) => StoredGeneration;
	},
	organizationId: string,
	sessions: readonly StoredSession[],
	signal?: AbortSignal,
): Promise<SessionGenerations[]> {
	if (sessions.length === 0) return [];
	const sessionNames = spec.sessionColumns.map((column) => column.name);
	const generationNames = spec.generationColumns.map((column) => column.name);
	const selected = spec.generationColumns.map((column) =>
		column.type === "UInt64"
			? `toString(${column.name}) AS ${column.name}_text`
			: column.name,
	);
	const rows = z.array(GenerationRowSchema).parse(
		await executor.query<unknown>({
			abortSignal: signal,
			clickhouse_settings: {
				...READ_SETTINGS,
				max_result_rows: String(sessions.length * spec.limit),
			},
			query: `SELECT ${sessionNames.join(", ")}, ${selected.join(", ")},
					countIf(${spec.receipt}) AS receipts,
					maxIf(toUnixTimestamp64Milli(${spec.published}), ${spec.receipt}) AS published_ms,
					max(toUnixTimestamp64Milli(${spec.written})) AS written_ms
					${spec.receiptHead ? `, anyIf(head, ${spec.receipt}) AS receipt_head` : ""}
				FROM ${getSafeClickHouseTable(spec.table)}
				WHERE organization_id = {organizationId:String}
					AND (${sessionNames.join(", ")}) IN {sessions:Array(Tuple(${spec.sessionColumns.map(() => "String").join(", ")}))}
				GROUP BY ${[...sessionNames, ...generationNames].join(", ")}
				ORDER BY ${[...sessionNames, ...generationNames.map((name) => `${name} DESC`)].join(", ")}
				LIMIT {limit:UInt32} BY ${sessionNames.join(", ")}`,
			query_params: {
				organizationId,
				sessions: sessions.map((session) => new TupleParam([...session.key])),
				limit: spec.limit,
			},
		}),
	);
	const bySession = new Map<string, StoredGeneration[]>();
	for (const row of rows) {
		const key = sessionNames.map((name) => String(row[name])).join("\u0000");
		const list = bySession.get(key) ?? [];
		list.push(spec.toGeneration(row));
		bySession.set(key, list);
	}
	return sessions.flatMap((session) => {
		const generations = bySession.get(session.key.join("\u0000"));
		return generations ? [{ session, generations }] : [];
	});
}

export const transcriptRecordsStore: GenerationStore = {
	table: TRANSCRIPT_RECORDS,
	dependents: () =>
		storedCallCommandsEnabled() ? [TRANSCRIPT_RECORD_COMMANDS_TABLE] : [],
	sessionColumns: USER_SESSION,
	generationColumns: GENERATION,
	policy: { graceMs: RETIREMENT_GRACE_MS, abandonedBuilds: false },
	census: {
		windowRows: CENSUS_WINDOW_INDEX_ROWS,
		windowsPerPass: 2,
		sessionsPerPass: 1_000,
		readsMs: 60_000,
	},
	findSessions: (executor, input) =>
		readSessions(
			executor,
			USER_SESSION,
			input,
			(filters) => `SELECT organization_id, user_id, session_id
			FROM (
				SELECT organization_id, user_id, session_id,
					arraySort(groupUniqArray(((revision, parser_version),
						parseDateTime64BestEffortOrNull(JSONExtractString(head, 'publishedAt'), 3, 'UTC')))) AS receipts
				FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS)}
				WHERE ${receiptRow()} ${filters}
				GROUP BY organization_id, user_id, session_id
				HAVING uniqExact((revision, parser_version)) > 1
					AND arrayExists(
						receipt -> receipt.2 <= fromUnixTimestamp64Milli({retireBefore:Int64}, 'UTC'),
						arraySlice(receipts, 2))
			)
			ORDER BY organization_id, user_id, session_id
			LIMIT {limit:UInt32}`,
			CENSUS_WINDOW_SETTINGS,
			{ retireBefore: input.retireBefore },
		),
	readGenerations: (executor, organizationId, sessions, signal) =>
		readGenerations(
			executor,
			{
				table: TRANSCRIPT_RECORDS,
				sessionColumns: USER_SESSION,
				generationColumns: GENERATION,
				receipt: receiptRow(),
				published: "ts",
				written: "ts",
				limit: MAX_RETIRED_PER_SESSION + 2,
				receiptHead: true,
				toGeneration: (row) => {
					const receipt = row.receipt_head
						? decodeTranscriptRecordsReceipt(row.receipt_head)
						: undefined;
					return {
						key: [row.revision_text, row.parser_version],
						committed: receipt !== undefined,
						publishedAtMs:
							receipt === undefined ? null : Date.parse(receipt.publishedAt),
						writtenAtMs: row.written_ms,
						rows: receipt === undefined ? null : receipt.rowCount,
					};
				},
			},
			organizationId,
			sessions,
			signal,
		),
};

export const runIndexStore: GenerationStore = {
	table: RUN_INDEX_TABLE,
	dependents: () => [CALL_FACTS_TABLE, RUN_SETUP_TABLE, RUN_REQUESTS_TABLE],
	sessionColumns: USER_SESSION,
	generationColumns: SNAPSHOT,
	policy: { graceMs: RETIREMENT_GRACE_MS, abandonedBuilds: true },
	census: {
		windowRows: CENSUS_WINDOW_INDEX_ROWS,
		windowsPerPass: 2,
		sessionsPerPass: 1_000,
		readsMs: 30_000,
	},
	findSessions: (executor, input) =>
		readSessions(
			executor,
			USER_SESSION,
			input,
			(filters) => `SELECT organization_id, user_id, session_id
			FROM (
				SELECT organization_id, user_id, session_id,
					(revision, parser_version, index_version, build_revision) AS generation,
					countIf(row_kind = 'receipt') AS receipts,
					maxIf(toUnixTimestamp64Milli(built_at), row_kind = 'receipt') AS receipt_ms,
					max(toUnixTimestamp64Milli(built_at)) AS written_ms
				FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
				WHERE 1 = 1 ${filters}
				GROUP BY organization_id, user_id, session_id, generation
			)
			GROUP BY organization_id, user_id, session_id
			HAVING count() > 1
				AND (max(written_ms) <= {retireBefore:Int64}
					OR arrayExists(
						snapshot -> snapshot.2 > 0 AND snapshot.3 <= {retireBefore:Int64},
						arraySlice(arraySort(groupArray((generation, receipts, receipt_ms))), 2)))
			ORDER BY organization_id, user_id, session_id
			LIMIT {limit:UInt32}`,
			CENSUS_WINDOW_SETTINGS,
			{ retireBefore: input.retireBefore },
		),
	readGenerations: (executor, organizationId, sessions, signal) =>
		readGenerations(
			executor,
			{
				table: RUN_INDEX_TABLE,
				sessionColumns: USER_SESSION,
				generationColumns: SNAPSHOT,
				receipt: "row_kind = 'receipt'",
				published: "built_at",
				written: "built_at",
				limit: 10 * MAX_RETIRED_PER_SESSION,
				toGeneration: (row) => ({
					key: [
						row.revision_text,
						row.parser_version,
						row.index_version ?? 0,
						row.build_revision_text ?? "0",
					],
					committed: row.receipts > 0,
					publishedAtMs: row.receipts > 0 ? row.published_ms : null,
					writtenAtMs: row.written_ms,
					rows: null,
				}),
			},
			organizationId,
			sessions,
			signal,
		),
};

function belowNewestReceiptStore(
	table: string,
	written: string,
): GenerationStore {
	return {
		table,
		dependents: () => [],
		sessionColumns: USER_SOURCE_SESSION,
		generationColumns: GENERATION,
		policy: { graceMs: null, abandonedBuilds: false },
		census: {
			windowRows: CENSUS_WINDOW_INDEX_ROWS / 2,
			windowsPerPass: 2,
			sessionsPerPass: 1_000,
			readsMs: 60_000,
		},
		findSessions: (executor, input) =>
			readSessions(
				executor,
				USER_SOURCE_SESSION,
				input,
				(filters) => `SELECT organization_id, user_id, source, session_id
				FROM (
					SELECT organization_id, user_id, source, session_id,
						(revision, parser_version) AS generation, countIf(${receiptRow()}) AS receipts
					FROM ${getSafeClickHouseTable(table)}
					WHERE 1 = 1 ${filters}
					GROUP BY organization_id, user_id, source, session_id, revision, parser_version
				)
				GROUP BY organization_id, user_id, source, session_id
				HAVING countIf(receipts > 0) > 0 AND min(generation) < maxIf(generation, receipts > 0)
				ORDER BY organization_id, user_id, source, session_id
				LIMIT {limit:UInt32}`,
				BELOW_RECEIPT_CENSUS_SETTINGS,
			),
		readGenerations: (executor, organizationId, sessions, signal) =>
			readGenerations(
				executor,
				{
					table,
					sessionColumns: USER_SOURCE_SESSION,
					generationColumns: GENERATION,
					receipt: receiptRow(),
					published: written,
					written,
					limit: 10 * MAX_RETIRED_PER_SESSION,
					toGeneration: (row) => ({
						key: [row.revision_text, row.parser_version],
						committed: row.receipts > 0,
						publishedAtMs: row.receipts > 0 ? row.published_ms : null,
						writtenAtMs: row.written_ms,
						rows: null,
					}),
				},
				organizationId,
				sessions,
				signal,
			),
	};
}

export const gitObservationsStore = belowNewestReceiptStore(
	SESSION_GIT_OBSERVATIONS,
	"ts",
);

export const chunkHitsStore = belowNewestReceiptStore(
	TRANSCRIPT_CHUNK_HITS,
	"written_at",
);

export const SESSION_RETIREMENT_STORES = [
	["gitObservations", gitObservationsStore],
	["chunkHits", chunkHitsStore],
	["runIndex", runIndexStore],
	["transcriptRecords", transcriptRecordsStore],
] as const;
