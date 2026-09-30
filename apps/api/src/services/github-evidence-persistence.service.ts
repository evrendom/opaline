import { createHash, randomUUID } from "node:crypto";
import {
	createGitHubAuthorization,
	createGitHubRepositorySource,
	GITHUB_SOURCE_VERSION,
	type RepositoryIntelligenceSource,
} from "@rudel/repo-intelligence-source-github";
import { FILTER_VERSION, filterKnownSecrets } from "@rudel/secret-filter";
import type postgres from "postgres";
import { assertNoClickHousePurgeTombstone } from "./clickhouse-purge-tombstone.service.js";
import {
	createGitHubInstallationAccessToken,
	type GitHubRepositoryAppConfig,
} from "./github-app.service.js";
import {
	type CollectedGitHubCommitEvidence,
	collectGitHubCommitEvidence,
	type GitHubMetadataPage,
	summarizeGitHubEvidenceCoverage,
} from "./github-evidence-collector.service.js";
import {
	GITHUB_OBJECT_INTENT_GRACE_MS,
	registerGitHubObjectIntent,
	releaseGitHubObjectIntents,
} from "./github-evidence-object-fence.service.js";
import {
	type GitHubRepositoryBinding,
	getGitHubRepositoryBinding,
} from "./github-repository-binding.service.js";
import { toPostgresJson } from "./postgres-json.js";
import type { R2EvidenceStorageClient } from "./r2-ingest-storage.service.js";

const MAX_JOB_LOG_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_CHUNK_BYTES = 1024 * 1024;
// Aggregate stored-log budget for one collection. Logs are persisted one at a
// time and never retained in memory; once the budget is spent the remaining
// jobs are recorded as partial coverage instead of being fetched.
const MAX_COLLECTION_LOG_BYTES = 256 * 1024 * 1024;
// Collections that may run concurrently in one API process. Each holds at most
// one job log in memory at a time, so this bounds peak log memory.
const MAX_ACTIVE_COLLECTIONS = 2;
const SHA256_PREFIX = "sha256:";
const COLLECTION_LEASE_MS = 15 * 60 * 1_000;
const MAX_AUTOMATIC_RETRIES = 2;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;

export class GitHubEvidenceCapacityError extends Error {
	constructor() {
		super("GitHub evidence collection capacity is exhausted; retry later.");
		this.name = "GitHubEvidenceCapacityError";
	}
}

let activeCollections = 0;

function acquireCollectionSlot(): () => void {
	if (activeCollections >= MAX_ACTIVE_COLLECTIONS) {
		throw new GitHubEvidenceCapacityError();
	}
	activeCollections += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeCollections -= 1;
	};
}

export interface PersistedGitHubObject {
	readonly byteLength: number;
	readonly objectId: string;
	readonly objectKey: string;
	readonly sha256: string;
}

interface PersistedGitHubMetadataChunk extends PersistedGitHubObject {
	readonly dataset: GitHubMetadataPage["dataset"];
	readonly scope: string;
}

export interface GitHubEvidenceCollectionResult {
	readonly collectionId: string;
	readonly commitSha: string;
	readonly logCount: number;
	readonly metadataObjectId: string;
	readonly status: "complete" | "partial";
}

export function resolvePriorSessionAttribution(
	rows: readonly { session_source: string; session_user_id: string }[],
): { sessionSource: string; sessionUserId: string } | undefined {
	const row = rows.length === 1 ? rows[0] : undefined;
	return row
		? {
				sessionSource: row.session_source,
				sessionUserId: row.session_user_id,
			}
		: undefined;
}

export async function collectAndPersistGitHubCommitEvidence(
	input: CollectAndPersistInput,
): Promise<GitHubEvidenceCollectionResult> {
	// The slot is taken before any reservation so a saturated process never
	// burns a durable attempt or retry.
	const releaseSlot = acquireCollectionSlot();
	try {
		return await runCollection(input);
	} finally {
		releaseSlot();
	}
}

type CollectAndPersistInput = {
	readonly commitSha: string;
	readonly config: GitHubRepositoryAppConfig;
	readonly createInstallationToken?: (
		config: GitHubRepositoryAppConfig,
		installationId: string,
	) => Promise<string>;
	readonly contextId: string | null;
	readonly database: postgres.Sql;
	readonly initiatedByUserId: string | null;
	readonly now?: () => Date;
	readonly organizationId: string;
	readonly repositoryId: string;
	readonly queuedCollectionId?: string;
	readonly refresh?: boolean;
	readonly refreshCollectionId?: string;
	readonly retryCollectionId?: string;
	readonly r2: R2EvidenceStorageClient;
	readonly signal?: AbortSignal;
	readonly sessionId: string | null;
	readonly sessionSource?: string | null;
	readonly sessionUserId?: string | null;
	readonly sourceFactory?: (
		token: string,
	) => Pick<
		RepositoryIntelligenceSource,
		| "getCommit"
		| "getWorkflowJobLog"
		| "listCheckRuns"
		| "listCheckRunAnnotations"
		| "listCheckSuites"
		| "listCommitPullRequests"
		| "listCommitStatuses"
		| "listIssueComments"
		| "listPullRequestFiles"
		| "listPullRequestReviewComments"
		| "listPullRequestReviews"
		| "listWorkflowArtifacts"
		| "listWorkflowJobs"
		| "listWorkflowRuns"
	>;
};

