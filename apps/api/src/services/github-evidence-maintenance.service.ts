import type postgres from "postgres";
import type { GitHubRepositoryAppConfig } from "./github-app.service.js";
import { collectAndPersistGitHubCommitEvidence } from "./github-evidence-persistence.service.js";
import type { R2EvidenceStorageClient } from "./r2-ingest-storage.service.js";

type CollectInput = Parameters<typeof collectAndPersistGitHubCommitEvidence>[0];

const DEFAULT_BATCH_SIZE = 5;
const MAX_AUTOMATIC_RETRIES = 2;

interface GitHubEvidenceMaintenanceCandidate {
	readonly commit_sha: string;
	readonly context_id: string;
	readonly id: string;
	readonly initiated_by_user_id: string | null;
	readonly organization_id: string;
	readonly repository_id: string;
	readonly session_id: string;
	readonly session_source: string;
	readonly session_user_id: string;
	readonly refresh: boolean;
	readonly status: "queued" | "failed" | "partial" | "collecting" | "complete";
}

export interface GitHubEvidenceMaintenanceResult {
	readonly attempted: number;
	readonly failed: number;
	readonly hasExhaustedFailures: boolean;
	readonly hasMore: boolean;
	readonly succeeded: number;
}

export async function runGitHubEvidenceCollectionMaintenance(input: {
	readonly config: GitHubRepositoryAppConfig;
	readonly collectionIds?: readonly string[];
	readonly createInstallationToken?: CollectInput["createInstallationToken"];
	readonly database: postgres.Sql;
	readonly limit?: number;
	readonly now?: () => Date;
	readonly r2: R2EvidenceStorageClient;
	readonly signal?: AbortSignal;
	readonly sourceFactory?: CollectInput["sourceFactory"];
}): Promise<GitHubEvidenceMaintenanceResult> {
	const limit = input.limit ?? DEFAULT_BATCH_SIZE;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
		throw new Error(
			"GitHub evidence maintenance limit must be between 1 and 25.",
		);
	}
	const now = input.now ?? (() => new Date());
	const collectionIds = input.collectionIds ? [...input.collectionIds] : null;
	const agedRefreshes = await input.database.unsafe<Array<{ id: string }>>(
		`UPDATE github_evidence_collection SET refresh_due_at = NULL
		 WHERE id IN (SELECT id FROM github_evidence_collection
		  WHERE refresh_due_at IS NOT NULL AND observation_started_at <= $1::timestamptz - INTERVAL '14 days'
		  AND ${collectionIdentityScope("github_evidence_collection", 3)}
		  ORDER BY refresh_due_at LIMIT $2 FOR UPDATE SKIP LOCKED)
		 RETURNING id`,
		[now().toISOString(), limit, collectionIds],
	);
	await input.database.unsafe(
		`WITH expired AS (
		   SELECT id
		   FROM github_evidence_collection
		   WHERE status = 'collecting'
		     AND retry_count >= $1
		     AND lease_expires_at <= $2
		     AND ${collectionIdentityScope("github_evidence_collection", 4)}
		   ORDER BY lease_expires_at
		   LIMIT $3
		   FOR UPDATE SKIP LOCKED
		 )
		 UPDATE github_evidence_collection collection
		 SET status = 'failed',
		     error = 'Collection lease expired after the automatic retry limit.',
		     completed_at = $2,
		     lease_expires_at = NULL,
		     retry_after = NULL,
		     refresh_due_at = CASE WHEN session_user_id <> '' AND observation_started_at > $2::timestamptz - INTERVAL '14 days' THEN LEAST(refresh_due_at, $2::timestamptz + INTERVAL '1 day') ELSE NULL END,
		     updated_at = $2
		 FROM expired
		 WHERE collection.id = expired.id`,
		[MAX_AUTOMATIC_RETRIES, now().toISOString(), limit, collectionIds],
	);
	const candidates = await input.database.unsafe<
		GitHubEvidenceMaintenanceCandidate[]
	>(
		`SELECT candidate.id, candidate.organization_id, candidate.repository_id, candidate.initiated_by_user_id, candidate.session_id, candidate.session_source, candidate.session_user_id, candidate.context_id, candidate.commit_sha, candidate.status,
		 (candidate.refresh_due_at <= $1 AND candidate.status IN ('complete', 'partial', 'failed')) AS refresh
		 FROM github_evidence_collection candidate
		 WHERE ((candidate.retry_count < 2 AND (
		     (candidate.status IN ('queued', 'failed', 'partial') AND candidate.retry_after <= $1)
		     OR (candidate.status = 'collecting' AND candidate.lease_expires_at <= $1)
		   )) OR (candidate.status IN ('complete', 'partial', 'failed') AND candidate.refresh_due_at <= $1
		     AND candidate.session_user_id <> '' AND candidate.observation_started_at > $1::timestamptz - INTERVAL '14 days'))
		   AND ${collectionIdentityScope("candidate", 3)}
		   AND ${latestGitHubEvidenceAttempt("candidate")}
		 ORDER BY coalesce(candidate.retry_after, candidate.refresh_due_at, candidate.lease_expires_at), candidate.created_at
		 LIMIT $2`,
		[now().toISOString(), limit, collectionIds],
	);
	const exhaustedFailures = await input.database.unsafe<
		Array<{ present: boolean }>
	>(
		`SELECT EXISTS (
		   SELECT 1
		   FROM github_evidence_collection exhausted
		   WHERE exhausted.status = 'failed'
		     AND exhausted.retry_count >= $1
		     AND ${collectionIdentityScope("exhausted", 2)}
		     AND ${latestGitHubEvidenceAttempt("exhausted")}
		   LIMIT 1
		 ) AS present`,
		[MAX_AUTOMATIC_RETRIES, collectionIds],
	);

	let succeeded = 0;
	let failed = 0;
	for (const candidate of candidates) {
		try {
			input.signal?.throwIfAborted();
			await collectAndPersistGitHubCommitEvidence({
				commitSha: candidate.commit_sha,
				config: input.config,
				createInstallationToken: input.createInstallationToken,
				contextId: candidate.context_id || null,
				database: input.database,
				initiatedByUserId: candidate.initiated_by_user_id,
				organizationId: candidate.organization_id,
				now,
				refresh: candidate.refresh,
				refreshCollectionId: candidate.refresh ? candidate.id : undefined,
				repositoryId: candidate.repository_id,
				queuedCollectionId:
					candidate.status === "queued" ? candidate.id : undefined,
				retryCollectionId:
					candidate.status === "queued" || candidate.refresh
						? undefined
						: candidate.id,
				r2: input.r2,
				signal: input.signal,
				sessionId: candidate.session_id || null,
				sessionSource: candidate.session_source || null,
				sessionUserId: candidate.session_user_id || null,
				sourceFactory: input.sourceFactory,
			});
			succeeded += 1;
		} catch (error) {
			input.signal?.throwIfAborted();
			if (
				error instanceof Error &&
				error.message === "GitHub evidence retry is no longer eligible."
			) {
				continue;
			}
			if (
				error instanceof Error &&
				error.message === "GitHub repository binding was not found."
			) {
				await input.database.unsafe(
					"UPDATE github_evidence_collection SET retry_after = NULL, refresh_due_at = NULL, updated_at = $2 WHERE id = $1",
					[candidate.id, now().toISOString()],
				);
			}
			failed += 1;
		}
	}

	return {
		attempted: candidates.length,
		failed,
		hasExhaustedFailures: exhaustedFailures[0]?.present ?? false,
		hasMore: candidates.length === limit || agedRefreshes.length === limit,
		succeeded,
	};
}

export function latestGitHubEvidenceAttempt(alias: string): string {
	return `NOT EXISTS (
		SELECT 1 FROM github_evidence_collection newer
		WHERE newer.organization_id = ${alias}.organization_id
		  AND newer.repository_id = ${alias}.repository_id
		  AND newer.commit_sha = ${alias}.commit_sha
		  AND newer.session_id = ${alias}.session_id
		  AND newer.context_id = ${alias}.context_id
		  AND newer.attempt_number > ${alias}.attempt_number
	)`;
}

function collectionIdentityScope(alias: string, parameter: number): string {
	return `($${parameter}::text[] IS NULL OR
		(${alias}.organization_id, ${alias}.repository_id, ${alias}.commit_sha, ${alias}.session_id, ${alias}.context_id) IN (
			SELECT organization_id, repository_id, commit_sha, session_id, context_id
			FROM github_evidence_collection WHERE id = ANY($${parameter}::text[])
		))`;
}
