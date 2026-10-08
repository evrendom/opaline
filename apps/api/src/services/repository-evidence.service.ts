import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	REPOSITORY_EVIDENCE_PART_SIZE_BYTES,
	REPOSITORY_EVIDENCE_PROTOCOL,
	type RepositoryEvidenceCommitInput,
	type RepositoryEvidenceCommitOutput,
	type RepositoryEvidenceInitInput,
	RepositoryEvidenceInitInputSchema,
	type RepositoryEvidenceInitOutput,
	type RepositoryEvidenceObjectDescriptor,
	type RepositoryEvidenceUploadObject,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { assertNoClickHousePurgeTombstone } from "./clickhouse-purge-tombstone.service.js";
import { L1_EDGE_SESSION_DEBOUNCE_MS } from "./l1-edges/l1-edge-enqueue.js";
import { enqueueL1EdgeScope } from "./l1-edges/l1-edge-queue.service.js";
import { toPostgresJson } from "./postgres-json.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";
import {
	EVIDENCE_R2_CREATION_TIMEOUT_MS,
	evidenceSqlBatches,
	mapEvidenceStorage,
} from "./repository-evidence-batching.js";
import {
	abortUploadIntents,
	attachMultipartUploadIds,
	EVIDENCE_INTENT_GRACE_MS,
	EVIDENCE_UPLOAD_TTL_MS,
	type EvidenceIntentScope,
	expediteReceiptIntents,
	expediteUploadIntents,
	registerMultipartIntents,
} from "./repository-evidence-fence.service.js";
import type { RepositoryEvidenceIndexRow } from "./repository-evidence-index.service.js";
import { claimSessionIngestOwnership } from "./session-ownership.service.js";

const SHA256_PREFIX = "sha256:";

interface StoredEvidenceUploadPlan {
	readonly input: RepositoryEvidenceInitInput;
	readonly uploads: readonly RepositoryEvidenceUploadObject[];
}

interface EvidenceUploadRow {
	readonly committedAt: Date | string | null;
	readonly contextId: string;
	readonly expiresAt: Date | string;
	readonly id: string;
	readonly manifestObjectId: string;
	readonly missingObjectIds: unknown;
	readonly receiptId: string | null;
	readonly request: unknown;
	readonly status: "initialized" | "committed" | "failed" | "expired";
}

interface EvidenceObjectRow {
	readonly byteLength: number;
	readonly objectId: string;
	readonly objectKey: string;
	readonly status: "pending" | "available";
}

export class RepositoryEvidenceStateError extends Error {
	constructor(
		readonly code:
			| "EVIDENCE_EXPIRED"
			| "EVIDENCE_NOT_FOUND"
			| "EVIDENCE_OBJECT_MISMATCH"
			| "EVIDENCE_ORGANIZATION_MISMATCH"
			| "EVIDENCE_SESSION_CONFLICT"
			| "EVIDENCE_UPLOAD_CONFLICT",
		message: string,
	) {
		super(message);
		this.name = "RepositoryEvidenceStateError";
	}
}

export interface InitRepositoryEvidenceOptions {
	readonly database: postgres.Sql;
	readonly input: RepositoryEvidenceInitInput;
	readonly now: () => Date;
	readonly organizationId: string;
	readonly r2: R2MultipartUploadClient;
	readonly randomUUID: () => string;
	readonly userId: string;
}

export async function initRepositoryEvidence(
	options: InitRepositoryEvidenceOptions,
): Promise<RepositoryEvidenceInitOutput> {
	assertOrganization(options.input.organizationId, options.organizationId);
	const existing = await findUploadByOperation(
		options.input.operationId,
		options.organizationId,
		options.userId,
		options.database,
	);
	if (existing) {
		return resumeRepositoryEvidenceUpload(existing.id, options);
	}
	await authorizeEvidenceWrite({
		database: options.database,
		organizationId: options.organizationId,
		sessionId: options.input.session.sessionId,
		userId: options.userId,
	});

	const knownObjects = await findKnownObjects(
		options.organizationId,
		options.input.objects.map((object) => object.objectId),
		options.database,
	);
	for (const object of options.input.objects) {
		const known = knownObjects.get(object.objectId);
		if (known && known.byteLength !== object.byteLength) {
			throw new RepositoryEvidenceStateError(
				"EVIDENCE_OBJECT_MISMATCH",
				`Evidence object ${object.objectId} conflicts with its recorded byte length.`,
			);
		}
	}
	const uploadReceiptId = options.randomUUID();
	const initializedAt = options.now();
	const expiresAt = new Date(initializedAt.getTime() + EVIDENCE_UPLOAD_TTL_MS);
	const scope: EvidenceIntentScope = {
		organizationId: options.organizationId,
		uploadReceiptId,
		userId: options.userId,
	};
	const createdUploads: Array<{
		readonly objectKey: string;
		readonly uploadId: string;
	}> = [];

	try {
		// Register (or refresh) a pending row for every object that is not yet
		// available. Its generation-versioned key is what the multipart upload
		// targets, so a later purge of a deleted generation cannot touch content
		// that another member uploads under a new row.
		const pendingKeys = await ensurePendingObjects({
			database: options.database,
			now: initializedAt,
			objects: options.input.objects.filter(
				(object) => knownObjects.get(object.objectId)?.status !== "available",
			),
			organizationId: options.organizationId,
		});
		const missing = options.input.objects.filter((object) =>
			pendingKeys.has(object.objectId),
		);
		const reusedObjectIds = options.input.objects
			.filter((object) => !pendingKeys.has(object.objectId))
			.map((object) => object.objectId);
		const uploads = await createUploadPlans({
			createdUploads,
			database: options.database,
			intentDueAt: new Date(expiresAt.getTime() + EVIDENCE_INTENT_GRACE_MS),
			missing,
			objectKeys: pendingKeys,
			r2: options.r2,
			scope,
		});
		const stored: StoredEvidenceUploadPlan = {
			input: options.input,
			uploads,
		};
		await options.database.begin(async (transaction) => {
			await assertNoClickHousePurgeTombstone(scope, { database: transaction });
			await assertReusedObjectsAvailable(
				transaction,
				options.organizationId,
				reusedObjectIds,
			);
			await transaction.unsafe(
				`INSERT INTO repository_evidence_upload (
					id, operation_id, organization_id, user_id, context_id,
					manifest_object_id, request, missing_object_ids, expires_at,
					created_at, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8::text::jsonb, $9, $10, $10)`,
				[
					uploadReceiptId,
					options.input.operationId,
					options.organizationId,
					options.userId,
					options.input.capture.contextId,
					options.input.manifestObjectId,
					JSON.stringify(toPostgresJson(stored)),
					JSON.stringify(missing.map((object) => object.objectId)),
					expiresAt.toISOString(),
					initializedAt.toISOString(),
				],
			);
			await linkUploadObjects(
				transaction,
				uploadReceiptId,
				options.organizationId,
				options.input.objects.map((object) => object.objectId),
			);
		});

		return {
			expiresAt: expiresAt.toISOString(),
			missingObjects: uploads,
			partSizeBytes: REPOSITORY_EVIDENCE_PART_SIZE_BYTES,
			protocol: REPOSITORY_EVIDENCE_PROTOCOL,
			reusedObjectIds,
			uploadReceiptId,
		};
	} catch (error) {
		await abortUploadIntents({
			database: options.database,
			r2: options.r2,
			uploadIds: createdUploads.map((upload) => upload.uploadId),
			uploadReceiptId,
		});
		const raced = await findUploadByOperation(
			options.input.operationId,
			options.organizationId,
			options.userId,
			options.database,
		);
		if (raced) return resumeRepositoryEvidenceUpload(raced.id, options);
		throw error;
	}
}