async function runCollection(
	input: CollectAndPersistInput,
): Promise<GitHubEvidenceCollectionResult> {
	const now = input.now ?? (() => new Date());
	const binding = await getGitHubRepositoryBinding({
		database: input.database,
		organizationId: input.organizationId,
		repositoryId: input.repositoryId,
	});
	if (!binding) throw new Error("GitHub repository binding was not found.");
	const reservation = await reserveCollection({
		...input,
		binding,
		now: now(),
		queuedCollectionId: input.queuedCollectionId,
		refresh: input.refresh ?? false,
		refreshCollectionId: input.refreshCollectionId,
		retryCollectionId: input.retryCollectionId,
		sessionSource: input.sessionSource ?? null,
		sessionUserId: input.sessionUserId ?? null,
	});
	if (reservation.existing) return reservation.existing;

	try {
		input.signal?.throwIfAborted();
		const abortableFetch = input.signal
			? createAbortableFetch(input.signal)
			: undefined;
		const token = input.createInstallationToken
			? await input.createInstallationToken(
					input.config,
					binding.installationId,
				)
			: await createGitHubInstallationAccessToken({
					config: input.config,
					fetch: abortableFetch,
					installationId: binding.installationId,
				});
		const source =
			input.sourceFactory?.(token) ??
			createGitHubRepositorySource({
				authorization: createGitHubAuthorization(token),
				fetch: abortableFetch,
			});
		const fence: GitHubObjectWriteFence = {
			userId: input.sessionUserId ?? input.initiatedByUserId ?? undefined,
			collectionId: reservation.collectionId,
			database: input.database,
			dueAt: new Date(
				now().getTime() + COLLECTION_LEASE_MS + GITHUB_OBJECT_INTENT_GRACE_MS,
			),
		};
		const persistedLogs = new Map<string, PersistedGitHubObject>();
		const metadataChunks: PersistedGitHubMetadataChunk[] = [];
		const evidence = await withAbort(
			collectGitHubCommitEvidence({
				commitSha: input.commitSha,
				maxCollectionLogBytes: MAX_COLLECTION_LOG_BYTES,
				maxJobLogBytes: MAX_JOB_LOG_BYTES,
				onMetadataPage: async (page) => {
					const persist = async (items: readonly string[]) => {
						if (items.length === 0) return;
						const bytes = new TextEncoder().encode(
							`{"dataset":${JSON.stringify(page.dataset)},"scope":${JSON.stringify(page.scope)},"items":[${items.join(",")}]}`,
						);
						if (bytes.length > MAX_METADATA_CHUNK_BYTES)
							throw new Error("GitHub metadata chunk exceeded its byte budget");
						const object = await persistContentAddressedGitHubObject({
							bytes,
							contentType: "application/json",
							fence,
							kind: "ci-metadata",
							organizationId: input.organizationId,
							r2: input.r2,
							repositoryId: binding.repositoryId,
							signal: input.signal,
						});
						metadataChunks.push({
							...object,
							dataset: page.dataset,
							scope: page.scope,
						});
					};
					let items: string[] = [];
					let bytes = 0;
					for (const item of page.items) {
						const serialized = filterKnownSecrets(JSON.stringify(item)).text;
						const length = Buffer.byteLength(serialized);
						if (bytes + length > MAX_METADATA_CHUNK_BYTES - 1024) {
							await persist(items);
							items = [];
							bytes = 0;
						}
						items.push(serialized);
						bytes += length + 1;
					}
					await persist(items);
				},
				// Each filtered log is written as soon as it is collected and only
				// its receipt is retained, so memory does not grow with job count.
				onWorkflowJobLog: async (log) => {
					persistedLogs.set(
						log.jobId,
						await persistContentAddressedGitHubObject({
							bytes: new TextEncoder().encode(log.content),
							contentType: log.contentType ?? "text/plain; charset=utf-8",
							fence,
							kind: "ci-log",
							organizationId: input.organizationId,
							r2: input.r2,
							repositoryId: binding.repositoryId,
							signal: input.signal,
						}),
					);
				},
				repository: { name: binding.name, owner: binding.owner },
				signal: input.signal,
				source,
			}),
			input.signal,
		);
		const persisted = {
			logs: persistedLogs,
			metadata: await persistMetadataObject({
				metadataChunks,
				evidence,
				fence,
				logs: persistedLogs,
				organizationId: input.organizationId,
				r2: input.r2,
				repositoryId: binding.repositoryId,
				signal: input.signal,
			}),
		};
		const status =
			evidence.overallCoverage === "complete" &&
			evidence.remoteEnumerationConsistency !== "conflicted"
				? "complete"
				: "partial";
		await completeCollection({
			binding,
			collectionId: reservation.collectionId,
			contextId: input.contextId,
			database: input.database,
			evidence,
			initiatedByUserId: input.initiatedByUserId,
			metadata: persisted.metadata,
			metadataChunks,
			now: now(),
			organizationId: input.organizationId,
			persistedLogs: persisted.logs,
			retryCount: reservation.retryCount,
			userId: input.sessionUserId ?? input.initiatedByUserId ?? undefined,
			signal: input.signal,
			sessionId: input.sessionId,
			status,
		});
		return {
			collectionId: reservation.collectionId,
			commitSha: input.commitSha,
			logCount: evidence.workflowJobLogReceipts.length,
			metadataObjectId: persisted.metadata.objectId,
			status,
		};
	} catch (error) {
		const filteredError = filterKnownSecrets(String(error)).text.slice(
			0,
			2_000,
		);
		const failedAt = now();
		await input.database.unsafe(
			"UPDATE github_evidence_collection SET status = 'failed', error = $2, completed_at = $3, lease_expires_at = NULL, retry_after = CASE WHEN retry_count < $4 THEN $5::timestamptz ELSE NULL END, refresh_due_at = CASE WHEN session_user_id <> '' AND observation_started_at > $3::timestamptz - INTERVAL '14 days' THEN LEAST(refresh_due_at, $3::timestamptz + INTERVAL '1 day') ELSE NULL END, updated_at = $3 WHERE id = $1 AND status = 'collecting'",
			[
				reservation.collectionId,
				filteredError,
				failedAt.toISOString(),
				MAX_AUTOMATIC_RETRIES,
				new Date(
					failedAt.getTime() + retryDelayMs(reservation.retryCount),
				).toISOString(),
			],
		);
		throw error;
	}
}

