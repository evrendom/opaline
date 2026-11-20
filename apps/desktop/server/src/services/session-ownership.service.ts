import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { sqlClient } from "../db.js";
import type { IngestContentShape } from "../lib/ingest-content-shape.js";
import { sessionArrivalChannel } from "./session-arrival-channel.js";
import { UsageExtractionSupersededError } from "./usage-extraction-superseded.error.js";

export { UsageExtractionSupersededError } from "./usage-extraction-superseded.error.js";

const logger = getLogger(["rudel", "api", "session-ownership"]);

type SessionOwnershipClaim =
	| {
			owned: true;
			lastAssistantLineCount: number | null;
			lastContentBytes: number | null;
			lastContentSha256: string | null;
			lastContentShape: IngestContentShape | null;
			lastFilterVersion: number | null;
			lastSessionDate: Date | null;
			lastUsageContentSha256: string | null;
			lastUsageChecksum: string | null;
			lastUsageExtractionVersion: number | null;
			lastUsageEventIdentityVersion: number | null;
			lastUsageModelRateCardVersion: string | null;
	  }
	| { owned: false; ownerId: string };

interface ReservedSessionOwner {
	lastAssistantLineCount: number | null;
	lastContentBytes: number | null;
	lastContentSha256: string | null;
	lastContentShape: IngestContentShape | null;
	lastFilterVersion: number | null;
	lastSessionDate: Date | null;
	lastUsageContentSha256: string | null;
	lastUsageChecksum: string | null;
	lastUsageExtractionVersion: number | null;
	lastUsageEventIdentityVersion: number | null;
	lastUsageModelRateCardVersion: string | null;
	userId: string;
}

interface UsageExtractionReceiptRecord {
	checksum: string;
	diagnostics: string;
	eventCount: number;
	extractionVersion: number;
	eventIdentityVersion: number;
	generation: string;
	modelRateCardVersion: string;
}

export interface SessionAgentMetadata {
	readonly nativeParentSessionId?: string;
	readonly nativeSubagentModel?: string;
	readonly nativeSubagentPath?: string;
	readonly rawIngestedAt?: string;
	readonly rawSessionDate?: string;
	readonly source: "claude_code" | "codex";
}

export class SessionAgentMetadataConflictError extends Error {
	constructor() {
		super(
			"Session agent metadata conflicts with the existing ownership record",
		);
		this.name = "SessionAgentMetadataConflictError";
	}
}

export interface UsageBackfillOwnershipState {
	lastContentSha256: string | null;
	lastIngestedAt: Date | null;
	lastUsageContentSha256: string | null;
	lastUsageChecksum: string | null;
	lastUsageExtractionVersion: number | null;
	lastUsageEventIdentityVersion: number | null;
	lastUsageModelRateCardVersion: string | null;
	userId: string;
}

export interface UsageBackfillOwnershipStateRow
	extends UsageBackfillOwnershipState {
	organizationId: string;
	sessionId: string;
}

interface UsageBackfillOwnershipDatabaseRow {
	last_content_sha256: string | null;
	last_ingested_at: Date | null;
	last_usage_checksum: string | null;
	last_usage_content_sha256: string | null;
	last_usage_extraction_version: number | null;
	last_usage_event_identity_version: number | null;
	last_usage_model_rate_card_version: string | null;
	organization_id: string;
	session_id: string;
	user_id: string;
}

export async function claimSessionIngestOwnership(
	organizationId: string,
	sessionId: string,
	userId: string,
	database: postgres.Sql | postgres.ReservedSql = sqlClient,
): Promise<SessionOwnershipClaim> {
	const reservedOwner = await reserveSessionOwner(
		organizationId,
		sessionId,
		userId,
		database,
	);
	return getOwnershipClaim(reservedOwner, organizationId, sessionId, userId);
}

