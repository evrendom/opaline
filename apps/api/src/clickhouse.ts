import {
	ClickHouseError,
	type ClickHouseSettings,
	createClient,
	parseError,
	TupleParam,
} from "@clickhouse/client-web";
import { getLogger } from "@logtape/logtape";
import { resolveClickHouseUsername } from "@rudel/ch-schema/connection";
import {
	CLAUDE_SESSION_ANALYTICS_MV_SQL,
	CODEX_SESSION_ANALYTICS_MV_SQL,
	SESSION_ANALYTICS_INSERT_COLUMNS,
} from "@rudel/ch-schema/session-analytics-mv";

const logger = getLogger(["rudel", "api", "clickhouse"]);

class ClickHouseHttpResponseError extends Error {
	readonly status: number;

	constructor(status: number, statusText: string) {
		super(
			`ClickHouse request failed with HTTP ${status}${statusText ? ` ${statusText}` : ""}`,
		);
		this.name = "ClickHouseHttpResponseError";
		this.status = status;
	}
}

const fetchWithClickHouseHttpStatus = Object.assign(
	async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		const response = await fetch(input, init);
		if (response.ok) return response;
		const parsedError = parseError(await response.clone().text());
		if (parsedError instanceof ClickHouseError) return response;
		throw new ClickHouseHttpResponseError(response.status, response.statusText);
	},
	{ preconnect: fetch.preconnect },
);

const INGEST_RECOVERY_QUERY_SETTINGS = {
	max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
	max_execution_time: 60,
	max_rows_to_read: "10000000",
	timeout_before_checking_execution_speed: 0,
} as const;

const SESSION_ANALYTICS_MV_FILTER_MARKER =
	"WHERE _is_capped OR length(_timestamps) > 0";

const ALLOWED_CLICKHOUSE_TABLES = new Set([
	"rudel.claude_sessions",
	"rudel.codex_sessions",
	"rudel.repository_session_evidence_index",
	"rudel.session_analytics",
	"rudel.session_language_signals",
	"rudel.session_lineage",
	"rudel.skill_receipts",
	"rudel.skill_uses",
	"rudel.skill_version_contents",
	"rudel.transcript_records",
	"rudel.usage_events",
	"rudel.wrapped_user_archetype_snapshots_v1",
]);

export interface ClickHouseStatement {
	abortSignal?: AbortSignal;
	clickhouse_settings?: ClickHouseSettings;
	query: string;
	query_params?: Record<string, unknown>;
	format?: "JSONEachRow";
}

export interface ClickHouseExecutor {
	close(): Promise<void>;
	execute(statement: ClickHouseStatement): Promise<void>;
	query<T>(statement: ClickHouseStatement): Promise<T[]>;
	insert(params: {
		abortSignal?: AbortSignal;
		asyncInsert?: boolean;
		deduplicationToken?: string;
		table: string;
		values: object[];
	}): Promise<void>;
}

export interface DurableClickHouseInsertRecovery {
	readonly id: string;
	readonly recovering: boolean;
	readReceipt: (target: string) => Promise<{ expectedRowCount: number } | null>;
	recordReceipt: (target: string, expectedRowCount: number) => Promise<void>;
}

export function createClickHouseInsertDeduplicationSettings(
	deduplicationToken: string = crypto.randomUUID(),
): ClickHouseSettings {
	return {
		async_insert_deduplicate: 1,
		deduplicate_blocks_in_dependent_materialized_views: 1,
		insert_deduplication_token: deduplicationToken,
	};
}

interface LatestRawSessionContentFilters {
	sessionDate?: boolean;
	sessionId?: boolean;
	source?: boolean;
	userId?: boolean;
	projectPath?: boolean;
	lookbackDays?: boolean;
}

/**
 * Latest transcript content from the raw tables that enforce 365-day retention.
 *
 * Callers must narrow the raw scan beyond organization. Analytics outlives raw
 * transcripts, so transcript-backed features return no row after raw expiry.
 */