export interface CommitRepositoryEvidenceOptions {
	readonly database: postgres.Sql;
	readonly input: RepositoryEvidenceCommitInput;
	readonly now: () => Date;
	readonly organizationId: string;
	readonly prepareIndex: (
		evidence: RepositoryEvidenceForIndex,
	) => RepositoryEvidenceIndexRow;
	readonly r2: R2MultipartUploadClient;
	readonly randomUUID: () => string;
	readonly signal?: AbortSignal;
	readonly userId: string;
}

export interface CommitRepositoryEvidenceResult {
	readonly evidence: RepositoryEvidenceForIndex;
	readonly output: RepositoryEvidenceCommitOutput;
	readonly preparedIndex: RepositoryEvidenceIndexRow;
}

export interface RepositoryEvidenceForIndex {
	readonly input: RepositoryEvidenceInitInput;
	readonly manifest: unknown;
}

async function readVerifiedEvidenceFromPlan(input: {
	readonly database: postgres.Sql;
	readonly manifestBytes: Uint8Array | undefined;
	readonly organizationId: string;
	readonly plan: StoredEvidenceUploadPlan;
	readonly r2: R2MultipartUploadClient;
	readonly signal: AbortSignal | undefined;
}): Promise<RepositoryEvidenceForIndex> {
	const plan = input.plan;
	const descriptor = plan.input.objects.find(
		(object) => object.objectId === plan.input.manifestObjectId,
	);
	if (!descriptor) {
		throw new Error("Repository evidence manifest descriptor is missing");
	}
	let bytes = input.manifestBytes;
	if (bytes === undefined) {
		const known = await findKnownObjects(
			input.organizationId,
			[descriptor.objectId],
			input.database,
		);
		const row = known.get(descriptor.objectId);
		if (!row) {
			throw new RepositoryEvidenceStateError(
				"EVIDENCE_OBJECT_MISMATCH",
				`Evidence object ${descriptor.objectId} is not registered.`,
			);
		}
		bytes = await readVerifiedEvidenceObject({
			descriptor,
			objectKey: row.objectKey,
			r2: input.r2,
			signal: input.signal,
		});
	}
	let manifest: unknown;
	try {
		manifest = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_OBJECT_MISMATCH",
			"Stored repository evidence manifest is not valid JSON.",
		);
	}
	return {
		input: plan.input,
		manifest,
	};
}

function prepareRepositoryEvidenceIndex(
	evidence: RepositoryEvidenceForIndex,
	prepareIndex: CommitRepositoryEvidenceOptions["prepareIndex"],
): RepositoryEvidenceIndexRow {
	try {
		return prepareIndex(evidence);
	} catch {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_OBJECT_MISMATCH",
			"Stored repository evidence manifest is invalid.",
		);
	}
}

