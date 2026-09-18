import { getLogger } from "@logtape/logtape";
import {
	extractNativeCodexLineageEvidence,
	INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	type RawLineageSession,
} from "@rudel/api-routes";
import { type ClickHouseExecutor, getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import { projectNativeSessionLineage } from "./session-native-lineage.service.js";
import {
	recordSessionAgentMetadata,
	SessionAgentMetadataConflictError,
} from "./session-ownership.service.js";

const logger = getLogger(["rudel", "api", "session-native-metadata-discovery"]);
const NATIVE_METADATA_MAX_HEADER_BYTES = 64 * 1024;
const NATIVE_METADATA_MODEL_SEARCH_BYTES = 1024 * 1024;
const NATIVE_METADATA_LOCATOR_MAX_RESULT_BYTES = 8 * 1024 * 1024;
const NATIVE_METADATA_LOCATOR_MAX_MEMORY_BYTES = 256 * 1024 * 1024;
const NATIVE_METADATA_CONTENT_PRIMARY_MAX_BYTES_TO_READ = 160 * 1024 * 1024;
// Ingest accepts at most 128 MiB of transcript content. A one-row local
// reproduction needs just over twice that amount while ClickHouse decodes the
// String and evaluates the bounded header/model expressions. Keep the larger
// allowance on the exact, single-revision query only.
const NATIVE_METADATA_CONTENT_PRIMARY_MAX_MEMORY_BYTES = 384 * 1024 * 1024;
// A sparse granule can require decoding preceding Strings before ClickHouse
// reaches the exact key. The fallback repairs a measured four-row, near-limit
// granule while retaining a hard per-candidate bound.
const NATIVE_METADATA_CONTENT_FALLBACK_MAX_BYTES_TO_READ = 640 * 1024 * 1024;
const NATIVE_METADATA_CONTENT_FALLBACK_MAX_MEMORY_BYTES = 672 * 1024 * 1024;
const NATIVE_METADATA_CONTENT_MAX_RESULT_BYTES = 2 * 1024 * 1024;
const NATIVE_METADATA_SIZE_MAX_BYTES_TO_READ = 1024 * 1024;
const NATIVE_METADATA_SIZE_MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const NATIVE_MODEL_PATTERN =
	'(?m)^\\s*\\{[^\\n]*"type"\\s*:\\s*"turn_context"[^\\n]*"model"\\s*:\\s*"([A-Za-z0-9][A-Za-z0-9._:/-]{0,127})"[^\\n]*\\}\\s*$';

interface NativeMetadataDiscoveryCandidate {
	organization_id: string;
	session_id: string;
	user_id: string;
}

export interface NativeMetadataDiscoveryPassResult {
	readonly discovered: number;
	readonly hasMore: boolean;
	readonly missing: number;
	readonly nativeChildren: number;
	readonly projected: number;
	readonly readFailed: number;
	readonly rejected: number;
	readonly scanned: number;
	readonly skipped: number;
}

export async function runNativeMetadataDiscoveryPass(
	batchSize: number,
	deadline?: MaintenanceDeadline,
): Promise<NativeMetadataDiscoveryPassResult> {
	if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
		throw new Error("batchSize must be a positive safe integer");
	}
	if (!hasMaintenanceTimeRemaining(deadline)) {
		return emptyResult(true);
	}

	const candidates = await sqlClient<NativeMetadataDiscoveryCandidate[]>`
		SELECT organization_id, session_id, user_id
		FROM session_ownership
		WHERE agent_source IS NULL
			AND agent_metadata_scanned_at IS NULL
		ORDER BY created_at DESC, organization_id, user_id, session_id
		LIMIT ${batchSize + 1}
	`;
	const selected = candidates.slice(0, batchSize);
	const grouped = groupCandidatesByOwner(selected);
	let discovered = 0;
	let missing = 0;
	let nativeChildren = 0;
	let processed = 0;
	let projected = 0;
	let readFailed = 0;
	let rejected = 0;
	let skipped = 0;

	for (const group of grouped) {
		if (!hasMaintenanceTimeRemaining(deadline)) break;
		const rawLocators = await readRawSessionLocators(group);
		const locatorBySessionId = new Map(
			rawLocators.map((locator) => [locator.sessionId, locator]),
		);
		for (const candidate of group.candidates) {
			if (!hasMaintenanceTimeRemaining(deadline)) break;
			const locator = locatorBySessionId.get(candidate.session_id);
			if (!locator) {
				await markMetadataScanned(candidate, "missing");
				missing += 1;
				processed += 1;
				continue;
			}
			const contentRead = await readBoundedNativeMetadataContent(
				getClickhouse(),
				"rudel.codex_sessions",
				locator,
			);
			if (contentRead.failure) {
				logger.warn(
					"Native metadata content read failed within bounded ClickHouse limits (session_id={sessionId}, code={code}, type={type})",
					{
						code: contentRead.failure.code,
						sessionId: candidate.session_id,
						type: contentRead.failure.type,
					},
				);
				await markMetadataScanned(candidate, "content-read-failed");
				processed += 1;
				readFailed += 1;
				skipped += 1;
				continue;
			}
			const session = contentRead.content
				? { ...locator, ...contentRead.content, source: "codex" as const }
				: undefined;
			if (!session) {
				await markMetadataScanned(candidate, "missing");
				missing += 1;
				processed += 1;
				continue;
			}
			if (!session.headerComplete) {
				await markMetadataScanned(candidate, "oversized-header");
				processed += 1;
				skipped += 1;
				continue;
			}
			if (!session.modelSearchComplete) {
				await markMetadataScanned(candidate, "model-window-exhausted");
				processed += 1;
				skipped += 1;
				continue;
			}
			const parsed = parseHistoricalCodexMetadata(session);
			if (!parsed) {
				await markMetadataScanned(candidate, "invalid-header");
				processed += 1;
				skipped += 1;
				continue;
			}

			const { evidence, rawSession } = parsed;
			try {
				await recordSessionAgentMetadata(
					rawSession.organizationId,
					rawSession.sessionId,
					rawSession.userId,
					{
						nativeParentSessionId: evidence?.parentSessionId,
						nativeSubagentModel: evidence?.model,
						nativeSubagentPath: evidence?.agentPath,
						rawIngestedAt: rawSession.latestIngestedAt,
						rawSessionDate: rawSession.sessionDate,
						source: "codex",
					},
				);
			} catch (error) {
				if (!(error instanceof SessionAgentMetadataConflictError)) throw error;
				await markMetadataScanned(candidate, "rejected");
				processed += 1;
				rejected += 1;
				continue;
			}
			await markMetadataScanned(candidate, "codex");
			discovered += 1;
			nativeChildren += evidence ? 1 : 0;
			processed += 1;
			projected += (
				await projectNativeSessionLineage({
					organizationId: rawSession.organizationId,
					sessionId: rawSession.sessionId,
					userId: rawSession.userId,
				})
			).length;
		}
	}

	return {
		discovered,
		hasMore: processed < candidates.length,
		missing,
		nativeChildren,
		projected,
		readFailed,
		rejected,
		scanned: processed,
		skipped,
	};
}