export interface GitHubObjectWriteFence {
	readonly userId?: string;
	readonly collectionId: string;
	readonly database: postgres.Sql;
	readonly dueAt: Date;
}

export async function persistContentAddressedGitHubObject(input: {
	readonly bytes: Uint8Array;
	readonly contentType: string;
	readonly fence?: GitHubObjectWriteFence;
	readonly kind: "ci-log" | "ci-metadata";
	readonly organizationId: string;
	readonly r2: R2EvidenceStorageClient;
	readonly repositoryId: string;
	readonly signal?: AbortSignal;
}): Promise<PersistedGitHubObject> {
	const sha256 = createHash("sha256").update(input.bytes).digest("hex");
	const organizationHash = createHash("sha256")
		.update(input.organizationId)
		.digest("hex");
	const objectId = `${SHA256_PREFIX}${sha256}`;
	const objectKey = [
		"repository-evidence",
		"v1",
		organizationHash,
		"github",
		input.repositoryId,
		input.kind,
		sha256,
	].join("/");
	input.signal?.throwIfAborted();
	if (input.fence) {
		// Check before write, then register intent before the object is touched.
		await assertNoClickHousePurgeTombstone(
			{ organizationId: input.organizationId, userId: input.fence.userId },
			{ database: input.fence.database },
		);
		await registerGitHubObjectIntent(input.fence.database, {
			collectionId: input.fence.collectionId,
			dueAt: input.fence.dueAt,
			objectKey,
			organizationId: input.organizationId,
		});
	}
	const existing = await input.r2.headObject(objectKey, input.signal);
	if (existing && existing.byteLength !== input.bytes.byteLength) {
		throw new Error(
			"GitHub evidence object key has conflicting content length.",
		);
	}
	if (existing) {
		const existingBytes = await input.r2.getObject(objectKey, input.signal);
		const existingSha256 = createHash("sha256")
			.update(existingBytes)
			.digest("hex");
		if (existingSha256 !== sha256) {
			throw new Error("GitHub evidence object key failed its digest check.");
		}
	}
	if (!existing) {
		await input.r2.putObject({
			body: input.bytes,
			contentType: input.contentType,
			metadata: {
				"filter-version": String(FILTER_VERSION),
				kind: input.kind,
				sha256,
			},
			objectKey,
			signal: input.signal,
		});
	}
	return {
		byteLength: input.bytes.byteLength,
		objectId,
		objectKey,
		sha256,
	};
}