export async function commitRepositoryEvidence(
	options: CommitRepositoryEvidenceOptions,
): Promise<CommitRepositoryEvidenceResult> {
	assertOrganization(options.input.organizationId, options.organizationId);
	const upload = await findUploadById(
		options.input.uploadReceiptId,
		options.organizationId,
		options.userId,
		options.database,
	);
	if (!upload) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_NOT_FOUND",
			"Repository evidence upload was not found.",
		);
	}
	const plan = parseStoredPlan(upload.request);
	if (upload.status === "committed") {
		if (!upload.receiptId || !upload.committedAt) {
			throw new Error("Committed repository evidence is missing its receipt");
		}
		const evidence = await readVerifiedEvidenceFromPlan({
			database: options.database,
			manifestBytes: undefined,
			organizationId: options.organizationId,
			plan,
			r2: options.r2,
			signal: options.signal,
		});
		return {
			evidence,
			output: buildCommitOutput(upload, plan, "duplicate"),
			preparedIndex: prepareRepositoryEvidenceIndex(
				evidence,
				options.prepareIndex,
			),
		};
	}
	if (upload.status !== "initialized") {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_UPLOAD_CONFLICT",
			`Repository evidence upload is ${upload.status}.`,
		);
	}
	if (toDate(upload.expiresAt).getTime() <= options.now().getTime()) {
		await markUploadExpired(upload.id, options.now(), options.database);
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_EXPIRED",
			"Repository evidence upload expired before commit.",
		);
	}
	assertCompletionMatches(plan.uploads, options.input.objects);
	// Materialization publishes objects to R2, so it is fenced like any write:
	// deletion tombstones and the session association are checked first and
	// again inside the commit transaction below.
	await authorizeEvidenceWrite({
		database: options.database,
		organizationId: options.organizationId,
		sessionId: plan.input.session.sessionId,
		userId: options.userId,
	});

	const knownObjects = await findKnownObjects(
		options.organizationId,
		plan.input.objects.map((object) => object.objectId),
		options.database,
	);
	const uploadPlans = new Map(
		plan.uploads.map((object) => [object.objectId, object]),
	);
	const completions = new Map(
		options.input.objects.map((object) => [object.objectId, object]),
	);
	const completedUploadIds: string[] = [];
	const verified = await mapEvidenceStorage(
		plan.input.objects,
		async (descriptor) => {
			const uploadPlan = uploadPlans.get(descriptor.objectId);
			let bytes: Uint8Array;
			if (uploadPlan) {
				const completion = completions.get(descriptor.objectId);
				if (!completion) {
					throw new RepositoryEvidenceStateError(
						"EVIDENCE_OBJECT_MISMATCH",
						`Missing completion for ${descriptor.objectId}.`,
					);
				}
				const materialized = await materializeEvidenceObject({
					completion,
					descriptor,
					r2: options.r2,
					signal: options.signal,
					upload: uploadPlan,
				});
				bytes = materialized.bytes;
				if (materialized.multipartCompleted)
					completedUploadIds.push(uploadPlan.uploadId);
			} else {
				const known = knownObjects.get(descriptor.objectId);
				if (known?.status === "available") return null;
				if (!known) {
					throw new RepositoryEvidenceStateError(
						"EVIDENCE_OBJECT_MISMATCH",
						`Evidence object ${descriptor.objectId} is not registered.`,
					);
				}
				bytes = await readVerifiedEvidenceObject({
					descriptor,
					objectKey: known.objectKey,
					r2: options.r2,
					signal: options.signal,
				});
			}
			return descriptor.objectId === plan.input.manifestObjectId ? bytes : null;
		},
	);
	const manifestBytes = verified.find((bytes) => bytes !== null) ?? undefined;
	const evidence = await readVerifiedEvidenceFromPlan({
		database: options.database,
		manifestBytes,
		organizationId: options.organizationId,
		plan,
		r2: options.r2,
		signal: options.signal,
	});
	const preparedIndex = prepareRepositoryEvidenceIndex(
		evidence,
		options.prepareIndex,
	);

	const committedAt = options.now();
	const receiptId = options.randomUUID();
	const scope: EvidenceIntentScope = {
		organizationId: options.organizationId,
		uploadReceiptId: upload.id,
		userId: options.userId,
	};
	const status = await options.database.begin(async (transaction) => {
		const [current] = await transaction.unsafe<EvidenceUploadRow[]>(
			`${selectUploadSql()} WHERE id = $1 AND organization_id = $2 AND user_id = $3 FOR UPDATE`,
			[upload.id, options.organizationId, options.userId],
		);
		if (!current) {
			throw new RepositoryEvidenceStateError(
				"EVIDENCE_NOT_FOUND",
				"Repository evidence upload disappeared before commit.",
			);
		}
		if (current.status === "committed") {
			if (!current.receiptId) {
				throw new Error("Committed repository evidence is missing its receipt");
			}
			return "duplicate" as const;
		}
		if (current.status !== "initialized") {
			throw new RepositoryEvidenceStateError(
				"EVIDENCE_UPLOAD_CONFLICT",
				`Repository evidence upload is ${current.status}.`,
			);
		}
		if (!isDeepStrictEqual(parseStoredPlan(current.request), plan)) {
			throw new RepositoryEvidenceStateError(
				"EVIDENCE_UPLOAD_CONFLICT",
				"Repository evidence upload was resumed; retry its current upload plan.",
			);
		}
		await assertNoClickHousePurgeTombstone(scope, { database: transaction });
		await assertSessionOwnedInTransaction(transaction, {
			organizationId: options.organizationId,
			sessionId: plan.input.session.sessionId,
			userId: options.userId,
		});
		const objectIds = [
			...new Set(plan.input.objects.map((object) => object.objectId)),
		];
		const lockedObjects = await lockKnownObjects(
			options.organizationId,
			objectIds,
			transaction,
		);
		for (const objectId of objectIds) {
			const verifiedKey =
				uploadPlans.get(objectId)?.objectKey ??
				knownObjects.get(objectId)?.objectKey;
			if (
				!verifiedKey ||
				lockedObjects.get(objectId)?.objectKey !== verifiedKey
			) {
				throw new RepositoryEvidenceStateError(
					"EVIDENCE_UPLOAD_CONFLICT",
					"Repository evidence object generations changed before commit; retry the upload.",
				);
			}
		}
		const available = await transaction.unsafe<Array<{ objectId: string }>>(
			`UPDATE repository_evidence_object
			 SET status = 'available', available_at = COALESCE(available_at, $1), updated_at = $1
			 WHERE organization_id = $2 AND object_id = ANY($3::text[])
			 RETURNING object_id AS "objectId"`,
			[committedAt.toISOString(), options.organizationId, objectIds],
		);
		if (available.length !== objectIds.length) {
			throw new RepositoryEvidenceStateError(
				"EVIDENCE_UPLOAD_CONFLICT",
				"Repository evidence objects were removed before commit; retry the upload.",
			);
		}
		const provider = plan.input.repository.provider;
		await transaction.unsafe(
			`INSERT INTO repository_evidence_capture (
				organization_id, context_id, user_id, upload_id, manifest_object_id,
				installation_id, local_repository_id, local_worktree_id,
				provider, provider_host, provider_repository_id,
				provider_repository_node_id, provider_owner, provider_name,
				session_id, run_id, segment_id, agent_id, parent_agent_id, source,
				lifecycle, base_git_commit, head_git_commit, captured_at, coverage, index_row
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8,
				$9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
				$21, $22, $23, $24, $25::text::jsonb, $26::text::jsonb
			) ON CONFLICT (organization_id, context_id) DO NOTHING`,
			[
				options.organizationId,
				plan.input.capture.contextId,
				options.userId,
				upload.id,
				plan.input.manifestObjectId,
				plan.input.repository.local.installationId,
				plan.input.repository.local.repositoryId,
				plan.input.repository.local.worktreeId,
				provider?.provider ?? null,
				provider?.host ?? null,
				provider?.repositoryId ?? null,
				provider?.nodeId ?? null,
				provider?.owner ?? null,
				provider?.name ?? null,
				plan.input.session.sessionId,
				plan.input.session.runId,
				plan.input.session.segmentId,
				plan.input.session.agentId,
				plan.input.session.parentAgentId,
				plan.input.session.source,
				plan.input.capture.timing.lifecycle,
				plan.input.capture.baseGitCommit,
				plan.input.capture.headGitCommit,
				plan.input.capture.timing.captureCompletedAt,
				JSON.stringify(plan.input.coverage),
				JSON.stringify(preparedIndex),
			],
		);
		// A capture is evidence of its session's L1 edges.
		await enqueueL1EdgeScope(
			transaction,
			{
				kind: "session",
				organizationId: options.organizationId,
				userId: options.userId,
				source: plan.input.session.source,
				sessionId: plan.input.session.sessionId,
			},
			{ debounceMs: L1_EDGE_SESSION_DEBOUNCE_MS },
		);
		await transaction.unsafe(
			`UPDATE repository_evidence_upload
			 SET status = 'committed', receipt_id = $1, committed_at = $2, updated_at = $2
			 WHERE id = $3`,
			[receiptId, committedAt.toISOString(), upload.id],
		);
		// Some multipart uploads may not have been completed by this commit (an
		// identical object that another upload materialized was reused instead),
		// so their intents are only made due here and released after the abort.
		await expediteReceiptIntents(transaction, upload.id, committedAt);
		return "accepted" as const;
	});
	await abortUploadIntents({
		completedUploadIds,
		database: options.database,
		r2: options.r2,
		uploadReceiptId: upload.id,
	});
	if (status === "duplicate") {
		const latest = await findUploadById(
			upload.id,
			options.organizationId,
			options.userId,
			options.database,
		);
		if (!latest) throw new Error("Committed repository evidence disappeared");
		return {
			evidence,
			output: buildCommitOutput(latest, plan, "duplicate"),
			preparedIndex,
		};
	}
	return {
		evidence,
		output: {
			acceptedAt: committedAt.toISOString(),
			contextId: plan.input.capture.contextId,
			manifestObjectId: plan.input.manifestObjectId,
			protocol: REPOSITORY_EVIDENCE_PROTOCOL,
			receiptId,
			status,
			storedObjectIds: plan.input.objects.map((object) => object.objectId),
			uploadReceiptId: upload.id,
		},
		preparedIndex,
	};
}