export function buildLatestRawSessionContentSql(
	filters: LatestRawSessionContentFilters,
): string {
	const where = ["organization_id = {orgId:String}"];
	if (filters.sessionDate) {
		where.push(
			"session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')",
		);
	}
	if (filters.sessionId) where.push("session_id = {sessionId:String}");
	if (filters.userId) where.push("user_id = {userId:String}");
	if (filters.projectPath) where.push("project_path = {projectPath:String}");
	if (filters.lookbackDays) {
		where.push(
			"last_interaction_date >= now64(3) - toIntervalDay({days:UInt32})",
		);
	}

	if (where.length === 1) {
		throw new Error(
			"Raw transcript queries must be narrowed by session, user, project, or date",
		);
	}

	const rawWhere = where.join("\n      AND ");
	const claudeWhere = filters.source
		? `${rawWhere}\n      AND {source:String} = 'claude_code'`
		: rawWhere;
	const codexWhere = filters.source
		? `${rawWhere}\n      AND {source:String} = 'codex'`
		: rawWhere;

	return `
  SELECT
    source,
    organization_id,
    user_id,
    session_id,
    argMax(content, raw.revision) AS content,
    argMax(subagents, raw.revision) AS subagents,
    formatDateTime(argMax(ingested_at, raw.revision), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS ingested_at,
    toString(max(raw.revision)) AS revision
  FROM (
    SELECT
      'claude_code' AS source,
      organization_id,
      user_id,
      session_id,
      content,
      subagents,
      revision,
      ingested_at
    FROM rudel.claude_sessions
    WHERE ${claudeWhere}

    UNION ALL

    SELECT
      'codex' AS source,
      organization_id,
      user_id,
      session_id,
      content,
      CAST(map(), 'Map(String, String)') AS subagents,
      revision,
      ingested_at
    FROM rudel.codex_sessions
    WHERE ${codexWhere}
  ) AS raw
  GROUP BY source, organization_id, user_id, session_id
`;
}

export function getSafeClickHouseTable(table: string): string {
	if (!ALLOWED_CLICKHOUSE_TABLES.has(table)) {
		throw new Error(`Unsupported ClickHouse table: ${table}`);
	}
	return table;
}

export function createClickHouseExecutor(config: {
	url: string;
	username?: string;
	password?: string;
	database?: string;
}): ClickHouseExecutor {
	const client = createClient({
		url: config.url,
		username: config.username,
		password: config.password,
		database: config.database,
		fetch: fetchWithClickHouseHttpStatus,
		request_timeout: 120_000,
		clickhouse_settings: {
			max_execution_time: 60,
			timeout_before_checking_execution_speed: 0,
			wait_end_of_query: 1,
			output_format_json_quote_64bit_integers: 0,
		},
	});
	return {
		async close() {
			await client.close();
		},
		async execute(statement: ClickHouseStatement) {
			statement.abortSignal?.throwIfAborted();
			await client.command({
				abort_signal:
					statement.abortSignal === undefined
						? undefined
						: AbortSignal.any([statement.abortSignal]),
				clickhouse_settings: statement.clickhouse_settings,
				query: statement.query,
				query_params: statement.query_params,
			});
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			statement.abortSignal?.throwIfAborted();
			const result = await client.query({
				abort_signal:
					statement.abortSignal === undefined
						? undefined
						: AbortSignal.any([statement.abortSignal]),
				clickhouse_settings: statement.clickhouse_settings,
				query: statement.query,
				query_params: statement.query_params,
				format: statement.format ?? "JSONEachRow",
			});
			return result.json();
		},
		async insert(params) {
			params.abortSignal?.throwIfAborted();
			const table = getSafeClickHouseTable(params.table);
			// Use command() with FORMAT JSONEachRow instead of client.insert()
			// because ClickHouse Cloud's @clickhouse/client insert() silently drops data.
			// Single-row transcript inserts hit the parallel JSON parser's ~115 MB cliff.
			const rows = params.values.map((r) => JSON.stringify(r)).join("\n");
			const insertSettings =
				params.asyncInsert === false
					? "async_insert=0, input_format_parallel_parsing=0"
					: "async_insert=1, wait_for_async_insert=1, input_format_parallel_parsing=0";
			await client.command({
				abort_signal:
					params.abortSignal === undefined
						? undefined
						: AbortSignal.any([params.abortSignal]),
				clickhouse_settings: createClickHouseInsertDeduplicationSettings(
					params.deduplicationToken,
				),
				query: `INSERT INTO ${table} SETTINGS ${insertSettings} FORMAT JSONEachRow ${rows}`,
			});
		},
	};
}