async function persistMetadataObject(input: {
	readonly metadataChunks: readonly PersistedGitHubMetadataChunk[];
	readonly evidence: CollectedGitHubCommitEvidence;
	readonly fence: GitHubObjectWriteFence;
	readonly logs: ReadonlyMap<string, PersistedGitHubObject>;
	readonly organizationId: string;
	readonly r2: R2EvidenceStorageClient;
	readonly repositoryId: string;
	readonly signal?: AbortSignal;
}): Promise<PersistedGitHubObject> {
	const serialized = JSON.stringify({
		schema: "github-evidence-metadata/v2",
		repository: input.evidence.repository,
		commitSha: input.evidence.commitSha,
		coverage: input.evidence.coverage,
		pageReceipts: input.evidence.pageReceipts,
		overallCoverage: input.evidence.overallCoverage,
		remoteEnumerationConsistency: input.evidence.remoteEnumerationConsistency,
		workflowJobLogReceipts: input.evidence.workflowJobLogReceipts,
		metadataChunks: input.metadataChunks,
		filterVersion: FILTER_VERSION,
		logObjects: [...input.logs].map(([jobId, object]) => ({
			jobId,
			objectId: object.objectId,
			objectKey: object.objectKey,
		})),
	});
	const filtered = filterKnownSecrets(serialized);
	return persistContentAddressedGitHubObject({
		bytes: new TextEncoder().encode(filtered.text),
		contentType: "application/json",
		fence: input.fence,
		kind: "ci-metadata",
		organizationId: input.organizationId,
		r2: input.r2,
		repositoryId: input.repositoryId,
		signal: input.signal,
	});
}