interface CandidateGroup {
	readonly candidates: readonly NativeMetadataDiscoveryCandidate[];
	readonly organizationId: string;
	readonly userId: string;
}

function groupCandidatesByOwner(
	candidates: readonly NativeMetadataDiscoveryCandidate[],
): readonly CandidateGroup[] {
	const groups = new Map<string, NativeMetadataDiscoveryCandidate[]>();
	for (const candidate of candidates) {
		const key = `${candidate.organization_id}\u0000${candidate.user_id}`;
		const group = groups.get(key);
		if (group) group.push(candidate);
		else groups.set(key, [candidate]);
	}
	return Array.from(groups.values(), (group) => ({
		candidates: group,
		organizationId: group[0]?.organization_id ?? "",
		userId: group[0]?.user_id ?? "",
	}));
}

async function readRawSessionLocators(
	group: CandidateGroup,
): Promise<readonly RawNativeMetadataLocator[]> {
	const sessionIds = group.candidates.map((candidate) => candidate.session_id);
	return getClickhouse().query<RawNativeMetadataLocator>({
		clickhouse_settings: {
			max_bytes_to_read: "4000000000",
			max_execution_time: 10,
			max_memory_usage: String(NATIVE_METADATA_LOCATOR_MAX_MEMORY_BYTES),
			max_result_bytes: String(NATIVE_METADATA_LOCATOR_MAX_RESULT_BYTES),
			max_result_rows: String(group.candidates.length),
			max_threads: 1,
			result_overflow_mode: "throw",
			timeout_before_checking_execution_speed: 0,
		},
		query: `
			SELECT
				organization_id AS organizationId,
				argMax(user_id, revision) AS userId,
				session_id AS sessionId,
				argMax(project_path, revision) AS projectPath,
				toString(max(revision)) AS rawRevision,
				formatDateTime(argMax(session_date, revision), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS sessionDate,
				formatDateTime(min(ingested_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS firstIngestedAt,
				formatDateTime(argMax(ingested_at, revision), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS latestIngestedAt
			FROM rudel.codex_sessions
			PREWHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND has({sessionIds:Array(String)}, session_id)
			GROUP BY organization_id, session_id
		`,
		query_params: {
			organizationId: group.organizationId,
			sessionIds,
			userId: group.userId,
		},
	});
}

export interface NativeMetadataContentLocator
	extends Omit<RawLineageSession, "content" | "source"> {
	readonly rawRevision: string;
}