export function createIdempotentClickHouseExecutor(
	executor: ClickHouseExecutor,
	recovery: DurableClickHouseInsertRecovery,
	onInsertAcknowledged: (table: string) => Promise<void>,
): ClickHouseExecutor {
	return {
		close: () => executor.close(),
		execute: (statement) => executor.execute(statement),
		async insert(params) {
			const expectedRowCount = params.values.length;
			if (expectedRowCount === 0) {
				throw new Error(
					"Durable ClickHouse insert must contain at least one row",
				);
			}
			const receipt = await recovery.readReceipt(params.table);
			if (receipt) {
				assertExpectedRecoveryRowCount(
					params.table,
					expectedRowCount,
					receipt.expectedRowCount,
				);
				return;
			}
			if (recovery.recovering) {
				const recovered = await recoverAcknowledgedClickHouseInsert(
					executor,
					params.table,
					params.values,
					recovery.id,
				);
				if (recovered) {
					await recovery.recordReceipt(params.table, expectedRowCount);
					return;
				}
			}
			await executor.insert({
				...params,
				deduplicationToken: `${recovery.id}:${params.table}`,
			});
			await onInsertAcknowledged(params.table);
			await recovery.recordReceipt(params.table, expectedRowCount);
		},
		query: <T>(statement: ClickHouseStatement) => executor.query<T>(statement),
	};
}

async function recoverAcknowledgedClickHouseInsert(
	executor: ClickHouseExecutor,
	target: string,
	values: readonly object[],
	recoveryId: string,
): Promise<boolean> {
	const expectedRowCount = values.length;
	const analyticsConfig = getSessionAnalyticsRecoveryConfig(target);
	const [recoveredRowCount, recoveredAnalyticsRowCount] = await Promise.all([
		countRecoveredClickHouseRows(executor, target, values, target),
		analyticsConfig
			? countRecoveredClickHouseRows(
					executor,
					"rudel.session_analytics",
					values,
					target,
				)
			: Promise.resolve(0),
	]);

	if (recoveredRowCount === 0) {
		if (recoveredAnalyticsRowCount !== 0) {
			throw new Error(
				`ClickHouse recovery found rudel.session_analytics without ${target}`,
			);
		}
		return false;
	}

	assertExpectedRecoveryRowCount(target, expectedRowCount, recoveredRowCount);
	if (!analyticsConfig) return true;

	if (recoveredAnalyticsRowCount === 0) {
		await executor.execute(
			buildSessionAnalyticsRepairStatement(
				target,
				values,
				`${recoveryId}:${target}:session-analytics-repair`,
			),
		);
		const repairedRowCount = await countRecoveredClickHouseRows(
			executor,
			"rudel.session_analytics",
			values,
			target,
		);
		assertExpectedRecoveryRowCount(
			"rudel.session_analytics",
			expectedRowCount,
			repairedRowCount,
		);
		return true;
	}

	assertExpectedRecoveryRowCount(
		"rudel.session_analytics",
		expectedRowCount,
		recoveredAnalyticsRowCount,
	);
	return true;
}

async function countRecoveredClickHouseRows(
	executor: ClickHouseExecutor,
	target: string,
	values: readonly object[],
	sourceTarget: string,
): Promise<number> {
	const statement = buildIngestRecoveryCountStatement(
		target,
		values,
		sourceTarget,
	);
	const [row] = await executor.query<{ physical: number | string }>(statement);
	const count = Number(row?.physical ?? 0);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error(`Invalid ClickHouse recovery count for ${target}`);
	}
	return count;
}