async function reserveCollection(input: {
	readonly binding: GitHubRepositoryBinding;
	readonly commitSha: string;
	readonly contextId: string | null;
	readonly database: postgres.Sql;
	readonly initiatedByUserId: string | null;
	readonly now: Date;
	readonly organizationId: string;
	readonly queuedCollectionId: string | undefined;
	readonly refresh: boolean;
	readonly refreshCollectionId: string | undefined;
	readonly retryCollectionId: string | undefined;
	readonly sessionId: string | null;
	readonly sessionSource: string | null;
	readonly sessionUserId: string | null;
}): Promise<{
	readonly collectionId: string;
	readonly existing: GitHubEvidenceCollectionResult | null;
	readonly retryCount: number;
}> {
	return input.database.begin(async (transaction) => {
		const userId = input.sessionUserId || input.initiatedByUserId;
		if (userId) {
			const users = await transaction.unsafe(
				'SELECT id FROM "user" WHERE id = $1 FOR KEY SHARE',
				[userId],
			);
			if (users.length !== 1)
				throw new Error("GitHub evidence account was deleted.");
		}
		await assertNoClickHousePurgeTombstone(
			{ organizationId: input.organizationId, userId: userId || undefined },
			{ database: transaction },
		);
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			[
				`github-evidence:${collectionIdentity({
					commitSha: input.commitSha,
					contextId: input.contextId,
					organizationId: input.organizationId,
					repositoryId: input.binding.repositoryId,
					sessionId: input.sessionId,
				})}`,
			],
		);
		const persistedRows = await transaction.unsafe<
			Array<{
				attempt_number: number;
				id: string;
				lease_expires_at: unknown;
				metadata_object_id: string | null;
				observation_started_at: unknown;
				retry_count: number;
				session_source: string;
				session_user_id: string;
				status: "queued" | "collecting" | "complete" | "partial" | "failed";
			}>
		>(
			"SELECT id, attempt_number, retry_count, status, metadata_object_id, lease_expires_at, session_source, session_user_id, observation_started_at FROM github_evidence_collection WHERE organization_id = $1 AND repository_id = $2 AND commit_sha = $3 AND session_id = $4 AND context_id = $5 ORDER BY attempt_number DESC FOR UPDATE",
			[
				input.organizationId,
				input.binding.repositoryId,
				input.commitSha,
				input.sessionId ?? "",
				input.contextId ?? "",
			],
		);
		const rows = persistedRows.map((row) => ({
			...row,
			lease_expires_at: parsePersistedTimestamp(
				row.lease_expires_at,
				"github_evidence_collection.lease_expires_at",
			),
		}));
		const existing = rows[0];
		if (input.refreshCollectionId && existing?.id !== input.refreshCollectionId)
			throw new Error("GitHub evidence retry is no longer eligible.");
		if (input.refreshCollectionId)
			await transaction.unsafe(
				"UPDATE github_evidence_collection SET refresh_due_at = NULL WHERE id = $1",
				[input.refreshCollectionId],
			);
		if (input.queuedCollectionId) {
			const queued = rows.find((row) => row.id === input.queuedCollectionId);
			if (!queued || queued.status !== "queued") {
				throw new Error("GitHub evidence retry is no longer eligible.");
			}
			await transaction.unsafe(
				"UPDATE github_evidence_collection SET status = 'collecting', started_at = $2, lease_expires_at = $3, retry_after = NULL, updated_at = $2 WHERE id = $1 AND status = 'queued'",
				[
					queued.id,
					input.now.toISOString(),
					new Date(input.now.getTime() + COLLECTION_LEASE_MS).toISOString(),
				],
			);
			return {
				collectionId: queued.id,
				existing: null,
				retryCount: queued.retry_count,
			};
		}
		if (existing?.status === "queued") {
			throw new Error("GitHub evidence collection is already in progress.");
		}
		const completed = rows.find(
			(row) =>
				(row.status === "complete" || row.status === "partial") &&
				row.metadata_object_id,
		);
		if (input.retryCollectionId) {
			if (!existing || existing.id !== input.retryCollectionId) {
				throw new Error("GitHub evidence retry is no longer eligible.");
			}
			if (existing.retry_count >= MAX_AUTOMATIC_RETRIES) {
				throw new Error("GitHub evidence retry limit was reached.");
			}
			if (
				existing.status === "collecting" &&
				existing.lease_expires_at &&
				existing.lease_expires_at.getTime() > input.now.getTime()
			) {
				throw new Error("GitHub evidence collection is already in progress.");
			}
			if (existing.status === "collecting") {
				await transaction.unsafe(
					"UPDATE github_evidence_collection SET status = 'failed', error = 'Collection lease expired.', completed_at = $2, lease_expires_at = NULL, retry_after = $2, updated_at = $2 WHERE id = $1 AND status = 'collecting'",
					[existing.id, input.now.toISOString()],
				);
			}
		}
		if (
			completed &&
			!input.refresh &&
			!input.retryCollectionId &&
			completed.metadata_object_id
		) {
			const counts = await transaction.unsafe<Array<{ count: number }>>(
				"SELECT count(*)::int AS count FROM github_ci_log_receipt WHERE collection_id = $1",
				[completed.id],
			);
			return {
				collectionId: completed.id,
				retryCount: completed.retry_count,
				existing: {
					collectionId: completed.id,
					commitSha: input.commitSha,
					logCount: counts[0]?.count ?? 0,
					metadataObjectId: completed.metadata_object_id,
					status: completed.status === "complete" ? "complete" : "partial",
				},
			};
		}
		if (
			existing?.status === "collecting" &&
			existing.lease_expires_at &&
			existing.lease_expires_at.getTime() > input.now.getTime()
		) {
			throw new Error("GitHub evidence collection is already in progress.");
		}
		if (existing?.status === "collecting") {
			await transaction.unsafe(
				"UPDATE github_evidence_collection SET status = 'failed', error = 'Collection lease expired.', completed_at = $2, lease_expires_at = NULL, retry_after = $2, updated_at = $2 WHERE id = $1 AND status = 'collecting'",
				[existing.id, input.now.toISOString()],
			);
		}
		const collectionId = randomUUID();
		const attemptNumber = (existing?.attempt_number ?? 0) + 1;
		const retryCount = input.retryCollectionId
			? (existing?.retry_count ?? 0) + 1
			: 0;
		if (input.retryCollectionId) {
			await transaction.unsafe(
				"UPDATE github_evidence_collection SET retry_after = NULL, updated_at = $2 WHERE id = $1",
				[input.retryCollectionId, input.now.toISOString()],
			);
		}
		// Attribution is persisted with the reservation so every retry and explicit
		// refresh keeps the original session source and owner.
		const attribution = rows.find(
			(row) => row.session_source !== "" && row.session_user_id !== "",
		);
		await transaction.unsafe(
			"INSERT INTO github_evidence_collection (id, organization_id, repository_id, installation_id, initiated_by_user_id, session_id, session_source, session_user_id, context_id, commit_sha, attempt_number, retry_count, retry_of_collection_id, status, source_version, coverage, started_at, lease_expires_at, created_at, updated_at, observation_started_at) VALUES ($1, $2, $3, $4, $5, $6, $15, $16, $7, $8, $9, $10, $11, 'collecting', $12, '{}'::jsonb, $13, $14, $13, $13, $17)",
			[
				collectionId,
				input.organizationId,
				input.binding.repositoryId,
				input.binding.installationId,
				input.initiatedByUserId,
				input.sessionId ?? "",
				input.contextId ?? "",
				input.commitSha,
				attemptNumber,
				retryCount,
				input.retryCollectionId ?? null,
				GITHUB_SOURCE_VERSION,
				input.now.toISOString(),
				new Date(input.now.getTime() + COLLECTION_LEASE_MS).toISOString(),
				input.sessionSource || attribution?.session_source || "",
				input.sessionUserId || attribution?.session_user_id || "",
				parsePersistedTimestamp(
					existing?.observation_started_at ?? null,
					"github_evidence_collection.observation_started_at",
				)?.toISOString() ?? input.now.toISOString(),
			],
		);
		return { collectionId, existing: null, retryCount };
	});
}

