import { createHash } from "node:crypto";
import type postgres from "postgres";
import { readRepositoryEvidenceSetup } from "./repository-evidence-setup.js";

/**
 * Re-reads the manifests of captures indexed before the setup columns
 * existed (`backfill:evidence-setup`), adds their setup to each capture's
 * prepared index row with a newer index version, and leaves publishing to
 * the evidence index publisher (`runRepositoryEvidenceIndexPublisherPass`):
 * the replacing index keeps the newer row of each capture.
 *
 * Only captures whose row is still held (`index_row IS NOT NULL`) are
 * touched, so a capture a purge or deletion cleared is never re-published.
 */

export interface EvidenceSetupBackfillResult {
	readonly scanned: number;
	readonly updated: number;
	readonly failed: readonly { contextId: string; error: string }[];
	/** The last capture read, to pass back as `after`. */
	readonly next: string | null;
}

interface PendingCapture {
	readonly organizationId: string;
	readonly contextId: string;
	readonly createdAt: string;
	readonly manifestObjectId: string;
	readonly objectKey: string | null;
}

/** The setup fields of a prepared index row, read from its stored manifest. */
export function evidenceSetupIndexPatch(input: {
	readonly manifestObjectId: string;
	readonly manifestBytes: Uint8Array;
	readonly indexedAt: Date;
}): Record<string, unknown> {
	const digest = createHash("sha256").update(input.manifestBytes).digest("hex");
	if (input.manifestObjectId !== `sha256:${digest}`)
		throw new Error("Stored manifest does not match its object id");
	const manifest: unknown = JSON.parse(
		new TextDecoder().decode(input.manifestBytes),
	);
	return {
		...readRepositoryEvidenceSetup(manifest),
		index_version: String(input.indexedAt.getTime()),
		indexed_at: input.indexedAt
			.toISOString()
			.replace("T", " ")
			.replace("Z", ""),
	};
}

export async function backfillEvidenceSetup(input: {
	readonly database: postgres.Sql;
	readonly getObject: (objectKey: string) => Promise<Uint8Array>;
	readonly organizationId: string | undefined;
	readonly maxCaptures: number;
	readonly after: string | undefined;
	readonly execute: boolean;
	readonly now?: () => Date;
}): Promise<EvidenceSetupBackfillResult> {
	const captures = await input.database.unsafe<PendingCapture[]>(
		`SELECT c.organization_id AS "organizationId", c.context_id AS "contextId",
			c.created_at::text AS "createdAt", c.manifest_object_id AS "manifestObjectId",
			o.object_key AS "objectKey"
		 FROM repository_evidence_capture c
		 LEFT JOIN repository_evidence_object o
			ON o.organization_id = c.organization_id
			AND o.object_id = c.manifest_object_id AND o.status = 'available'
		 WHERE c.index_row IS NOT NULL
			AND coalesce(jsonb_array_length(c.index_row->'context_roots'), 0) = 0
			AND ($1::text IS NULL OR c.organization_id = $1)
			AND ($2::text IS NULL OR (c.created_at, c.organization_id, c.context_id)
				> (split_part($2, '|', 1)::timestamptz, split_part($2, '|', 2), split_part($2, '|', 3)))
		 ORDER BY c.created_at, c.organization_id, c.context_id
		 LIMIT $3`,
		[input.organizationId ?? null, input.after ?? null, input.maxCaptures],
	);
	const last = captures.at(-1);
	const next =
		last && captures.length === input.maxCaptures
			? `${last.createdAt}|${last.organizationId}|${last.contextId}`
			: null;
	if (!input.execute)
		return { scanned: captures.length, updated: 0, failed: [], next };
	let updated = 0;
	const failed: { contextId: string; error: string }[] = [];
	for (const capture of captures) {
		try {
			if (capture.objectKey === null)
				throw new Error("Manifest object is not available");
			const patch = evidenceSetupIndexPatch({
				manifestObjectId: capture.manifestObjectId,
				manifestBytes: await input.getObject(capture.objectKey),
				indexedAt: (input.now ?? (() => new Date()))(),
			});
			const result = await input.database.unsafe(
				`UPDATE repository_evidence_capture
				 SET index_row = index_row || $3::jsonb,
					index_published_at = NULL, index_next_attempt_at = NOW()
				 WHERE organization_id = $1 AND context_id = $2 AND index_row IS NOT NULL`,
				[capture.organizationId, capture.contextId, JSON.stringify(patch)],
			);
			updated += result.count;
		} catch (error) {
			failed.push({ contextId: capture.contextId, error: String(error) });
		}
	}
	return { scanned: captures.length, updated, failed, next };
}