/**
 * Deletion and ownership gate shared by every evidence writer: no write may
 * proceed for a target with a deletion tombstone, and evidence may only attach
 * to a session the caller owns (the same rule raw transcript ingest applies).
 * Reserving the ownership row here also covers start captures that arrive
 * before the raw transcript upload.
 */
async function authorizeEvidenceWrite(input: {
	readonly database: postgres.Sql;
	readonly organizationId: string;
	readonly sessionId: string;
	readonly userId: string;
}): Promise<void> {
	await assertNoClickHousePurgeTombstone(
		{ organizationId: input.organizationId, userId: input.userId },
		{ database: input.database },
	);
	const claim = await claimSessionIngestOwnership(
		input.organizationId,
		input.sessionId,
		input.userId,
		input.database,
	);
	if (!claim.owned) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_SESSION_CONFLICT",
			"The session belongs to another member of this workspace.",
		);
	}
}

async function assertSessionOwnedInTransaction(
	transaction: postgres.TransactionSql,
	input: {
		readonly organizationId: string;
		readonly sessionId: string;
		readonly userId: string;
	},
): Promise<void> {
	const [owner] = await transaction.unsafe<Array<{ userId: string }>>(
		`SELECT user_id AS "userId"
		 FROM session_ownership
		 WHERE organization_id = $1 AND session_id = $2
		 FOR SHARE`,
		[input.organizationId, input.sessionId],
	);
	if (owner?.userId !== input.userId) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_SESSION_CONFLICT",
			"The session association changed before the evidence was committed.",
		);
	}
}

async function ensurePendingObjects(input: {
	readonly database: postgres.Sql;
	readonly now: Date;
	readonly objects: readonly RepositoryEvidenceObjectDescriptor[];
	readonly organizationId: string;
}): Promise<ReadonlyMap<string, string>> {
	if (input.objects.length === 0) return new Map();
	const rows = await input.database.begin((transaction) =>
		insertPendingObjects(transaction, input, input.objects),
	);
	const keys = new Map<string, string>();
	for (const [objectId, row] of rows) {
		if (row.status === "pending") keys.set(objectId, row.objectKey);
	}
	return keys;
}

async function insertPendingObjects(
	database: postgres.Sql | postgres.TransactionSql,
	context: { readonly now: Date; readonly organizationId: string },
	objects: readonly RepositoryEvidenceObjectDescriptor[],
): Promise<ReadonlyMap<string, EvidenceObjectRow>> {
	// Refreshing updated_at keeps a reused pending row away from the stale
	// object sweeper while this upload is being planned.
	const result = new Map<string, EvidenceObjectRow>();
	const sorted = [...objects].sort((left, right) =>
		left.objectId.localeCompare(right.objectId),
	);
	for (const batch of evidenceSqlBatches(sorted)) {
		const rows = await database.unsafe<EvidenceObjectRow[]>(
			`INSERT INTO repository_evidence_object (
				organization_id, object_id, object_key, kind, byte_length,
				media_type, content_encoding, filter_version, status, updated_at
			)
			SELECT $2, item."objectId", item."objectKey", item.kind, item."byteLength",
				item."mediaType", item."contentEncoding", item."filterVersion", 'pending', $3::timestamptz
			FROM jsonb_to_recordset($1::text::jsonb) AS item(
				"objectId" text, "objectKey" text, kind text, "byteLength" integer,
				"mediaType" text, "contentEncoding" text, "filterVersion" integer
			)
			ORDER BY item."objectId"
			ON CONFLICT (organization_id, object_id) DO UPDATE
			SET updated_at = GREATEST(repository_evidence_object.updated_at, EXCLUDED.updated_at)
			RETURNING object_id AS "objectId", object_key AS "objectKey", byte_length AS "byteLength", status`,
			[
				JSON.stringify(
					batch.map((object) => ({
						...object,
						objectKey: createEvidenceObjectKey(
							context.organizationId,
							object.objectId,
						),
					})),
				),
				context.organizationId,
				context.now.toISOString(),
			],
		);
		for (const row of rows) result.set(row.objectId, row);
		for (const object of batch) {
			if (result.get(object.objectId)?.byteLength !== object.byteLength) {
				throw new RepositoryEvidenceStateError(
					"EVIDENCE_OBJECT_MISMATCH",
					`Evidence object ${object.objectId} conflicts with its recorded byte length.`,
				);
			}
		}
	}
	return result;
}