export async function recordSessionAgentMetadata(
	organizationId: string,
	sessionId: string,
	userId: string,
	metadata: SessionAgentMetadata,
	database: postgres.Sql = sqlClient,
): Promise<void> {
	if (
		(metadata.rawIngestedAt === undefined) !==
		(metadata.rawSessionDate === undefined)
	) {
		throw new SessionAgentMetadataConflictError();
	}
	if (
		metadata.nativeParentSessionId !== undefined &&
		(metadata.source !== "codex" ||
			metadata.nativeParentSessionId === sessionId)
	) {
		throw new SessionAgentMetadataConflictError();
	}
	await database.begin(async (transaction) => {
		// Serialize lineage changes per organization so two concurrent opposite
		// edges cannot both pass the cycle check.
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			[`session-native-lineage:${organizationId}`],
		);
		const [row] = await transaction.unsafe<Array<{ session_id: string }>>(
			`
			WITH RECURSIVE ancestors(session_id, parent_session_id) AS (
				SELECT session_id, native_parent_session_id
				FROM session_ownership
				WHERE organization_id = $1
					AND user_id = $2
					AND session_id = $5
					AND agent_source = 'codex'
				UNION
				SELECT parent.session_id, parent.native_parent_session_id
				FROM session_ownership parent
				JOIN ancestors child ON child.parent_session_id = parent.session_id
				WHERE parent.organization_id = $1
					AND parent.user_id = $2
					AND parent.agent_source = 'codex'
			)
			UPDATE session_ownership
			SET
				agent_source = COALESCE(agent_source, $4),
				native_parent_session_id = COALESCE(native_parent_session_id, $5),
				native_subagent_model = CASE
					WHEN $6::text IS NULL THEN native_subagent_model
					WHEN native_subagent_model IS NULL OR native_subagent_model = 'codex'
						THEN $6
					ELSE native_subagent_model
				END,
				native_subagent_path = COALESCE(native_subagent_path, $7),
				last_session_date = CASE
					WHEN $8::timestamptz IS NULL THEN last_session_date
					WHEN last_ingested_at IS NULL OR last_ingested_at <= $9::timestamptz
						THEN $8::timestamptz
					ELSE last_session_date
				END,
				last_ingested_at = CASE
					WHEN $9::timestamptz IS NULL THEN last_ingested_at
					ELSE GREATEST(
						COALESCE(last_ingested_at, '-infinity'::timestamptz),
						$9::timestamptz
					)
				END
			WHERE organization_id = $1
				AND user_id = $2
				AND session_id = $3
				AND (agent_source IS NULL OR agent_source = $4)
				AND (
					$5::text IS NULL
					OR native_parent_session_id IS NULL
					OR native_parent_session_id = $5
				)
				AND NOT EXISTS (
					SELECT 1
					FROM session_ownership conflicting_parent
					WHERE conflicting_parent.organization_id = $1
						AND conflicting_parent.session_id = $5
						AND (
							conflicting_parent.user_id <> $2
							OR conflicting_parent.agent_source NOT IN ('codex')
						)
				)
				AND NOT EXISTS (
					SELECT 1
					FROM ancestors
					WHERE session_id = $3 OR parent_session_id = $3
				)
			RETURNING session_id
			`,
			[
				organizationId,
				userId,
				sessionId,
				metadata.source,
				metadata.nativeParentSessionId ?? null,
				metadata.nativeSubagentModel ?? null,
				metadata.nativeSubagentPath ?? null,
				metadata.rawSessionDate ?? null,
				metadata.rawIngestedAt ?? null,
			],
		);
		if (!row) throw new SessionAgentMetadataConflictError();
	});
}