export function buildIngestRecoveryCountStatement(
	target: string,
	values: readonly object[],
	sourceTarget: string,
): ClickHouseStatement {
	const first = values[0];
	if (!first) throw new Error("ClickHouse recovery probe requires rows");
	const organizationId = readCommonString(values, "organization_id");
	const commonParams = { organizationId };

	switch (target) {
		case "rudel.claude_sessions":
		case "rudel.codex_sessions":
			return recoveryCountStatement(
				target,
				`organization_id = {organizationId:String}
					AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
					AND session_id = {sessionId:String}
					AND user_id = {userId:String}
					AND revision = {revision:UInt64}`,
				{
					...commonParams,
					...readRawSessionRecoveryParams(values),
				},
			);
		case "rudel.session_analytics": {
			const analyticsConfig = getSessionAnalyticsRecoveryConfig(sourceTarget);
			if (!analyticsConfig) {
				throw new Error(
					`Unsupported session analytics recovery source: ${sourceTarget}`,
				);
			}
			return recoveryCountStatement(
				target,
				`source = {source:String}
					AND organization_id = {organizationId:String}
					AND user_id = {userId:String}
					AND session_id = {sessionId:String}
					AND revision = {revision:UInt64}`,
				{
					...commonParams,
					...readRawSessionRecoveryParams(values),
					source: analyticsConfig.source,
				},
			);
		}
		case "rudel.session_language_signals":
			return recoveryCountStatement(
				target,
				`organization_id = {organizationId:String}
					AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
					AND session_id = {sessionId:String}
					AND source = {source:String}
					AND raw_revision = {rawRevision:UInt64}
					AND raw_ingested_at = parseDateTime64BestEffort({rawIngestedAt:String}, 3, 'UTC')
					AND scan_version = {scanVersion:UInt16}`,
				{
					...commonParams,
					rawIngestedAt: readCommonString(values, "raw_ingested_at"),
					rawRevision: readCommonString(values, "raw_revision"),
					scanVersion: readCommonNumber(values, "scan_version"),
					sessionDate: readCommonString(values, "session_date"),
					sessionId: readCommonString(values, "session_id"),
					source: readCommonString(values, "source"),
				},
			);
		case "rudel.skill_receipts":
			return recoveryCountStatement(
				target,
				`organization_id = {organizationId:String}
					AND agent = {agent:String}
					AND user_id = {userId:String}
					AND session_id = {sessionId:String}
					AND extraction_seq = {extractionSeq:UInt128}`,
				{
					...commonParams,
					agent: readCommonString(values, "agent"),
					extractionSeq: readCommonString(values, "extraction_seq"),
					sessionId: readCommonString(values, "session_id"),
					userId: readCommonString(values, "user_id"),
				},
			);
		case "rudel.skill_uses":
			return recoveryCountStatement(
				target,
				`organization_id = {organizationId:String}
					AND skill_name IN {skillNames:Array(String)}
					AND agent = {agent:String}
					AND user_id = {userId:String}
					AND session_id = {sessionId:String}
					AND extraction_seq = {extractionSeq:UInt128}`,
				{
					...commonParams,
					agent: readCommonString(values, "agent"),
					extractionSeq: readCommonString(values, "extraction_seq"),
					sessionId: readCommonString(values, "session_id"),
					skillNames: values.map((row) => readString(row, "skill_name")),
					userId: readCommonString(values, "user_id"),
				},
			);
		case "rudel.skill_version_contents":
			return recoveryCountStatement(
				target,
				`organization_id = {organizationId:String}
					AND (skill_name, content_sha256, user_id) IN {identities:Array(Tuple(String, FixedString(64), String))}
					AND extraction_seq = {extractionSeq:UInt128}`,
				{
					...commonParams,
					extractionSeq: readCommonString(values, "extraction_seq"),
					identities: values.map(
						(row) =>
							new TupleParam([
								readString(row, "skill_name"),
								readString(row, "content_sha256"),
								readString(row, "user_id"),
							]),
					),
				},
			);
		case "rudel.usage_events":
			// event_version is reserved once per durable session ingest, so this
			// full ORDER BY prefix identifies exactly that generation without
			// sending thousands of event IDs back through the recovery probe.
			return recoveryCountStatement(
				target,
				`organization_id = {organizationId:String}
					AND user_id = {userId:String}
					AND source = {source:String}
					AND session_id = {sessionId:String}
					AND event_version = {eventVersion:UInt64}`,
				{
					...commonParams,
					eventVersion: readCommonString(values, "event_version"),
					sessionId: readCommonString(values, "session_id"),
					source: readCommonString(values, "source"),
					userId: readCommonString(values, "user_id"),
				},
			);
		default:
			throw new Error(`Unsupported durable ClickHouse target: ${target}`);
	}
}