async function linkUploadObjects(
	transaction: postgres.TransactionSql,
	uploadReceiptId: string,
	organizationId: string,
	objectIds: readonly string[],
): Promise<void> {
	for (const batch of evidenceSqlBatches(objectIds)) {
		await transaction.unsafe(
			`INSERT INTO repository_evidence_upload_object (upload_id, organization_id, object_id)
			 SELECT $1, $2, unnest($3::text[])
			 ON CONFLICT (upload_id, object_id) DO NOTHING`,
			[uploadReceiptId, organizationId, batch],
		);
	}
}

async function assertReusedObjectsAvailable(
	transaction: postgres.TransactionSql,
	organizationId: string,
	objectIds: readonly string[],
): Promise<void> {
	if (objectIds.length === 0) return;
	// FOR SHARE serializes against account deletion, whose snapshot takes the
	// same rows FOR UPDATE: either this upload's reference is visible to the
	// snapshot (the object survives) or the row is gone and the caller retries.
	const rows = await transaction.unsafe<Array<{ objectId: string }>>(
		`SELECT object_id AS "objectId"
		 FROM repository_evidence_object
		 WHERE organization_id = $1
			AND object_id = ANY($2::text[])
			AND status = 'available'
		 FOR SHARE`,
		[organizationId, objectIds],
	);
	if (rows.length !== objectIds.length) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_UPLOAD_CONFLICT",
			"A reused evidence object was removed; retry the upload.",
		);
	}
}

async function createUploadPlans(input: {
	readonly createdUploads: Array<{
		readonly objectKey: string;
		readonly uploadId: string;
	}>;
	readonly database: postgres.Sql;
	readonly intentDueAt: Date;
	readonly missing: readonly RepositoryEvidenceObjectDescriptor[];
	readonly objectKeys: ReadonlyMap<string, string>;
	readonly r2: R2MultipartUploadClient;
	readonly scope: EvidenceIntentScope;
}): Promise<RepositoryEvidenceUploadObject[]> {
	if (input.missing.length === 0) return [];
	const intents = input.missing.map((object) => {
		const objectKey = input.objectKeys.get(object.objectId);
		if (!objectKey)
			throw new Error("Repository evidence object has no registered key");
		return { id: crypto.randomUUID(), object, objectKey };
	});
	const creationSignal = AbortSignal.timeout(EVIDENCE_R2_CREATION_TIMEOUT_MS);
	await input.database.begin(async (transaction) => {
		await assertNoClickHousePurgeTombstone(input.scope, {
			database: transaction,
		});
		await registerMultipartIntents(
			transaction,
			input.scope,
			intents.map(({ id, objectKey }) => ({ id, objectKey })),
			input.intentDueAt,
		);
	});
	const attached: Array<{ id: string; uploadId: string }> = [];
	try {
		return await mapEvidenceStorage(
			intents,
			async ({ id, object, objectKey }) => {
				creationSignal.throwIfAborted();
				const created = await input.r2.createMultipartUpload({
					contentType: object.mediaType,
					metadata: {
						"content-sha256": object.sha256,
						"evidence-protocol": REPOSITORY_EVIDENCE_PROTOCOL,
						"expected-bytes": object.byteLength.toString(),
						"upload-receipt-id": input.scope.uploadReceiptId,
					},
					objectKey,
					signal: creationSignal,
				});
				input.createdUploads.push({ objectKey, uploadId: created.uploadId });
				attached.push({ id, uploadId: created.uploadId });
				const byteLengths = getPartByteLengths(object.byteLength);
				const urls = await Promise.all(
					byteLengths.map((byteLength, index) =>
						input.r2.presignUploadPart({
							byteLength,
							objectKey,
							partNumber: index + 1,
							uploadId: created.uploadId,
						}),
					),
				);
				return {
					byteLength: object.byteLength,
					objectId: object.objectId,
					objectKey,
					parts: byteLengths.map((byteLength, index) => ({
						byteLength,
						headers: { "Content-Length": byteLength.toString() },
						partNumber: index + 1,
						uploadUrl: urls[index] ?? "",
					})),
					uploadId: created.uploadId,
				};
			},
		);
	} finally {
		await attachMultipartUploadIds(input.database, input.scope, attached);
	}
}

