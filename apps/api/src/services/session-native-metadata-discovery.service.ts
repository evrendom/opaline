import {
	extractNativeCodexLineageEvidence,
	type RawLineageSession,
} from "@rudel/api-routes";
import { getClickhouse } from "../clickhouse.js";
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

const NATIVE_METADATA_MAX_HEADER_BYTES = 64 * 1024;
const NATIVE_METADATA_MODEL_SEARCH_BYTES = 1024 * 1024;
const NATIVE_METADATA_MAX_RESULT_BYTES = 8 * 1024 * 1024;
const NATIVE_METADATA_MAX_MEMORY_BYTES = 256 * 1024 * 1024;
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
	let rejected = 0;
	let skipped = 0;

	for (const group of grouped) {
		if (!hasMaintenanceTimeRemaining(deadline)) break;
		const rawSessions = await readRawSessions(group);
		const rawBySessionId = new Map(
			rawSessions.map((session) => [session.sessionId, session]),
		);
		for (const candidate of group.candidates) {
			if (!hasMaintenanceTimeRemaining(deadline)) break;
			const session = rawBySessionId.get(candidate.session_id);
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

async function readRawSessions(
	group: CandidateGroup,
): Promise<readonly RawNativeMetadataSession[]> {
	const sessionIds = group.candidates.map((candidate) => candidate.session_id);
	return getClickhouse().query<RawNativeMetadataSession>({
		clickhouse_settings: {
			max_block_size: "1",
			max_bytes_to_read: "4000000000",
			max_execution_time: 10,
			max_memory_usage: String(NATIVE_METADATA_MAX_MEMORY_BYTES),
			max_result_bytes: String(NATIVE_METADATA_MAX_RESULT_BYTES),
			max_result_rows: String(group.candidates.length),
			max_threads: 1,
			result_overflow_mode: "throw",
			timeout_before_checking_execution_speed: 0,
		},
		query: `
			SELECT
				'codex' AS source,
				organization_id AS organizationId,
				argMax(user_id, ingested_at) AS userId,
				session_id AS sessionId,
				argMax(
					if(
						if(position(content, '\\n') = 0, length(content), position(content, '\\n') - 1)
							<= {maxHeaderBytes:UInt64},
						substring(
							content,
							1,
							if(position(content, '\\n') = 0, length(content), position(content, '\\n') - 1)
						),
						''
					),
					ingested_at
				) AS header,
				argMax(
					if(position(content, '\\n') = 0, length(content), position(content, '\\n') - 1)
						<= {maxHeaderBytes:UInt64},
					ingested_at
				) AS headerComplete,
				argMax(
					extract(
						substring(content, 1, {modelSearchBytes:UInt64}),
						{modelPattern:String}
					),
					ingested_at
				) AS model,
				argMax(
					length(content) <= {modelSearchBytes:UInt64}
						OR extract(
							substring(content, 1, {modelSearchBytes:UInt64}),
							{modelPattern:String}
						) != '',
					ingested_at
				) AS modelSearchComplete,
				argMax(project_path, ingested_at) AS projectPath,
				formatDateTime(argMax(session_date, ingested_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS sessionDate,
				formatDateTime(min(ingested_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS firstIngestedAt,
				formatDateTime(max(ingested_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS latestIngestedAt
			FROM rudel.codex_sessions
			PREWHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND has({sessionIds:Array(String)}, session_id)
			GROUP BY organization_id, session_id
		`,
		query_params: {
			organizationId: group.organizationId,
			maxHeaderBytes: NATIVE_METADATA_MAX_HEADER_BYTES,
			modelPattern: NATIVE_MODEL_PATTERN,
			modelSearchBytes: NATIVE_METADATA_MODEL_SEARCH_BYTES,
			sessionIds,
			userId: group.userId,
		},
	});
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
		rejected: 0,
		scanned: 0,
		skipped: 0,
	};
}