export async function recordSessionIngestContent(
	organizationId: string,
	sessionId: string,
	contentSha256: string,
	contentShape: IngestContentShape,
	filterVersion: number,
	sessionDate: Date,
	ingestedAt: Date,
	revision: string,
	usageReceipt?: UsageExtractionReceiptRecord,
	options?: { readonly deferArrivalNotification?: boolean },
): Promise<void> {
	// Raw bookkeeping follows the shared revision ordering. Usage extraction must
	// match both its reserved generation and the raw revision it describes.
	const ingestedAtIso = ingestedAt.toISOString();
	return sqlClient.begin(async (transaction) => {
		const [ownership] = await transaction.unsafe<
			Array<{ isFirstCompletion: boolean }>
		>(
			`
			UPDATE session_ownership
			SET
				last_content_sha256 = $1,
				last_content_bytes = $2,
				last_assistant_line_count = $3,
				last_content_shape_json = $4,
				last_filter_version = $5,
				last_session_date = $6,
				last_ingested_at = $7,
				last_revision = $8::bigint
			WHERE organization_id = $9
				AND session_id = $10
				AND (
					last_revision IS NULL
					OR last_revision <= $8::bigint
				)
			RETURNING last_usage_completed_at IS NULL AS "isFirstCompletion"
			`,
			[
				contentSha256,
				contentShape.contentBytes,
				contentShape.assistantLineCount,
				JSON.stringify(contentShape),
				filterVersion,
				sessionDate.toISOString(),
				ingestedAtIso,
				revision,
				organizationId,
				sessionId,
			],
		);
		if (!usageReceipt) return;

		const completed = await transaction.unsafe<Array<{ generation: string }>>(
			`
			UPDATE session_ownership
			SET
				last_usage_content_sha256 = $1,
				last_usage_extraction_version = $2,
				last_usage_event_identity_version = $3,
				last_usage_model_rate_card_version = $4,
				last_usage_event_count = $5,
				last_usage_checksum = $6,
				last_usage_diagnostics_json = $7,
				last_usage_completed_generation = $8,
				last_usage_completed_at = NOW()
				WHERE organization_id = $9
					AND session_id = $10
					AND usage_extraction_generation = $8
					AND last_revision = $11::bigint
				RETURNING usage_extraction_generation::text AS generation
			`,
			[
				contentSha256,
				usageReceipt.extractionVersion,
				usageReceipt.eventIdentityVersion,
				usageReceipt.modelRateCardVersion,
				usageReceipt.eventCount,
				usageReceipt.checksum,
				usageReceipt.diagnostics,
				usageReceipt.generation,
				organizationId,
				sessionId,
				revision,
			],
		);
		if (completed.length !== 1) {
			throw new UsageExtractionSupersededError();
		}
		if (ownership?.isFirstCompletion && !options?.deferArrivalNotification) {
			// Delivered only after this successful receipt transaction commits.
			await transaction.unsafe("SELECT pg_notify($1, '')", [
				sessionArrivalChannel(organizationId),
			]);
		}
	});
}

export async function notifyPendingSessionArrival(
	organizationId: string,
	sessionId: string,
	userId: string,
): Promise<boolean> {
	return sqlClient.begin(async (transaction) => {
		const payload = await markPendingSessionArrival(
			organizationId,
			sessionId,
			userId,
			transaction,
		);
		if (payload === null) return false;
		await transaction.unsafe("SELECT pg_notify($1, $2)", [
			sessionArrivalChannel(organizationId),
			payload,
		]);
		return true;
	});
}

export async function markPendingSessionArrival(
	organizationId: string,
	sessionId: string,
	userId: string,
	database: postgres.Sql | postgres.TransactionSql,
): Promise<"" | "lineage-refresh" | null> {
	const [pending] = await database.unsafe<
		Array<{ native_parent_session_id: string | null }>
	>(
		`
		UPDATE session_ownership
		SET arrival_notified_at = NOW()
		WHERE organization_id = $1
			AND session_id = $2
			AND user_id = $3
			AND agent_source = 'codex'
			AND last_usage_completed_at IS NOT NULL
			AND arrival_notified_at IS NULL
		RETURNING native_parent_session_id
		`,
		[organizationId, sessionId, userId],
	);
	if (!pending) return null;
	return pending.native_parent_session_id === null ? "" : "lineage-refresh";
}

export async function reserveUsageExtractionGeneration(
	organizationId: string,
	sessionId: string,
	userId: string,
	expectedRevision: string,
	database: postgres.Sql | postgres.ReservedSql = sqlClient,
): Promise<string> {
	const [row] = await database.unsafe<Array<{ generation: string }>>(
		`
			UPDATE session_ownership
			SET usage_extraction_generation = GREATEST(
				usage_extraction_generation + 1,
				FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
			)
			WHERE organization_id = $1
				AND session_id = $2
				AND user_id = $3
				AND last_revision = $4::bigint
			RETURNING usage_extraction_generation::text AS generation
		`,
		[organizationId, sessionId, userId, expectedRevision],
	);
	if (!row) {
		throw new UsageExtractionSupersededError();
	}
	return row.generation;
}

/**
 * Reserve a backfill generation only while the raw snapshot is still current.
 * A live upload that records newer content wins without requiring ingest to be
 * quiesced; a live extraction reserved after this call receives a higher
 * generation and supersedes the backfill rows.
 */