async function completeCollection(input: {
	readonly binding: GitHubRepositoryBinding;
	readonly collectionId: string;
	readonly contextId: string | null;
	readonly database: postgres.Sql;
	readonly evidence: CollectedGitHubCommitEvidence;
	readonly initiatedByUserId: string | null;
	readonly metadata: PersistedGitHubObject;
	readonly metadataChunks: readonly PersistedGitHubMetadataChunk[];
	readonly now: Date;
	readonly organizationId: string;
	readonly persistedLogs: ReadonlyMap<string, PersistedGitHubObject>;
	readonly retryCount: number;
	readonly userId: string | undefined;
	readonly signal: AbortSignal | undefined;
	readonly sessionId: string | null;
	readonly status: "complete" | "partial";
}): Promise<void> {
	const jobs = new Map(
		input.evidence.workflowJobs.map(({ job }) => [job.id, job] as const),
	);
	const runs = new Map(
		input.evidence.workflowRuns.map((run) => [run.id, run] as const),
	);
	await input.database.begin(async (transaction) => {
		input.signal?.throwIfAborted();
		if (input.userId) {
			const users = await transaction.unsafe(
				'SELECT id FROM "user" WHERE id = $1 FOR KEY SHARE',
				[input.userId],
			);
			if (users.length !== 1)
				throw new Error("GitHub evidence account was deleted.");
		}
		await assertNoClickHousePurgeTombstone(
			{ organizationId: input.organizationId, userId: input.userId },
			{ database: transaction },
		);
		const persistedLeases = await transaction.unsafe<
			Array<{
				lease_expires_at: unknown;
				session_source: string;
				session_user_id: string;
				status: string;
			}>
		>(
			"SELECT status, lease_expires_at, session_source, session_user_id FROM github_evidence_collection WHERE id = $1 FOR UPDATE",
			[input.collectionId],
		);
		const persistedLease = persistedLeases[0];
		const lease = persistedLease
			? {
					...persistedLease,
					lease_expires_at: parsePersistedTimestamp(
						persistedLease.lease_expires_at,
						"github_evidence_collection.lease_expires_at",
					),
				}
			: undefined;
		if (
			lease?.status !== "collecting" ||
			!lease.lease_expires_at ||
			lease.lease_expires_at.getTime() <= input.now.getTime()
		) {
			throw new Error("GitHub evidence collection lease was lost.");
		}
		const { ciCoverageComplete, pullRequestCoverageComplete } =
			summarizeGitHubEvidenceCoverage(input.evidence);
		const storedSource = persistedLease?.session_source ?? "";
		const storedUserId = persistedLease?.session_user_id ?? "";
		const priorAttributions =
			input.sessionId && input.contextId && (!storedSource || !storedUserId)
				? await transaction.unsafe<
						Array<{ session_source: string; session_user_id: string }>
					>(
						`SELECT DISTINCT snapshot.session_source, snapshot.session_user_id
						 FROM github_pull_request_snapshot snapshot
						 JOIN github_evidence_collection collection ON collection.id = snapshot.collection_id
						 WHERE snapshot.organization_id = $1 AND snapshot.repository_id = $2
						  AND snapshot.session_id = $3 AND collection.context_id = $4
						  AND snapshot.session_source <> '' AND snapshot.session_user_id <> ''
						 LIMIT 2`,
						[
							input.organizationId,
							input.binding.repositoryId,
							input.sessionId,
							input.contextId,
						],
					)
				: [];
		const priorAttribution = resolvePriorSessionAttribution(priorAttributions);
		const sessionSource = storedSource || priorAttribution?.sessionSource || "";
		const sessionUserId = storedUserId || priorAttribution?.sessionUserId || "";
		for (const pullRequest of input.evidence.pullRequests) {
			await transaction.unsafe(
				"INSERT INTO github_pull_request_snapshot (organization_id, collection_id, repository_id, provider, provider_pull_request_id, pull_number, head_sha, merged_at, session_id, session_source, session_user_id, coverage_complete, ci_coverage_complete, observed_at) VALUES ($1, $2, $3, 'github', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
				[
					input.organizationId,
					input.collectionId,
					input.binding.repositoryId,
					pullRequest.id,
					pullRequest.number,
					pullRequest.headSha,
					pullRequest.mergedAt,
					input.sessionId ?? "",
					sessionSource,
					sessionUserId,
					pullRequestCoverageComplete,
					ciCoverageComplete,
					input.now.toISOString(),
				],
			);
		}
		for (const receipt of input.evidence.workflowJobLogReceipts) {
			const job = jobs.get(receipt.jobId);
			const run = runs.get(receipt.runId);
			if (!job || !run) {
				throw new Error("GitHub job-log receipt lost its job or run identity.");
			}
			const object = input.persistedLogs.get(receipt.jobId);
			await transaction.unsafe(
				"INSERT INTO github_ci_log_receipt (organization_id, collection_id, repository_id, workflow_run_id, run_attempt, job_id, job_name, status, conclusion, object_id, object_key, original_byte_length, stored_byte_length, filter_version, redaction_counts, truncated, unavailable_reason, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::text::jsonb, $16, $17, $18)",
				[
					input.organizationId,
					input.collectionId,
					input.binding.repositoryId,
					receipt.runId,
					receipt.attempt ?? run.runAttempt,
					receipt.jobId,
					job.name,
					job.status,
					job.conclusion,
					object?.objectId ?? null,
					object?.objectKey ?? null,
					receipt.originalByteLength,
					receipt.storedByteLength,
					FILTER_VERSION,
					JSON.stringify(receipt.redactionCounts),
					receipt.truncated,
					receipt.coverage === "unavailable"
						? "GitHub job log was unavailable; see collection coverage."
						: null,
					input.now.toISOString(),
				],
			);
		}
		const unresolved =
			!pullRequestCoverageComplete ||
			!ciCoverageComplete ||
			input.evidence.pullRequests.length === 0 ||
			input.evidence.pullRequests.some(
				(pullRequest) => pullRequest.state === "open",
			) ||
			input.evidence.workflowRuns.some((run) => run.status !== "completed") ||
			input.evidence.workflowJobs.some(
				({ job }) => job.status !== "completed",
			) ||
			input.evidence.checkRuns.some(
				({ checkRun }) => checkRun.status !== "completed",
			) ||
			input.evidence.commitStatuses.some(
				(status) => status.state === "pending",
			);
		await transaction.unsafe(
			"UPDATE github_evidence_collection SET status = $2, coverage = $3::text::jsonb, metadata_object_id = $4, metadata_object_key = $5, metadata_chunks = $10::text::jsonb, error = NULL, completed_at = $6, lease_expires_at = NULL, retry_after = CASE WHEN $2 = 'partial' AND retry_count < $7 THEN $8::timestamptz ELSE NULL END, refresh_due_at = CASE WHEN session_user_id <> '' AND observation_started_at > $6::timestamptz - INTERVAL '14 days' THEN CASE WHEN $9 THEN LEAST(refresh_due_at, $6::timestamptz + INTERVAL '1 day') ELSE refresh_due_at END ELSE NULL END, updated_at = $6 WHERE id = $1 AND status = 'collecting'",
			[
				input.collectionId,
				input.status,
				JSON.stringify(
					toPostgresJson({
						ciCoverageComplete,
						pullRequestCoverageComplete,
						overall: input.evidence.overallCoverage,
						pageReceipts: input.evidence.pageReceipts,
						records: input.evidence.coverage,
						remoteEnumerationConsistency:
							input.evidence.remoteEnumerationConsistency,
					}),
				),
				input.metadata.objectId,
				input.metadata.objectKey,
				input.now.toISOString(),
				MAX_AUTOMATIC_RETRIES,
				new Date(
					input.now.getTime() + retryDelayMs(input.retryCount),
				).toISOString(),
				unresolved,
				JSON.stringify(input.metadataChunks),
			],
		);
		await transaction.unsafe(
			"UPDATE github_repository_binding SET last_synced_at = $3, updated_at = $3 WHERE organization_id = $1 AND repository_id = $2",
			[
				input.organizationId,
				input.binding.repositoryId,
				input.now.toISOString(),
			],
		);
		// Every object key is now referenced by a committed receipt or the
		// collection metadata, so the write-ahead intents are released.
		await releaseGitHubObjectIntents(transaction, input.collectionId);
	});
}

