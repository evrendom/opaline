import { TRANSCRIPT_RECORDS_PARSER_VERSION } from "@rudel/api-routes/transcript-records";
import type postgres from "postgres";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import {
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
} from "./analysis/run-index-sql.js";
import { ANALYSIS_QUERY_SETTINGS } from "./analysis/sql.js";
import { GIT_OBSERVATION_PARSER_VERSION } from "./git-observation-parser.js";
import { L1_EDGE_RESOLVER_VERSION } from "./l1-edges/l1-edge-derivation.js";
import {
	L1_EDGE_RESOLUTIONS_TABLE,
	L1_EDGES_TABLE,
	RUN_INDEX_TABLE,
} from "./l1-edges/l1-edge-tables.js";
import {
	contentRow,
	newestGenerations,
	receiptRow,
} from "./transcript-generations/generations.js";
import { TRANSCRIPT_RECORDS_TABLE } from "./transcript-records-ingest.service.js";

/**
 * The L1 audit behind `audit:l1`: a read-only
 * report of where an organization (or every one) stands on the L1 layers,
 * taken before and after each backfill step and compared.
 *
 * Read-only by construction: ClickHouse statements go through an executor
 * that refuses `execute` and `insert` and carry `readonly = 2` (reads and
 * settings only), and the Postgres reads run in one `READ ONLY` transaction
 * with a statement timeout. Every ClickHouse statement carries the analysis
 * guardrails (`ANALYSIS_QUERY_SETTINGS`: 30 s, 50 M rows, 4 GiB read, 1 GiB
 * memory, throw on overflow); a section that hits them reports its error and
 * the others still run, so narrow with an organization rather than raise
 * the bounds.
 *
 * Breakdowns are objects keyed by their values (never arrays), so two JSON
 * reports diff by path (`compareL1Audits`).
 */

export type Section<T> = T | { error: string };

export interface L1AuditReport {
	generatedAt: string;
	organizationId: string | null;
	versions: {
		transcriptParser: number;
		gitExtractor: number;
		edgeResolver: number;
		runIndex: number;
		runIndexPricing: string;
	};
	transcripts: Section<TranscriptsSection>;
	transcriptFacts: Section<TranscriptFactsSection>;
	gitObservations: Section<GitObservationsSection>;
	edgeScopes: Section<EdgeScopesSection>;
	edges: Section<EdgesSection>;
	runIndex: Section<RunIndexSection>;
	storage: Section<StorageSection>;
}

interface CommittedGenerationStats {
	sessions: number;
	sessionsWithSuperseded: number;
	supersededGenerations: number;
	supersededRows: number;
}

export interface TranscriptsSection {
	/** Per source, per parser version of the session's committed generation. */
	committedByParser: Record<string, Record<string, CommittedGenerationStats>>;
	totals: CommittedGenerationStats & {
		/** Superseded rows times the table's compressed bytes per row. */
		estimatedSupersededBytes: number | null;
	};
}

interface FactStats {
	rows: number;
	generations: number;
	committedReceipts: number;
	withAgentVersion: number;
	withEntrypoint: number;
	withFacts: number;
	agentVersionShare: number;
	factsShare: number;
}

export interface TranscriptFactsSection {
	/** Per source, per parser version: every stored record row (receipts excluded). */
	rowsByParser: Record<string, Record<string, FactStats>>;
}

export interface GitObservationsSection {
	/**
	 * Per source, sessions by their committed transcript generation's git
	 * observations: current (this generation, current extractor),
	 * staleExtractor (this generation, older extractor), staleTranscript
	 * (only older transcript generations), none.
	 */
	bySource: Record<
		string,
		{
			current: number;
			staleExtractor: number;
			staleTranscript: number;
			none: number;
		}
	>;
}

export interface EdgeScopesSection {
	/** kind → state → resolver version (or `none`) → scopes. */
	byState: Record<string, Record<string, Record<string, number>>>;
	/** kind → priority → due scopes and the oldest due age. */
	due: Record<
		string,
		Record<string, { scopes: number; oldestSeconds: number }>
	>;
	truncatedSessionBuilds: number;
}

export interface EdgesSection {
	/** relation → active and retracted edges (latest version per key). */
	byRelation: Record<string, { active: number; retracted: number }>;
	/** target → status → active resolutions (latest version per key). */
	resolutions: Record<string, Record<string, number>>;
}