export async function reserveUsageBackfillGeneration(
	organizationId: string,
	sessionId: string,
	userId: string,
	expectedContentSha256: string,
	cutoff: Date,
): Promise<string | null> {
	const [row] = await sqlClient<Array<{ generation: string }>>`
		UPDATE session_ownership
		SET usage_extraction_generation = GREATEST(
			usage_extraction_generation + 1,
			FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
		)
		WHERE organization_id = ${organizationId}
			AND session_id = ${sessionId}
			AND user_id = ${userId}
			AND (
				last_content_sha256 IS NULL
				OR last_content_sha256 = ${expectedContentSha256}
			)
			AND (
				last_ingested_at IS NULL
				OR last_ingested_at <= ${cutoff.toISOString()}
			)
		RETURNING usage_extraction_generation::text AS generation
	`;
	return row?.generation ?? null;
}

export async function listUsageBackfillOwnershipStates(options: {
	maxRows: number;
	organizationId?: string;
}): Promise<readonly UsageBackfillOwnershipStateRow[]> {
	const organizationPredicate = options.organizationId
		? "WHERE organization_id = $1"
		: "";
	const limitParameter = options.organizationId ? "$2" : "$1";
	const parameters = options.organizationId
		? [options.organizationId, options.maxRows]
		: [options.maxRows];
	const rows = await sqlClient.unsafe<UsageBackfillOwnershipDatabaseRow[]>(
		`
			SELECT
				organization_id,
				session_id,
				user_id,
				last_content_sha256,
				last_ingested_at,
				last_usage_content_sha256,
				last_usage_checksum,
				last_usage_extraction_version,
				last_usage_event_identity_version,
				last_usage_model_rate_card_version
			FROM session_ownership
			${organizationPredicate}
			ORDER BY organization_id, session_id
			LIMIT ${limitParameter}
		`,
		parameters,
	);
	return rows.map(mapUsageBackfillOwnershipState);
}

function mapUsageBackfillOwnershipState(
	row: UsageBackfillOwnershipDatabaseRow,
): UsageBackfillOwnershipStateRow {
	return {
		lastContentSha256: row.last_content_sha256,
		lastIngestedAt: row.last_ingested_at,
		lastUsageChecksum: row.last_usage_checksum,
		lastUsageContentSha256: row.last_usage_content_sha256,
		lastUsageExtractionVersion: row.last_usage_extraction_version,
		lastUsageEventIdentityVersion: row.last_usage_event_identity_version,
		lastUsageModelRateCardVersion: row.last_usage_model_rate_card_version,
		organizationId: row.organization_id,
		sessionId: row.session_id,
		userId: row.user_id,
	};
}

export async function recordUsageBackfillReceipt(
	organizationId: string,
	sessionId: string,
	contentSha256: string,
	receipt: UsageExtractionReceiptRecord,
): Promise<void> {
	const completed = await sqlClient<Array<{ generation: string }>>`
		UPDATE session_ownership
		SET
			last_usage_content_sha256 = ${contentSha256},
			last_usage_extraction_version = ${receipt.extractionVersion},
			last_usage_event_identity_version = ${receipt.eventIdentityVersion},
			last_usage_model_rate_card_version = ${receipt.modelRateCardVersion},
			last_usage_event_count = ${receipt.eventCount},
			last_usage_checksum = ${receipt.checksum},
			last_usage_diagnostics_json = ${receipt.diagnostics},
			last_usage_completed_generation = ${receipt.generation},
			last_usage_completed_at = NOW()
		WHERE organization_id = ${organizationId}
			AND session_id = ${sessionId}
			AND usage_extraction_generation = ${receipt.generation}
		RETURNING usage_extraction_generation::text AS generation
	`;
	if (completed.length !== 1) {
		throw new UsageExtractionSupersededError();
	}
}

export async function getSessionOwner(
	organizationId: string,
	sessionId: string,
): Promise<string | null> {
	const [row] = await sqlClient<Array<{ user_id: string }>>`
		SELECT user_id
		FROM session_ownership
		WHERE organization_id = ${organizationId}
			AND session_id = ${sessionId}
		LIMIT 1
	`;
	return row?.user_id ?? null;
}