async function resumeRepositoryEvidenceUpload(
	uploadId: string,
	options: InitRepositoryEvidenceOptions,
): Promise<RepositoryEvidenceInitOutput> {
	const createdUploads: Array<{ objectKey: string; uploadId: string }> = [];
	const supersededUploadIds: string[] = [];
	let output: RepositoryEvidenceInitOutput;
	try {
		output = await options.database.begin(async (transaction) => {
			const [upload] = await transaction.unsafe<EvidenceUploadRow[]>(
				`${selectUploadSql()} WHERE id = $1 AND organization_id = $2 AND user_id = $3 FOR UPDATE`,
				[uploadId, options.organizationId, options.userId],
			);
			if (!upload) {
				throw new RepositoryEvidenceStateError(
					"EVIDENCE_NOT_FOUND",
					"Repository evidence upload was not found.",
				);
			}
			const plan = parseStoredPlan(upload.request);
			if (!isDeepStrictEqual(plan.input, options.input)) {
				throw new RepositoryEvidenceStateError(
					"EVIDENCE_UPLOAD_CONFLICT",
					"Evidence operation ID was reused with different capture data.",
				);
			}
			if (upload.status === "committed") {
				buildCommitOutput(upload, plan, "duplicate");
				return {
					expiresAt: toDate(upload.expiresAt).toISOString(),
					missingObjects: [],
					partSizeBytes: REPOSITORY_EVIDENCE_PART_SIZE_BYTES,
					protocol: REPOSITORY_EVIDENCE_PROTOCOL,
					reusedObjectIds: plan.input.objects.map((object) => object.objectId),
					uploadReceiptId: upload.id,
				};
			}
			await authorizeEvidenceWrite({
				database: options.database,
				organizationId: options.organizationId,
				sessionId: plan.input.session.sessionId,
				userId: options.userId,
			});
			const now = options.now();
			const scope: EvidenceIntentScope = {
				organizationId: options.organizationId,
				uploadReceiptId: upload.id,
				userId: options.userId,
			};
			const rows = new Map(
				await lockKnownObjects(
					options.organizationId,
					plan.input.objects.map((object) => object.objectId),
					transaction,
				),
			);
			const inserted = await insertPendingObjects(
				transaction,
				{ now, organizationId: options.organizationId },
				plan.input.objects.filter((object) => !rows.has(object.objectId)),
			);
			for (const [objectId, row] of inserted) rows.set(objectId, row);
			await linkUploadObjects(transaction, upload.id, options.organizationId, [
				...inserted.keys(),
			]);
			await transaction.unsafe(
				`UPDATE repository_evidence_object
				 SET updated_at = GREATEST(updated_at, $3)
				 WHERE organization_id = $1
					AND object_id = ANY($2::text[])
					AND status = 'pending'`,
				[
					options.organizationId,
					plan.input.objects.map((object) => object.objectId),
					now.toISOString(),
				],
			);
			let renew =
				upload.status !== "initialized" || toDate(upload.expiresAt) <= now;
			const incomplete: RepositoryEvidenceUploadObject[] = [];
			const unplanned: RepositoryEvidenceObjectDescriptor[] = [];
			const objectKeys = new Map<string, string>();
			const uploadPlans = new Map(
				plan.uploads.map((object) => [object.objectId, object]),
			);
			const checked = await mapEvidenceStorage(
				plan.input.objects,
				async (descriptor) => {
					const row = rows.get(descriptor.objectId);
					if (row?.status === "available") return null;
					if (!row)
						throw new Error("Repository evidence object was not registered");
					const objectKey = row.objectKey;
					objectKeys.set(descriptor.objectId, objectKey);
					const object = uploadPlans.get(descriptor.objectId);
					if (!object || object.objectKey !== objectKey) {
						return { descriptor, object: null, renew: false };
					}
					const materialized = await options.r2.headObject(object.objectKey);
					if (materialized === null) {
						return {
							descriptor,
							object,
							renew: !(await options.r2.hasMultipartUpload(object)),
						};
					}
					if (!isExpectedObject(materialized, descriptor)) {
						return { descriptor, object, renew: true };
					}
					try {
						await readVerifiedEvidenceObject({
							descriptor,
							objectKey: object.objectKey,
							r2: options.r2,
							signal: undefined,
						});
					} catch (error) {
						if (
							!(error instanceof RepositoryEvidenceStateError) ||
							error.code !== "EVIDENCE_OBJECT_MISMATCH"
						) {
							throw error;
						}
						return { descriptor, object, renew: true };
					}
					return null;
				},
			);
			for (const result of checked) {
				if (!result) continue;
				renew ||= result.renew;
				if (result.object) incomplete.push(result.object);
				else unplanned.push(result.descriptor);
			}
			const expiresAt = renew
				? new Date(now.getTime() + EVIDENCE_UPLOAD_TTL_MS)
				: toDate(upload.expiresAt);
			const descriptors = new Map(
				plan.input.objects.map((object) => [object.objectId, object]),
			);
			const describe = (object: RepositoryEvidenceUploadObject) => {
				const descriptor = descriptors.get(object.objectId);
				if (!descriptor) {
					throw new Error("Stored evidence upload has no descriptor.");
				}
				return descriptor;
			};
			const created = await createUploadPlans({
				createdUploads,
				database: options.database,
				intentDueAt: new Date(expiresAt.getTime() + EVIDENCE_INTENT_GRACE_MS),
				missing: renew
					? [...incomplete.map(describe), ...unplanned]
					: unplanned,
				objectKeys,
				r2: options.r2,
				scope,
			});
			const uploads = renew ? created : [...incomplete, ...created];
			const resumedPlan: StoredEvidenceUploadPlan = {
				input: plan.input,
				uploads,
			};
			if (renew || !isDeepStrictEqual(uploads, plan.uploads)) {
				await transaction.unsafe(
					`UPDATE repository_evidence_upload SET status = 'initialized', request = $1::text::jsonb,
					 missing_object_ids = $2::text::jsonb, expires_at = $3, updated_at = $4 WHERE id = $5`,
					[
						JSON.stringify(toPostgresJson(resumedPlan)),
						JSON.stringify(uploads.map((object) => object.objectId)),
						expiresAt.toISOString(),
						now.toISOString(),
						upload.id,
					],
				);
			}
			const keptUploadIds = new Set(uploads.map((kept) => kept.uploadId));
			supersededUploadIds.push(
				...plan.uploads
					.map((superseded) => superseded.uploadId)
					.filter((uploadId) => !keptUploadIds.has(uploadId)),
			);
			if (supersededUploadIds.length > 0) {
				await expediteUploadIntents(
					transaction,
					upload.id,
					supersededUploadIds,
					now,
				);
			}
			return restoreInitOutput(
				{ ...upload, expiresAt, request: resumedPlan, status: "initialized" },
				options.r2,
				now,
			);
		});
	} catch (error) {
		await abortUploadIntents({
			database: options.database,
			r2: options.r2,
			uploadIds: createdUploads.map((created) => created.uploadId),
			uploadReceiptId: uploadId,
		});
		throw error;
	}
	await abortUploadIntents({
		database: options.database,
		r2: options.r2,
		uploadIds: supersededUploadIds,
		uploadReceiptId: uploadId,
	});
	return output;
}