export interface RunIndexSection {
	transcriptSessions: number;
	indexed: number;
	current: number;
	stale: number;
	missing: number;
	usageIncomplete: number;
	usageUnreceipted: number;
	/** Committed snapshots kept after their transcript expired. */
	indexedWithoutTranscript: number;
	sessionsWithSupersededSnapshots: number;
}

export interface StorageSection {
	/** Whole tables, every organization: active parts. */
	tables: Record<
		string,
		{ rows: number; compressedBytes: number; uncompressedBytes: number }
	>;
}

const AUDIT_SETTINGS = { ...ANALYSIS_QUERY_SETTINGS, readonly: "2" } as const;
const STORAGE_TABLES = [
	"transcript_records",
	"session_git_observations",
	"l1_edges",
	"l1_edges_by_target",
	"l1_edge_resolutions",
	"run_index",
];

/** An executor that can only read: `execute` and `insert` throw. */
export function readOnlyClickHouse(
	executor: ClickHouseExecutor,
): ClickHouseExecutor {
	return {
		close: () => executor.close(),
		execute: async () => {
			throw new Error("The L1 audit is read-only");
		},
		insert: async () => {
			throw new Error("The L1 audit is read-only");
		},
		query: <T>(statement: ClickHouseStatement) =>
			executor.query<T>({
				...statement,
				clickhouse_settings: {
					...statement.clickhouse_settings,
					readonly: "2",
				},
			}),
	};
}

export async function auditL1(
	executor: ClickHouseExecutor,
	sql: postgres.Sql,
	options: { organizationId?: string; now?: () => Date } = {},
): Promise<L1AuditReport> {
	if (options.organizationId !== undefined && options.organizationId === "")
		throw new Error("organizationId must not be empty");
	const clickhouse = readOnlyClickHouse(executor);
	const organizationId = options.organizationId;
	const storage = await section(() => readStorage(clickhouse));
	return {
		generatedAt: (options.now?.() ?? new Date()).toISOString(),
		organizationId: organizationId ?? null,
		versions: {
			transcriptParser: TRANSCRIPT_RECORDS_PARSER_VERSION,
			gitExtractor: GIT_OBSERVATION_PARSER_VERSION,
			edgeResolver: L1_EDGE_RESOLVER_VERSION,
			runIndex: RUN_INDEX_VERSION,
			runIndexPricing: RUN_INDEX_PRICING_VERSION,
		},
		transcripts: await section(() =>
			readTranscripts(clickhouse, organizationId, storage),
		),
		transcriptFacts: await section(() =>
			readTranscriptFacts(clickhouse, organizationId),
		),
		gitObservations: await section(() =>
			readGitObservations(clickhouse, organizationId),
		),
		edgeScopes: await section(() => readEdgeScopes(sql, organizationId)),
		edges: await section(() => readEdges(clickhouse, organizationId)),
		runIndex: await section(() => readRunIndex(clickhouse, organizationId)),
		storage,
	};
}