async function reserveSessionOwner(
	organizationId: string,
	sessionId: string,
	candidateOwner: string,
	database: postgres.Sql | postgres.ReservedSql,
): Promise<ReservedSessionOwner> {
	// The no-op update returns the winning row when a concurrent insert wins.
	const [row] = await database.unsafe<
		Array<{
			last_assistant_line_count: number | null;
			last_content_bytes: number | null;
			last_content_sha256: string | null;
			last_content_shape_json: string | null;
			last_filter_version: number | null;
			last_session_date: Date | null;
			last_usage_content_sha256: string | null;
			last_usage_checksum: string | null;
			last_usage_extraction_version: number | null;
			last_usage_event_identity_version: number | null;
			last_usage_model_rate_card_version: string | null;
			user_id: string;
		}>
	>(
		`
		INSERT INTO session_ownership AS ownership (
			organization_id,
			session_id,
			user_id
		)
		VALUES (
			$1,
			$2,
			$3
		)
		ON CONFLICT (organization_id, session_id) DO UPDATE
		SET user_id = ownership.user_id
		RETURNING
			user_id,
			last_content_sha256,
			last_content_bytes,
			last_assistant_line_count,
			last_content_shape_json,
			last_filter_version,
			last_session_date,
			last_usage_content_sha256,
			last_usage_checksum,
			last_usage_extraction_version,
			last_usage_event_identity_version,
			last_usage_model_rate_card_version
		`,
		[organizationId, sessionId, candidateOwner],
	);
	if (!row) {
		throw new Error("Session ownership reservation did not return an owner");
	}
	return {
		lastAssistantLineCount: row.last_assistant_line_count,
		lastContentBytes: row.last_content_bytes,
		lastContentSha256: row.last_content_sha256,
		lastContentShape: parseContentShape(row.last_content_shape_json),
		lastFilterVersion: row.last_filter_version,
		lastSessionDate: row.last_session_date,
		lastUsageContentSha256: row.last_usage_content_sha256,
		lastUsageChecksum: row.last_usage_checksum,
		lastUsageExtractionVersion: row.last_usage_extraction_version,
		lastUsageEventIdentityVersion: row.last_usage_event_identity_version,
		lastUsageModelRateCardVersion: row.last_usage_model_rate_card_version,
		userId: row.user_id,
	};
}

function getOwnershipClaim(
	reservedOwner: ReservedSessionOwner,
	organizationId: string,
	sessionId: string,
	userId: string,
): SessionOwnershipClaim {
	if (reservedOwner.userId === userId) {
		return {
			owned: true,
			lastAssistantLineCount: reservedOwner.lastAssistantLineCount,
			lastContentBytes: reservedOwner.lastContentBytes,
			lastContentSha256: reservedOwner.lastContentSha256,
			lastContentShape: reservedOwner.lastContentShape,
			lastFilterVersion: reservedOwner.lastFilterVersion,
			lastSessionDate: reservedOwner.lastSessionDate,
			lastUsageContentSha256: reservedOwner.lastUsageContentSha256,
			lastUsageChecksum: reservedOwner.lastUsageChecksum,
			lastUsageExtractionVersion: reservedOwner.lastUsageExtractionVersion,
			lastUsageEventIdentityVersion:
				reservedOwner.lastUsageEventIdentityVersion,
			lastUsageModelRateCardVersion:
				reservedOwner.lastUsageModelRateCardVersion,
		};
	}

	logger.warn(
		"Session ingest rejected for a non-owner (organization_id={organizationId} session_id={sessionId} user_id={userId})",
		{ organizationId, sessionId, userId },
	);
	return { owned: false, ownerId: reservedOwner.userId };
}

function parseContentShape(value: string | null): IngestContentShape | null {
	if (value === null) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!isRecord(parsed) || parsed.version !== 1) return null;
		if (!isContentComponent(parsed.main) || !isRecord(parsed.subagents)) {
			return null;
		}
		for (const component of Object.values(parsed.subagents)) {
			if (!isContentComponent(component)) return null;
		}
		if (!isContentComponent(parsed)) return null;
		return parsed as unknown as IngestContentShape;
	} catch {
		return null;
	}
}

function isContentComponent(value: unknown): boolean {
	return (
		isRecord(value) &&
		Number.isSafeInteger(value.assistantLineCount) &&
		Number(value.assistantLineCount) >= 0 &&
		Number.isSafeInteger(value.contentBytes) &&
		Number(value.contentBytes) >= 0
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