async function restoreInitOutput(
	upload: EvidenceUploadRow,
	r2: R2MultipartUploadClient,
	now: Date,
): Promise<RepositoryEvidenceInitOutput> {
	if (upload.status !== "initialized" || toDate(upload.expiresAt) <= now) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_UPLOAD_CONFLICT",
			`Evidence operation already exists in ${upload.status} state.`,
		);
	}
	const plan = parseStoredPlan(upload.request);
	const missingObjects = await mapEvidenceStorage(
		plan.uploads,
		async (object) => ({
			...object,
			parts: await Promise.all(
				object.parts.map(async (part) => ({
					...part,
					uploadUrl: await r2.presignUploadPart({
						byteLength: part.byteLength,
						objectKey: object.objectKey,
						partNumber: part.partNumber,
						uploadId: object.uploadId,
					}),
				})),
			),
		}),
	);
	const missing = new Set(missingObjects.map((object) => object.objectId));
	return {
		expiresAt: toDate(upload.expiresAt).toISOString(),
		missingObjects,
		partSizeBytes: REPOSITORY_EVIDENCE_PART_SIZE_BYTES,
		protocol: REPOSITORY_EVIDENCE_PROTOCOL,
		reusedObjectIds: plan.input.objects
			.filter((object) => !missing.has(object.objectId))
			.map((object) => object.objectId),
		uploadReceiptId: upload.id,
	};
}

async function materializeEvidenceObject(input: {
	readonly completion: RepositoryEvidenceCommitInput["objects"][number];
	readonly descriptor: RepositoryEvidenceObjectDescriptor;
	readonly r2: R2MultipartUploadClient;
	readonly signal: AbortSignal | undefined;
	readonly upload: RepositoryEvidenceUploadObject;
}): Promise<{ bytes: Uint8Array; multipartCompleted: boolean }> {
	const existing = await input.r2.headObject(
		input.upload.objectKey,
		input.signal,
	);
	if (isExpectedObject(existing, input.descriptor)) {
		try {
			return {
				bytes: await readVerifiedEvidenceObject({
					descriptor: input.descriptor,
					objectKey: input.upload.objectKey,
					r2: input.r2,
					signal: input.signal,
				}),
				multipartCompleted: false,
			};
		} catch (error) {
			if (
				!(error instanceof RepositoryEvidenceStateError) ||
				error.code !== "EVIDENCE_OBJECT_MISMATCH"
			) {
				throw error;
			}
			try {
				await input.r2.completeMultipartUpload({
					objectKey: input.upload.objectKey,
					parts: input.completion.parts,
					signal: input.signal,
					uploadId: input.completion.uploadId,
				});
			} catch {
				throw error;
			}
		}
	} else {
		await input.r2.completeMultipartUpload({
			objectKey: input.upload.objectKey,
			parts: input.completion.parts,
			signal: input.signal,
			uploadId: input.completion.uploadId,
		});
	}
	const materialized = await input.r2.headObject(
		input.upload.objectKey,
		input.signal,
	);
	if (!isExpectedObject(materialized, input.descriptor)) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_OBJECT_MISMATCH",
			`Materialized object ${input.descriptor.objectId} did not match its declared size and digest.`,
		);
	}
	return {
		bytes: await readVerifiedEvidenceObject({
			descriptor: input.descriptor,
			objectKey: input.upload.objectKey,
			r2: input.r2,
			signal: input.signal,
		}),
		multipartCompleted: true,
	};
}

async function readVerifiedEvidenceObject(input: {
	readonly descriptor: RepositoryEvidenceObjectDescriptor;
	readonly objectKey: string;
	readonly r2: R2MultipartUploadClient;
	readonly signal: AbortSignal | undefined;
}): Promise<Uint8Array> {
	const bytes = await input.r2.getObject(input.objectKey, input.signal);
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (
		bytes.byteLength !== input.descriptor.byteLength ||
		digest !== input.descriptor.sha256
	) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_OBJECT_MISMATCH",
			`Stored evidence object ${input.descriptor.objectId} failed content verification.`,
		);
	}
	return bytes;
}

function isExpectedObject(
	object: Awaited<ReturnType<R2MultipartUploadClient["headObject"]>>,
	descriptor: RepositoryEvidenceObjectDescriptor,
): boolean {
	return (
		object !== null &&
		object.byteLength === descriptor.byteLength &&
		object.metadata["content-sha256"] === descriptor.sha256 &&
		object.metadata["expected-bytes"] === descriptor.byteLength.toString()
	);
}

function assertCompletionMatches(
	uploads: readonly RepositoryEvidenceUploadObject[],
	completed: RepositoryEvidenceCommitInput["objects"],
): void {
	const expected = [...uploads].map((item) => item.objectId).sort();
	const actual = [...completed].map((item) => item.objectId).sort();
	if (
		expected.length !== actual.length ||
		expected.some((objectId, index) => objectId !== actual[index])
	) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_OBJECT_MISMATCH",
			"Completed evidence objects do not match the initialized upload.",
		);
	}
	const uploadPlans = new Map(
		uploads.map((object) => [object.objectId, object]),
	);
	for (const completion of completed) {
		const upload = uploadPlans.get(completion.objectId);
		if (
			!upload ||
			upload.objectKey !== completion.objectKey ||
			upload.uploadId !== completion.uploadId ||
			upload.parts.length !== completion.parts.length ||
			upload.parts.some(
				(part, index) =>
					part.partNumber !== completion.parts[index]?.partNumber,
			)
		) {
			throw new RepositoryEvidenceStateError(
				"EVIDENCE_OBJECT_MISMATCH",
				`Completion details for ${completion.objectId} do not match initialization.`,
			);
		}
	}
}

function getPartByteLengths(byteLength: number): number[] {
	const count = Math.ceil(byteLength / REPOSITORY_EVIDENCE_PART_SIZE_BYTES);
	return Array.from({ length: count }, (_, index) =>
		Math.min(
			REPOSITORY_EVIDENCE_PART_SIZE_BYTES,
			byteLength - index * REPOSITORY_EVIDENCE_PART_SIZE_BYTES,
		),
	);
}

/**
 * Object keys are generation-versioned: every `repository_evidence_object` row
 * gets its own random generation. Purging a deleted row's key therefore can
 * never delete content that another member re-uploads under a new row.
 */