export function buildSessionAnalyticsRepairStatement(
	sourceTarget: string,
	values: readonly object[],
	deduplicationToken: string,
): ClickHouseStatement {
	const analyticsConfig = getSessionAnalyticsRecoveryConfig(sourceTarget);
	if (!analyticsConfig) {
		throw new Error(
			`Unsupported session analytics recovery source: ${sourceTarget}`,
		);
	}
	if (!values[0]) {
		throw new Error("Session analytics repair requires raw rows");
	}

	const markerParts = analyticsConfig.mvSql.split(
		SESSION_ANALYTICS_MV_FILTER_MARKER,
	);
	if (markerParts.length !== 2) {
		throw new Error(
			`Session analytics MV recovery marker count was ${markerParts.length - 1}`,
		);
	}
	const scopedMvSql = markerParts.join(
		`WHERE cs.organization_id = {organizationId:String}
			AND cs.session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
			AND cs.session_id = {sessionId:String}
			AND cs.user_id = {userId:String}
			AND cs.revision = {revision:UInt64}
			AND (_is_capped OR length(_timestamps) > 0)`,
	);
	const columnList = SESSION_ANALYTICS_INSERT_COLUMNS.map(
		(column) => `\`${column}\``,
	).join(",\n\t");

	return {
		clickhouse_settings:
			createClickHouseInsertDeduplicationSettings(deduplicationToken),
		query: `INSERT INTO rudel.session_analytics
(
	${columnList}
)
SETTINGS async_insert=0
SELECT
	${columnList}
FROM (
${scopedMvSql}
)`,
		query_params: {
			organizationId: readCommonString(values, "organization_id"),
			...readRawSessionRecoveryParams(values),
		},
	};
}

interface SessionAnalyticsRecoveryConfig {
	readonly mvSql: string;
	readonly source: "claude_code" | "codex";
}

function getSessionAnalyticsRecoveryConfig(
	sourceTarget: string,
): SessionAnalyticsRecoveryConfig | null {
	switch (sourceTarget) {
		case "rudel.claude_sessions":
			return {
				mvSql: CLAUDE_SESSION_ANALYTICS_MV_SQL,
				source: "claude_code",
			};
		case "rudel.codex_sessions":
			return { mvSql: CODEX_SESSION_ANALYTICS_MV_SQL, source: "codex" };
		default:
			return null;
	}
}

function readRawSessionRecoveryParams(
	values: readonly object[],
): Record<string, unknown> {
	return {
		ingestedAt: readCommonString(values, "ingested_at"),
		revision: readCommonString(values, "revision"),
		sessionDate: readCommonString(values, "session_date"),
		sessionId: readCommonString(values, "session_id"),
		userId: readCommonString(values, "user_id"),
	};
}

function recoveryCountStatement(
	target: string,
	where: string,
	queryParams: Record<string, unknown>,
): ClickHouseStatement {
	const table = getSafeClickHouseTable(target);
	return {
		clickhouse_settings: INGEST_RECOVERY_QUERY_SETTINGS,
		format: "JSONEachRow",
		query: `SELECT count() AS physical FROM ${table} WHERE ${where}`,
		query_params: queryParams,
	};
}

function assertExpectedRecoveryRowCount(
	target: string,
	expected: number,
	actual: number,
): void {
	if (actual !== expected) {
		throw new Error(
			`ClickHouse recovery row count mismatch for ${target}: expected ${expected}, found ${actual}`,
		);
	}
}