async function section<T>(read: () => Promise<T>): Promise<Section<T>> {
	try {
		return await read();
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function hasError<T extends object>(
	value: Section<T>,
): value is { error: string } {
	return "error" in value && typeof value.error === "string";
}

function organizationFilter(
	organizationId: string | undefined,
	alias = "",
): string {
	return organizationId === undefined
		? ""
		: `AND ${alias ? `${alias}.` : ""}organization_id = {organizationId:String}`;
}

/** The committed transcript generation of every session, as a CTE body. */
function committedTranscriptsSql(organizationId: string | undefined): string {
	return newestGenerations({
		columns: "any(source) AS session_source",
		and: organizationFilter(organizationId),
	});
}

const n = (value: unknown) => Number(value ?? 0);

async function readTranscripts(
	executor: ClickHouseExecutor,
	organizationId: string | undefined,
	storage: Section<StorageSection>,
): Promise<TranscriptsSection> {
	const rows = await executor.query<{
		source: string;
		parser_version: number;
		sessions: number;
		with_superseded: number;
		superseded_generations: number;
		superseded_rows: number;
	}>({
		clickhouse_settings: AUDIT_SETTINGS,
		query: `SELECT session_source AS source, committed_parser AS parser_version, count() AS sessions,
				countIf(generations > 1) AS with_superseded,
				sum(generations - 1) AS superseded_generations,
				sum(session_superseded_rows) AS superseded_rows
			FROM (
				SELECT any(generation_source) AS session_source,
					tupleElement(max(generation), 2) AS committed_parser,
					count() AS generations,
					sum(row_count) - argMax(row_count, generation) AS session_superseded_rows
				FROM (
					SELECT organization_id, user_id, session_id, (revision, parser_version) AS generation,
						any(source) AS generation_source, any(JSONExtractUInt(head, 'rowCount')) AS row_count
					FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
					WHERE ${receiptRow()} ${organizationFilter(organizationId)}
					GROUP BY organization_id, user_id, session_id, revision, parser_version
				)
				GROUP BY organization_id, user_id, session_id
			)
			GROUP BY session_source, committed_parser
			ORDER BY session_source, committed_parser`,
		query_params: {
			organizationId: organizationId ?? "",
		},
	});
	const committedByParser: TranscriptsSection["committedByParser"] = {};
	const totals = {
		sessions: 0,
		sessionsWithSuperseded: 0,
		supersededGenerations: 0,
		supersededRows: 0,
	};
	for (const row of rows) {
		const stats = {
			sessions: n(row.sessions),
			sessionsWithSuperseded: n(row.with_superseded),
			supersededGenerations: n(row.superseded_generations),
			supersededRows: n(row.superseded_rows),
		};
		entry(committedByParser, row.source, () => ({}))[`v${row.parser_version}`] =
			stats;
		totals.sessions += stats.sessions;
		totals.sessionsWithSuperseded += stats.sessionsWithSuperseded;
		totals.supersededGenerations += stats.supersededGenerations;
		totals.supersededRows += stats.supersededRows;
	}
	const table = hasError(storage)
		? undefined
		: storage.tables.transcript_records;
	return {
		committedByParser,
		totals: {
			...totals,
			estimatedSupersededBytes:
				table && table.rows > 0
					? Math.round(
							(totals.supersededRows * table.compressedBytes) / table.rows,
						)
					: null,
		},
	};
}

async function readTranscriptFacts(
	executor: ClickHouseExecutor,
	organizationId: string | undefined,
): Promise<TranscriptFactsSection> {
	const params = {
		organizationId: organizationId ?? "",
	};
	const [rows, receipts] = await Promise.all([
		executor.query<{
			source: string;
			parser_version: number;
			rows: number;
			generations: number;
			with_agent_version: number;
			with_entrypoint: number;
			with_facts: number;
		}>({
			clickhouse_settings: AUDIT_SETTINGS,
			query: `SELECT source, parser_version, count() AS rows,
					uniqExact(organization_id, user_id, session_id, revision) AS generations,
					countIf(agent_version != '') AS with_agent_version,
					countIf(entrypoint != '') AS with_entrypoint,
					countIf(notEmpty(facts)) AS with_facts
				FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
				WHERE ${contentRow()} ${organizationFilter(organizationId)}
				GROUP BY source, parser_version
				ORDER BY source, parser_version`,
			query_params: params,
		}),
		executor.query<{
			source: string;
			parser_version: number;
			receipts: number;
		}>({
			clickhouse_settings: AUDIT_SETTINGS,
			query: `SELECT source, parser_version,
						uniqExact(organization_id, user_id, session_id, revision) AS receipts
					FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
					WHERE ${receiptRow()} ${organizationFilter(organizationId)}
					GROUP BY source, parser_version`,
			query_params: params,
		}),
	]);
	const committed = new Map(
		receipts.map((row) => [
			`${row.source}/${row.parser_version}`,
			n(row.receipts),
		]),
	);
	const rowsByParser: TranscriptFactsSection["rowsByParser"] = {};
	for (const row of rows) {
		const total = n(row.rows);
		entry(rowsByParser, row.source, () => ({}))[`v${row.parser_version}`] = {
			rows: total,
			generations: n(row.generations),
			committedReceipts:
				committed.get(`${row.source}/${row.parser_version}`) ?? 0,
			withAgentVersion: n(row.with_agent_version),
			withEntrypoint: n(row.with_entrypoint),
			withFacts: n(row.with_facts),
			agentVersionShare: share(n(row.with_agent_version), total),
			factsShare: share(n(row.with_facts), total),
		};
	}
	return { rowsByParser };
}

async function readGitObservations(
	executor: ClickHouseExecutor,
	organizationId: string | undefined,
): Promise<GitObservationsSection> {
	const rows = await executor.query<{
		source: string;
		state: string;
		sessions: number;
	}>({
		clickhouse_settings: AUDIT_SETTINGS,
		query: `WITH records AS (${committedTranscriptsSql(organizationId)}),
			observed AS (
				SELECT organization_id, user_id, session_id,
					groupUniqArray(tuple(revision, transcript_parser_version, parser_version)) AS generations
				FROM ${getSafeClickHouseTable("rudel.session_git_observations")}
				WHERE ${receiptRow()} ${organizationFilter(organizationId)}
				GROUP BY organization_id, user_id, session_id
			)
			SELECT records.session_source AS source,
				multiIf(empty(observed.generations), 'none',
					arrayExists(g -> g.1 = records.generation.1 AND g.2 = records.generation.2
						AND g.3 = {gitExtractor:UInt32} * 256 + records.generation.2, observed.generations), 'current',
					arrayExists(g -> g.1 = records.generation.1 AND g.2 = records.generation.2, observed.generations), 'staleExtractor',
					'staleTranscript') AS state,
				count() AS sessions
			FROM records
			LEFT JOIN observed ON records.organization_id = observed.organization_id
				AND records.user_id = observed.user_id AND records.session_id = observed.session_id
			GROUP BY source, state
			ORDER BY source, state`,
		query_params: {
			gitExtractor: GIT_OBSERVATION_PARSER_VERSION,
			organizationId: organizationId ?? "",
		},
	});
	const bySource: GitObservationsSection["bySource"] = {};
	for (const row of rows) {
		const counts = entry(bySource, row.source, () => ({
			current: 0,
			staleExtractor: 0,
			staleTranscript: 0,
			none: 0,
		}));
		if (row.state in counts)
			counts[row.state as keyof typeof counts] = n(row.sessions);
	}
	return { bySource };
}

async function readEdgeScopes(
	sql: postgres.Sql,
	organizationId: string | undefined,
): Promise<EdgeScopesSection> {
	return sql.begin("read only", async (transaction) => {
		await transaction.unsafe("SET LOCAL statement_timeout = '30s'");
		const states = await transaction.unsafe<
			{
				scope_kind: string;
				state: string;
				resolver_version: number | null;
				scopes: number;
			}[]
		>(
			`SELECT scope_kind, resolver_version,
				CASE
					WHEN lease_expires_at > now() THEN 'running'
					WHEN request_count > built_request_count AND next_attempt_at = 'infinity' THEN 'parked'
					WHEN request_count > built_request_count AND last_error IS NOT NULL THEN 'failing'
					WHEN request_count > built_request_count THEN 'pending'
					WHEN frozen_reason IS NOT NULL THEN 'frozen'
					WHEN built_revision IS NULL THEN 'unbuilt'
					ELSE 'built'
				END AS state,
				count(*)::int AS scopes
			 FROM l1_edge_scope
			 WHERE ($1::text IS NULL OR organization_id = $1::text)
			 GROUP BY 1, 2, 3
			 ORDER BY 1, 2, 3`,
			[organizationId ?? null],
		);
		const due = await transaction.unsafe<
			{
				scope_kind: string;
				priority: number;
				scopes: number;
				oldest_seconds: number | null;
			}[]
		>(
			`SELECT scope_kind, priority::int AS priority, count(*)::int AS scopes,
				extract(epoch from now() - min(next_attempt_at))::float8 AS oldest_seconds
			 FROM l1_edge_scope
			 WHERE request_count > built_request_count AND next_attempt_at <= now()
				AND ($1::text IS NULL OR organization_id = $1::text)
			 GROUP BY 1, 2
			 ORDER BY 1, 2`,
			[organizationId ?? null],
		);
		const [truncated] = await transaction.unsafe<{ scopes: number }[]>(
			`SELECT count(*)::int AS scopes FROM l1_edge_scope
			 WHERE scope_kind = 'session' AND input->>'truncated' = 'true'
				AND ($1::text IS NULL OR organization_id = $1::text)`,
			[organizationId ?? null],
		);
		const byState: EdgeScopesSection["byState"] = {};
		for (const row of states) {
			const kind = entry(byState, row.scope_kind, () => ({}));
			entry(kind, row.state, () => ({}))[
				row.resolver_version === null ? "none" : `v${row.resolver_version}`
			] = n(row.scopes);
		}
		const dueByKind: EdgeScopesSection["due"] = {};
		for (const row of due)
			entry(dueByKind, row.scope_kind, () => ({}))[`priority${row.priority}`] =
				{
					scopes: n(row.scopes),
					oldestSeconds: Math.round(n(row.oldest_seconds)),
				};
		return {
			byState,
			due: dueByKind,
			truncatedSessionBuilds: n(truncated?.scopes),
		};
	});
}

async function readEdges(
	executor: ClickHouseExecutor,
	organizationId: string | undefined,
): Promise<EdgesSection> {
	const params = { organizationId: organizationId ?? "" };
	const where =
		organizationId === undefined
			? ""
			: "WHERE organization_id = {organizationId:String}";
	const [edges, resolutions] = await Promise.all([
		executor.query<{ relation: string; active: number; retracted: number }>({
			clickhouse_settings: AUDIT_SETTINGS,
			query: `SELECT relation, countIf(is_active = 1) AS active, countIf(is_active = 0) AS retracted
				FROM ${getSafeClickHouseTable(L1_EDGES_TABLE)} FINAL ${where}
				GROUP BY relation ORDER BY relation`,
			query_params: params,
		}),
		executor.query<{ target: string; status: string; active: number }>({
			clickhouse_settings: AUDIT_SETTINGS,
			query: `SELECT target, status, countIf(is_active = 1) AS active
				FROM ${getSafeClickHouseTable(L1_EDGE_RESOLUTIONS_TABLE)} FINAL ${where}
				GROUP BY target, status ORDER BY target, status`,
			query_params: params,
		}),
	]);
	const byRelation: EdgesSection["byRelation"] = {};
	for (const row of edges)
		byRelation[row.relation] = {
			active: n(row.active),
			retracted: n(row.retracted),
		};
	const byTarget: EdgesSection["resolutions"] = {};
	for (const row of resolutions)
		entry(byTarget, row.target, () => ({}))[row.status] = n(row.active);
	return { byRelation, resolutions: byTarget };
}

async function readRunIndex(
	executor: ClickHouseExecutor,
	organizationId: string | undefined,
): Promise<RunIndexSection> {
	const indexedSql = `SELECT organization_id, user_id, session_id, toUInt8(1) AS present,
			uniqExact(revision, parser_version, index_version, build_revision) AS snapshots,
			argMax(tuple(revision, parser_version, index_version, pricing_version, usage_receipt),
				tuple(revision, parser_version, index_version, build_revision)) AS committed
		FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
		WHERE row_kind = 'receipt' ${organizationFilter(organizationId)}
		GROUP BY organization_id, user_id, session_id`;
	const params = {
		indexVersion: RUN_INDEX_VERSION,
		organizationId: organizationId ?? "",
		pricingVersion: RUN_INDEX_PRICING_VERSION,
	};
	const [joined, indexedOnly] = await Promise.all([
		executor.query<Record<string, number>>({
			clickhouse_settings: AUDIT_SETTINGS,
			query: `WITH records AS (${committedTranscriptsSql(organizationId)}),
				indexed AS (${indexedSql})
				SELECT count() AS transcript_sessions,
					countIf(indexed.present = 1) AS indexed_sessions,
					countIf(indexed.present = 1
						AND tuple(indexed.committed.1, indexed.committed.2) = records.generation
						AND indexed.committed.3 = {indexVersion:UInt16}
						AND indexed.committed.4 = {pricingVersion:String}) AS current,
					countIf(indexed.present = 1 AND endsWith(indexed.committed.5, ':incomplete')) AS usage_incomplete,
					countIf(indexed.present = 1 AND startsWith(indexed.committed.5, 'unreceipted')) AS usage_unreceipted
				FROM records
				LEFT JOIN indexed ON records.organization_id = indexed.organization_id
					AND records.user_id = indexed.user_id AND records.session_id = indexed.session_id`,
			query_params: params,
		}),
		executor.query<Record<string, number>>({
			clickhouse_settings: AUDIT_SETTINGS,
			query: `SELECT count() AS indexed, countIf(snapshots > 1) AS superseded
				FROM (${indexedSql})`,
			query_params: params,
		}),
	]);
	const row = joined[0] ?? {};
	const all = indexedOnly[0] ?? {};
	const transcriptSessions = n(row.transcript_sessions);
	const indexed = n(row.indexed_sessions);
	const current = n(row.current);
	return {
		transcriptSessions,
		indexed,
		current,
		stale: indexed - current,
		missing: transcriptSessions - indexed,
		usageIncomplete: n(row.usage_incomplete),
		usageUnreceipted: n(row.usage_unreceipted),
		indexedWithoutTranscript: n(all.indexed) - indexed,
		sessionsWithSupersededSnapshots: n(all.superseded),
	};
}

async function readStorage(
	executor: ClickHouseExecutor,
): Promise<StorageSection> {
	const rows = await executor.query<{
		table: string;
		rows: number;
		compressed: number;
		uncompressed: number;
	}>({
		clickhouse_settings: AUDIT_SETTINGS,
		query: `SELECT table, sum(rows) AS rows, sum(data_compressed_bytes) AS compressed,
				sum(data_uncompressed_bytes) AS uncompressed
			FROM system.parts
			WHERE active AND database = 'rudel' AND table IN {tables:Array(String)}
			GROUP BY table ORDER BY table`,
		query_params: { tables: STORAGE_TABLES },
	});
	const tables: StorageSection["tables"] = {};
	for (const row of rows)
		tables[row.table] = {
			rows: n(row.rows),
			compressedBytes: n(row.compressed),
			uncompressedBytes: n(row.uncompressed),
		};
	return { tables };
}

/** The record's value at `key`, created first when missing. */
function entry<T>(
	record: Record<string, T>,
	key: string,
	create: () => NoInfer<T>,
): T {
	const existing = record[key];
	if (existing !== undefined) return existing;
	const created = create();
	record[key] = created;
	return created;
}

function share(part: number, total: number): number {
	return total === 0 ? 0 : Math.round((part / total) * 10_000) / 10_000;
}

/** Every numeric leaf of a report by its path (`runIndex.current`). */
export function flattenL1Audit(
	value: unknown,
	prefix = "",
	into = new Map<string, number | string>(),
): Map<string, number | string> {
	if (value === null || value === undefined) return into;
	if (typeof value === "number" || typeof value === "string") {
		into.set(prefix, value);
		return into;
	}
	if (typeof value === "object")
		for (const [key, child] of Object.entries(value))
			flattenL1Audit(child, prefix ? `${prefix}.${key}` : key, into);
	return into;
}

export interface L1AuditChange {
	path: string;
	before: number | string | null;
	after: number | string | null;
	delta: number | null;
}

/** What changed between two reports, path by path (`generatedAt` aside). */
export function compareL1Audits(
	before: unknown,
	after: unknown,
): L1AuditChange[] {
	const left = flattenL1Audit(before);
	const right = flattenL1Audit(after);
	const paths = [...new Set([...left.keys(), ...right.keys()])]
		.filter((path) => path !== "generatedAt")
		.sort();
	const changes: L1AuditChange[] = [];
	for (const path of paths) {
		const a = left.get(path) ?? null;
		const b = right.get(path) ?? null;
		if (a === b) continue;
		changes.push({
			path,
			before: a,
			after: b,
			delta:
				(typeof a === "number" || a === null) &&
				(typeof b === "number" || b === null)
					? (b ?? 0) - (a ?? 0)
					: null,
		});
	}
	return changes;
}

/** The compact text form: one `path value` line per leaf, by section. */
export function formatL1Audit(report: L1AuditReport): string {
	const lines: string[] = [
		`L1 audit ${report.organizationId ?? "(all organizations)"} at ${report.generatedAt}`,
	];
	for (const [name, value] of Object.entries(report)) {
		if (name === "generatedAt" || name === "organizationId") continue;
		lines.push("", `[${name}]`);
		for (const [path, leaf] of flattenL1Audit(value))
			lines.push(`  ${path || name} ${formatLeaf(path, leaf)}`);
	}
	return lines.join("\n");
}

function formatLeaf(path: string, value: number | string): string {
	if (typeof value === "string") return value;
	if (path.endsWith("Share")) return `${(value * 100).toFixed(1)}%`;
	if (path.endsWith("Bytes")) return `${value} (${humanBytes(value)})`;
	return String(value);
}

function humanBytes(value: number): string {
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let size = value;
	let unit = 0;
	while (Math.abs(size) >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit++;
	}
	return `${size.toFixed(1)} ${units[unit]}`;
}

export function formatL1AuditChanges(
	changes: readonly L1AuditChange[],
): string {
	if (changes.length === 0) return "No changes.";
	return changes
		.map(
			(change) =>
				`${change.path} ${change.before ?? "-"} -> ${change.after ?? "-"}${
					change.delta === null || change.delta === 0
						? ""
						: ` (${change.delta > 0 ? "+" : ""}${change.delta})`
				}`,
		)
		.join("\n");
}