export function createEvidenceObjectKey(
	organizationId: string,
	objectId: string,
): string {
	const digest = objectId.startsWith(SHA256_PREFIX)
		? objectId.slice(SHA256_PREFIX.length)
		: objectId;
	const organizationKey = createHash("sha256")
		.update(organizationId)
		.digest("hex");
	return `evidence/v2/${organizationKey}/${digest.slice(0, 2)}/${digest}/${crypto.randomUUID()}`;
}

async function findKnownObjects(
	organizationId: string,
	objectIds: readonly string[],
	database: postgres.Sql,
): Promise<ReadonlyMap<string, EvidenceObjectRow>> {
	if (objectIds.length === 0) return new Map();
	const rows = await database.unsafe<EvidenceObjectRow[]>(
		`SELECT object_id AS "objectId", object_key AS "objectKey",
			byte_length AS "byteLength", status
		 FROM repository_evidence_object
		 WHERE organization_id = $1 AND object_id = ANY($2::text[])`,
		[organizationId, objectIds],
	);
	return new Map(rows.map((row) => [row.objectId, row]));
}

async function lockKnownObjects(
	organizationId: string,
	objectIds: readonly string[],
	transaction: postgres.TransactionSql,
): Promise<ReadonlyMap<string, EvidenceObjectRow>> {
	if (objectIds.length === 0) return new Map();
	const rows = await transaction.unsafe<EvidenceObjectRow[]>(
		`SELECT object_id AS "objectId", object_key AS "objectKey",
			byte_length AS "byteLength", status
		 FROM repository_evidence_object
		 WHERE organization_id = $1 AND object_id = ANY($2::text[])
		 ORDER BY object_id
		 FOR UPDATE`,
		[organizationId, objectIds],
	);
	return new Map(rows.map((row) => [row.objectId, row]));
}

async function findUploadByOperation(
	operationId: string,
	organizationId: string,
	userId: string,
	database: postgres.Sql,
): Promise<EvidenceUploadRow | null> {
	const [row] = await database.unsafe<EvidenceUploadRow[]>(
		`${selectUploadSql()} WHERE operation_id = $1 AND organization_id = $2 AND user_id = $3 LIMIT 1`,
		[operationId, organizationId, userId],
	);
	return row ?? null;
}

async function findUploadById(
	id: string,
	organizationId: string,
	userId: string,
	database: postgres.Sql,
): Promise<EvidenceUploadRow | null> {
	const [row] = await database.unsafe<EvidenceUploadRow[]>(
		`${selectUploadSql()} WHERE id = $1 AND organization_id = $2 AND user_id = $3 LIMIT 1`,
		[id, organizationId, userId],
	);
	return row ?? null;
}

function selectUploadSql(): string {
	return `SELECT
		id, context_id AS "contextId", manifest_object_id AS "manifestObjectId",
		status, request, missing_object_ids AS "missingObjectIds",
		receipt_id AS "receiptId", expires_at AS "expiresAt",
		committed_at AS "committedAt"
	 FROM repository_evidence_upload`;
}

function parseStoredPlan(value: unknown): StoredEvidenceUploadPlan {
	if (typeof value !== "object" || value === null) {
		throw new Error("Stored repository evidence upload plan is invalid");
	}
	const record = value as Record<string, unknown>;
	const input = RepositoryEvidenceInitInputSchema.parse(record.input);
	if (!Array.isArray(record.uploads)) {
		throw new Error("Stored repository evidence upload list is invalid");
	}
	const uploads = record.uploads.map((value) => parseStoredUploadObject(value));
	return { input, uploads };
}

function parseStoredUploadObject(
	value: unknown,
): RepositoryEvidenceUploadObject {
	if (typeof value !== "object" || value === null) {
		throw new Error("Stored repository evidence upload object is invalid");
	}
	const record = value as Record<string, unknown>;
	if (
		typeof record.byteLength !== "number" ||
		typeof record.objectId !== "string" ||
		typeof record.objectKey !== "string" ||
		typeof record.uploadId !== "string" ||
		!Array.isArray(record.parts)
	) {
		throw new Error("Stored repository evidence upload object is invalid");
	}
	return {
		byteLength: record.byteLength,
		objectId: record.objectId,
		objectKey: record.objectKey,
		parts: record.parts.map((part) => {
			if (typeof part !== "object" || part === null) {
				throw new Error("Stored repository evidence upload part is invalid");
			}
			const partRecord = part as Record<string, unknown>;
			if (
				typeof partRecord.byteLength !== "number" ||
				typeof partRecord.partNumber !== "number"
			) {
				throw new Error("Stored repository evidence upload part is invalid");
			}
			return {
				byteLength: partRecord.byteLength,
				headers: { "Content-Length": partRecord.byteLength.toString() },
				partNumber: partRecord.partNumber,
				uploadUrl: "https://invalid.local/expired",
			};
		}),
		uploadId: record.uploadId,
	};
}

function buildCommitOutput(
	upload: EvidenceUploadRow,
	plan: StoredEvidenceUploadPlan,
	status: "duplicate",
): RepositoryEvidenceCommitOutput {
	if (!upload.receiptId || !upload.committedAt) {
		throw new Error("Committed repository evidence is missing its receipt");
	}
	return {
		acceptedAt: toDate(upload.committedAt).toISOString(),
		contextId: upload.contextId,
		manifestObjectId: upload.manifestObjectId,
		protocol: REPOSITORY_EVIDENCE_PROTOCOL,
		receiptId: upload.receiptId,
		status,
		storedObjectIds: plan.input.objects.map((object) => object.objectId),
		uploadReceiptId: upload.id,
	};
}

async function markUploadExpired(
	id: string,
	now: Date,
	database: postgres.Sql,
): Promise<void> {
	await database.unsafe(
		`UPDATE repository_evidence_upload
		 SET status = 'expired', updated_at = $1
		 WHERE id = $2 AND status = 'initialized'`,
		[now.toISOString(), id],
	);
}

function assertOrganization(input: string, resolved: string): void {
	if (input !== resolved) {
		throw new RepositoryEvidenceStateError(
			"EVIDENCE_ORGANIZATION_MISMATCH",
			"Repository evidence organization does not match the authenticated workspace.",
		);
	}
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}