function collectionIdentity(input: {
	readonly commitSha: string;
	readonly contextId: string | null;
	readonly organizationId: string;
	readonly repositoryId: string;
	readonly sessionId: string | null;
}): string {
	return [
		input.organizationId,
		input.repositoryId,
		input.commitSha,
		input.sessionId ?? "",
		input.contextId ?? "",
	].join(":");
}

export interface GitHubEvidenceEnqueueResult {
	readonly collectionId: string | null;
	readonly status: "existing" | "queued" | "skipped";
}

/**
 * Durably records a collection request and returns immediately. The bounded
 * worker performs the provider calls, so a slow or rate-limited GitHub never
 * delays the acknowledgement of an accepted repository capture. Attribution is
 * stored with the request so retries and refreshes keep it.
 */
export async function enqueueGitHubEvidenceCollection(input: {
	readonly commitSha: string;
	readonly contextId: string | null;
	readonly database: postgres.Sql;
	readonly initiatedByUserId: string | null;
	readonly now?: () => Date;
	readonly organizationId: string;
	readonly repositoryId: string;
	readonly sessionId: string | null;
	readonly sessionSource: string | null;
	readonly sessionUserId: string | null;
}): Promise<GitHubEvidenceEnqueueResult> {
	const now = (input.now ?? (() => new Date()))();
	const binding = await getGitHubRepositoryBinding({
		database: input.database,
		organizationId: input.organizationId,
		repositoryId: input.repositoryId,
	});
	if (!binding) return { collectionId: null, status: "skipped" };
	return input.database.begin(async (transaction) => {
		const userId = input.sessionUserId || input.initiatedByUserId;
		if (userId) {
			const users = await transaction.unsafe(
				'SELECT id FROM "user" WHERE id = $1 FOR KEY SHARE',
				[userId],
			);
			if (users.length !== 1)
				throw new Error("GitHub evidence account was deleted.");
		}
		await assertNoClickHousePurgeTombstone(
			{ organizationId: input.organizationId, userId: userId || undefined },
			{ database: transaction },
		);
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			[
				`github-evidence:${collectionIdentity({
					commitSha: input.commitSha,
					contextId: input.contextId,
					organizationId: input.organizationId,
					repositoryId: binding.repositoryId,
					sessionId: input.sessionId,
				})}`,
			],
		);
		const [existing] = await transaction.unsafe<Array<{ id: string }>>(
			"SELECT id FROM github_evidence_collection WHERE organization_id = $1 AND repository_id = $2 AND commit_sha = $3 AND session_id = $4 AND context_id = $5 ORDER BY attempt_number DESC LIMIT 1",
			[
				input.organizationId,
				binding.repositoryId,
				input.commitSha,
				input.sessionId ?? "",
				input.contextId ?? "",
			],
		);
		if (existing) return { collectionId: existing.id, status: "existing" };
		const collectionId = randomUUID();
		await transaction.unsafe(
			"INSERT INTO github_evidence_collection (id, organization_id, repository_id, installation_id, initiated_by_user_id, session_id, session_source, session_user_id, context_id, commit_sha, attempt_number, retry_count, status, source_version, coverage, started_at, retry_after, created_at, updated_at, observation_started_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, 0, 'queued', $11, '{}'::jsonb, $12, $12, $12, $12, $12)",
			[
				collectionId,
				input.organizationId,
				binding.repositoryId,
				binding.installationId,
				input.initiatedByUserId,
				input.sessionId ?? "",
				input.sessionSource ?? "",
				input.sessionUserId ?? "",
				input.contextId ?? "",
				input.commitSha,
				GITHUB_SOURCE_VERSION,
				now.toISOString(),
			],
		);
		return { collectionId, status: "queued" };
	});
}

function retryDelayMs(retryCount: number): number {
	return RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)] ?? 0;
}

function parsePersistedTimestamp(value: unknown, field: string): Date | null {
	if (value === null) return null;
	if (!(value instanceof Date) && typeof value !== "string") {
		throw new Error(`${field} has an invalid database value.`);
	}
	const timestamp =
		value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (Number.isNaN(timestamp.getTime())) {
		throw new Error(`${field} has an invalid database value.`);
	}
	return timestamp;
}

function createAbortableFetch(signal: AbortSignal): typeof globalThis.fetch {
	return Object.assign(
		(request: string | URL | Request, init?: RequestInit) =>
			fetch(request, { ...init, signal }),
		{ preconnect: globalThis.fetch.preconnect },
	);
}

async function withAbort<TResult>(
	promise: Promise<TResult>,
	signal: AbortSignal | undefined,
): Promise<TResult> {
	if (!signal) return promise;
	signal.throwIfAborted();
	let rejectAbort: ((reason: unknown) => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const onAbort = (): void => rejectAbort?.(signal.reason);
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([promise, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
