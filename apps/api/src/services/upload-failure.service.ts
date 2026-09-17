import { createHash } from "node:crypto";
import { type UploadFailure, UploadFailureSchema } from "@rudel/api-routes";
import { filterKnownSecrets } from "@rudel/secret-filter";
import type postgres from "postgres";
import { sqlClient } from "../db.js";

export async function reportUploadFailures(
	organizationId: string,
	userId: string,
	failures: UploadFailure[],
	database: postgres.Sql = sqlClient,
) {
	const rows = failures.map((failure) => {
		const sanitized = UploadFailureSchema.parse(
			JSON.parse(filterKnownSecrets(JSON.stringify(failure)).text),
		);
		return {
			id: `cli-failure:${createHash("sha256")
				.update(
					JSON.stringify([
						organizationId,
						userId,
						failure.source,
						failure.sessionId,
					]),
				)
				.digest("hex")}`,
			session_id: failure.sessionId,
			source: failure.source,
			metadata: sanitized,
		};
	});
	// Reuse terminal ingest jobs. There are no R2 objects to materialize/clean up;
	// actual bytes live in diagnostics, outside the accepted-payload size limit.
	await database.unsafe(
		`
		INSERT INTO ingest_job (id, organization_id, user_id, session_id, source,
			status, object_manifest, expected_sizes, expected_total_bytes, client_hashes,
			ingest_metadata, last_error_code, last_error_message, failed_at, objects_deleted_at)
		SELECT DISTINCT ON (id) id, $1, $2, session_id, source, 'failed', '[]', '{}', 0, '{}',
			metadata, 'CLI_UPLOAD_FAILED', metadata->>'error', NOW(), NOW()
		FROM jsonb_to_recordset($3::jsonb) AS report(id text, session_id text, source text, metadata jsonb)
		ON CONFLICT (id) DO UPDATE SET ingest_metadata = EXCLUDED.ingest_metadata,
			last_error_message = EXCLUDED.last_error_message, failed_at = NOW(), updated_at = NOW()
	`,
		[organizationId, userId, JSON.stringify(rows)],
	);
}

export async function listUploadFailures(
	organizationId: string,
	userId: string | null,
	page: { offset: number; limit: number },
	database: postgres.Sql = sqlClient,
) {
	const rows = await database.unsafe<
		Array<{
			id: string;
			userId: string;
			sessionId: string;
			source: string;
			metadata: unknown;
			totalBytes: number;
			error: string;
			failedAt: Date | string;
			attempts: number;
		}>
	>(
		`
		SELECT * FROM (
			SELECT DISTINCT ON (j.user_id, j.source, j.session_id)
				j.id, j.user_id AS "userId", j.session_id AS "sessionId", j.source,
				j.ingest_metadata AS metadata, j.expected_total_bytes AS "totalBytes",
				j.last_error_message AS error, j.failed_at AS "failedAt", j.attempts
			FROM ingest_job j
			WHERE j.organization_id = $1 AND ($2::text IS NULL OR j.user_id = $2)
				AND j.status = 'failed'
				AND NOT EXISTS (
					SELECT 1 FROM session_ownership s
					WHERE s.organization_id = j.organization_id AND s.session_id = j.session_id
						AND s.user_id = j.user_id AND s.last_ingested_at >= j.failed_at
				)
			ORDER BY j.user_id, j.source, j.session_id, j.failed_at DESC, j.id
		) latest ORDER BY "failedAt" DESC, id LIMIT $3 OFFSET $4
	`,
		[organizationId, userId, page.limit + 1, page.offset],
	);
	return {
		hasMore: rows.length > page.limit,
		failures: rows.slice(0, page.limit).map((row) => {
			const metadata =
				typeof row.metadata === "object" && row.metadata !== null
					? row.metadata
					: {};
			const failure = UploadFailureSchema.parse({
				repository: "",
				projectPath: "",
				sessionDate: null,
				totalBytes: row.totalBytes,
				uploadedBytes: null,
				stage: "processing",
				retryable: true,
				attempts: row.attempts,
				...metadata,
				sessionId: row.sessionId,
				source: row.source,
				error: row.error.slice(0, 4000),
			});
			return {
				...failure,
				id: row.id,
				userId: row.userId,
				failedAt: new Date(row.failedAt).toISOString(),
			};
		}),
	};
}