type RawNativeMetadataLocator = NativeMetadataContentLocator;

export interface RawNativeMetadataContent {
	readonly header: string;
	readonly headerComplete: number;
	readonly model: string;
	readonly modelSearchComplete: number;
}

interface NativeMetadataContentReadLimits {
	readonly maxBytesToRead: number;
	readonly maxMemoryBytes: number;
}

export interface NativeMetadataContentReadResult {
	readonly content?: RawNativeMetadataContent;
	readonly failure?: { readonly code: string; readonly type: string };
	readonly fallbackAttempted: boolean;
}

export async function readBoundedNativeMetadataContent(
	executor: Pick<ClickHouseExecutor, "query">,
	rawTable: string,
	locator: NativeMetadataContentLocator,
): Promise<NativeMetadataContentReadResult> {
	if (!/^rudel\.[a-z][a-z0-9_]*$/u.test(rawTable)) {
		throw new Error("Invalid native metadata raw table name");
	}
	try {
		return {
			content: await readRawSessionContent(executor, rawTable, locator, {
				maxBytesToRead: NATIVE_METADATA_CONTENT_PRIMARY_MAX_BYTES_TO_READ,
				maxMemoryBytes: NATIVE_METADATA_CONTENT_PRIMARY_MAX_MEMORY_BYTES,
			}),
			fallbackAttempted: false,
		};
	} catch (error) {
		const primaryFailure =
			classifyBoundedNativeMetadataContentReadFailure(error);
		if (!primaryFailure) throw error;
		let contentBytes: number;
		try {
			contentBytes = await readRawSessionContentBytes(
				executor,
				rawTable,
				locator,
			);
		} catch (sizeError) {
			const sizeFailure =
				classifyBoundedNativeMetadataContentReadFailure(sizeError);
			if (!sizeFailure) throw sizeError;
			return { failure: sizeFailure, fallbackAttempted: false };
		}
		if (contentBytes > INGEST_AGGREGATE_CONTENT_MAX_BYTES) {
			return {
				failure: {
					code: "CONTENT_TOO_LARGE",
					type: "CONTENT_TOO_LARGE_FOR_BOUNDED_FALLBACK",
				},
				fallbackAttempted: false,
			};
		}
		try {
			return {
				content: await readRawSessionContent(executor, rawTable, locator, {
					maxBytesToRead: NATIVE_METADATA_CONTENT_FALLBACK_MAX_BYTES_TO_READ,
					maxMemoryBytes: NATIVE_METADATA_CONTENT_FALLBACK_MAX_MEMORY_BYTES,
				}),
				fallbackAttempted: true,
			};
		} catch (fallbackError) {
			const fallbackFailure =
				classifyBoundedNativeMetadataContentReadFailure(fallbackError);
			if (!fallbackFailure) throw fallbackError;
			return { failure: fallbackFailure, fallbackAttempted: true };
		}
	}
}

async function readRawSessionContent(
	executor: Pick<ClickHouseExecutor, "query">,
	rawTable: string,
	locator: RawNativeMetadataLocator,
	limits: NativeMetadataContentReadLimits,
): Promise<RawNativeMetadataContent | undefined> {
	const [content] = await executor.query<RawNativeMetadataContent>({
		clickhouse_settings: {
			max_block_size: "1",
			max_bytes_to_read: String(limits.maxBytesToRead),
			max_execution_time: 10,
			max_memory_usage: String(limits.maxMemoryBytes),
			max_result_bytes: String(NATIVE_METADATA_CONTENT_MAX_RESULT_BYTES),
			max_result_rows: "1",
			max_threads: 1,
			result_overflow_mode: "throw",
			timeout_before_checking_execution_speed: 0,
		},
		query: `
			SELECT
				if(
					if(position(content, '\\n') = 0, length(content), position(content, '\\n') - 1)
						<= {maxHeaderBytes:UInt64},
					substring(
						content,
						1,
						if(position(content, '\\n') = 0, length(content), position(content, '\\n') - 1)
					),
					''
				) AS header,
				if(position(content, '\\n') = 0, length(content), position(content, '\\n') - 1)
					<= {maxHeaderBytes:UInt64} AS headerComplete,
				extract(
					substring(content, 1, {modelSearchBytes:UInt64}),
					{modelPattern:String}
				) AS model,
				length(content) <= {modelSearchBytes:UInt64}
					OR extract(
						substring(content, 1, {modelSearchBytes:UInt64}),
						{modelPattern:String}
					) != '' AS modelSearchComplete
			FROM ${rawTable}
			PREWHERE organization_id = {organizationId:String}
				AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
				AND session_id = {sessionId:String}
				AND user_id = {userId:String}
				AND revision = {rawRevision:UInt64}
			LIMIT 1
		`,
		query_params: {
			maxHeaderBytes: NATIVE_METADATA_MAX_HEADER_BYTES,
			modelPattern: NATIVE_MODEL_PATTERN,
			modelSearchBytes: NATIVE_METADATA_MODEL_SEARCH_BYTES,
			organizationId: locator.organizationId,
			rawRevision: locator.rawRevision,
			sessionDate: locator.sessionDate,
			sessionId: locator.sessionId,
			userId: locator.userId,
		},
	});
	return content;
}