function readCommonString(rows: readonly object[], key: string): string {
	const value = readString(rows[0] ?? {}, key);
	for (const row of rows.slice(1)) {
		if (readString(row, key) !== value) {
			throw new Error(`ClickHouse recovery rows disagree on ${key}`);
		}
	}
	return value;
}

function readCommonNumber(rows: readonly object[], key: string): number {
	const value = readNumber(rows[0] ?? {}, key);
	for (const row of rows.slice(1)) {
		if (readNumber(row, key) !== value) {
			throw new Error(`ClickHouse recovery rows disagree on ${key}`);
		}
	}
	return value;
}

function readString(row: object, key: string): string {
	const value = Reflect.get(row, key);
	if (typeof value !== "string") {
		throw new Error(`ClickHouse recovery row is missing string ${key}`);
	}
	return value;
}

function readNumber(row: object, key: string): number {
	const value = Reflect.get(row, key);
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new Error(`ClickHouse recovery row is missing integer ${key}`);
	}
	return value;
}

let _clickhouse: ClickHouseExecutor | null = null;

export function getClickhouse(): ClickHouseExecutor {
	if (!_clickhouse) {
		const url = process.env.CLICKHOUSE_URL || "http://localhost:8123";
		const executor = createClickHouseExecutor({
			url,
			username: resolveClickHouseUsername(process.env, url),
			password: process.env.CLICKHOUSE_PASSWORD || "",
			database: "default",
		});
		const maxRetries = 3;
		_clickhouse = {
			...executor,
			async insert(params) {
				// Explicit tokens distinguish independent byte-identical inserts while
				// remaining stable across an acknowledgement-loss retry. Crash-recovery
				// callers provide their durable token instead of using this generated one.
				const deduplicationToken =
					params.deduplicationToken ?? crypto.randomUUID();
				for (let attempt = 0; attempt < maxRetries; attempt++) {
					try {
						return await executor.insert({
							...params,
							deduplicationToken,
						});
					} catch (error) {
						if (attempt === maxRetries - 1) {
							logger.error(
								"Insert into {table} failed after {maxRetries} attempts: {error}",
								{ table: params.table, maxRetries, error },
							);
							throw error;
						}
						logger.warn(
							"Insert into {table} failed (attempt {attempt}/{maxRetries}), retrying: {error}",
							{
								table: params.table,
								attempt: attempt + 1,
								maxRetries,
								error,
							},
						);
						await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
					}
				}
			},
		};
	}
	return _clickhouse;
}

export function addOptionalStringEqFilter(
	where: string[],
	query_params: Record<string, unknown>,
	column: string,
	paramName: string,
	value?: string,
): void {
	if (!value) return;
	where.push(`${column} = {${paramName}:String}`);
	query_params[paramName] = value;
}

export function addOptionalStringInFilter(
	where: string[],
	query_params: Record<string, unknown>,
	column: string,
	paramBase: string,
	values?: string[],
): void {
	if (!values || values.length === 0) return;
	const placeholders = values.map((value, index) => {
		const paramName = `${paramBase}_${index}`;
		query_params[paramName] = value;
		return `{${paramName}:String}`;
	});
	where.push(`${column} IN (${placeholders.join(", ")})`);
}

export function buildDateFilter(
	paramName: string,
	column = "session_date",
): string {
	return `${column} >= now64(3) - toIntervalDay({${paramName}:UInt32}) AND ${column} <= now64(3)`;
}

export function buildAbsoluteDateFilter(
	startParamName: string,
	endParamName: string,
	column = "session_date",
): string {
	return `toDate(${column}) >= toDate({${startParamName}:String}) AND toDate(${column}) <= toDate({${endParamName}:String})`;
}

export function buildInclusiveDateRangeFilter(
	startParamName: string,
	endParamName: string,
	column = "session_date",
): string {
	return buildAbsoluteDateFilter(startParamName, endParamName, column);
}

export async function queryClickhouse<T>(
	statement: ClickHouseStatement,
): Promise<T[]> {
	const ch = getClickhouse();
	return ch.query<T>(statement);
}