async function readRawSessionContentBytes(
	executor: Pick<ClickHouseExecutor, "query">,
	rawTable: string,
	locator: RawNativeMetadataLocator,
): Promise<number> {
	const [row] = await executor.query<{ contentBytes: number | string }>({
		clickhouse_settings: {
			max_block_size: "1",
			max_bytes_to_read: String(NATIVE_METADATA_SIZE_MAX_BYTES_TO_READ),
			max_execution_time: 10,
			max_memory_usage: String(NATIVE_METADATA_SIZE_MAX_MEMORY_BYTES),
			max_result_bytes: "1024",
			max_result_rows: "1",
			max_threads: 1,
			result_overflow_mode: "throw",
			timeout_before_checking_execution_speed: 0,
		},
		query: `
			SELECT content.size AS contentBytes
			FROM ${rawTable}
			PREWHERE organization_id = {organizationId:String}
				AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
				AND session_id = {sessionId:String}
				AND user_id = {userId:String}
				AND revision = {rawRevision:UInt64}
			LIMIT 1
		`,
		query_params: {
			organizationId: locator.organizationId,
			rawRevision: locator.rawRevision,
			sessionDate: locator.sessionDate,
			sessionId: locator.sessionId,
			userId: locator.userId,
		},
	});
	const contentBytes = Number(row?.contentBytes);
	if (!Number.isSafeInteger(contentBytes) || contentBytes < 0) {
		throw new Error("ClickHouse returned an invalid native transcript size");
	}
	return contentBytes;
}

export function classifyBoundedNativeMetadataContentReadFailure(
	error: unknown,
): { readonly code: string; readonly type: string } | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = Reflect.get(error, "code");
	const type = Reflect.get(error, "type");
	if (
		typeof code !== "string" ||
		typeof type !== "string" ||
		!(
			(code === "159" && type === "TIMEOUT_EXCEEDED") ||
			(code === "241" && type === "MEMORY_LIMIT_EXCEEDED") ||
			(code === "307" && type === "TOO_MANY_BYTES")
		)
	) {
		return undefined;
	}
	return { code, type };
}

interface RawNativeMetadataSession extends Omit<RawLineageSession, "content"> {
	readonly header: string;
	readonly headerComplete: number;
	readonly model: string;
	readonly modelSearchComplete: number;
}

function parseHistoricalCodexMetadata(session: RawNativeMetadataSession):
	| {
			readonly evidence: ReturnType<typeof extractNativeCodexLineageEvidence>;
			readonly rawSession: RawLineageSession;
	  }
	| undefined {
	let firstRecord: unknown;
	try {
		firstRecord = JSON.parse(session.header);
	} catch {
		return undefined;
	}
	if (!isRecord(firstRecord) || firstRecord.type !== "session_meta") {
		return undefined;
	}
	const payload = isRecord(firstRecord.payload)
		? firstRecord.payload
		: undefined;
	if (payload?.id !== session.sessionId) return undefined;
	const modelRecord = session.model
		? `\n${JSON.stringify({ payload: { model: session.model } })}`
		: "";
	const rawSession: RawLineageSession = {
		...session,
		content: `${session.header}${modelRecord}`,
	};
	const evidence = extractNativeCodexLineageEvidence(rawSession);
	if (payload.thread_source === "subagent" && !evidence) return undefined;
	return { evidence, rawSession };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function markMetadataScanned(
	candidate: NativeMetadataDiscoveryCandidate,
	outcome: string,
): Promise<void> {
	await sqlClient`
		UPDATE session_ownership
		SET
			agent_metadata_scan_outcome = COALESCE(
				agent_metadata_scan_outcome,
				${outcome}
			),
			agent_metadata_scanned_at = COALESCE(
				agent_metadata_scanned_at,
				clock_timestamp()
			)
		WHERE organization_id = ${candidate.organization_id}
			AND session_id = ${candidate.session_id}
			AND user_id = ${candidate.user_id}
	`;
}

function emptyResult(hasMore: boolean): NativeMetadataDiscoveryPassResult {
	return {
		discovered: 0,
		hasMore,
		missing: 0,
		nativeChildren: 0,
		projected: 0,
		readFailed: 0,
		rejected: 0,
		scanned: 0,
		skipped: 0,
	};
}
