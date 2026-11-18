import type { RudelSessionImagesRow } from "@rudel/ch-schema/generated";
import type postgres from "postgres";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import type { R2EvidenceStorageClient } from "../../services/r2-ingest-storage.service.js";
import { createEvidenceObjectKey } from "../../services/repository-evidence.service.js";
import { persistSessionImageRows } from "../../services/session-images.service.js";
import type { CollectedImage } from "./transcript-file/index.js";

const CAPTURED_RANK = 3n;
const RANK_SHIFT = 2n ** 48n;

export interface SessionImageTarget {
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
	readonly source: "claude_code" | "codex";
}

export interface ImageCaptureResult {
	readonly images: number;
	readonly stored: number;
	readonly bytesStored: number;
}

function clickHouseTime(value: Date): string {
	return value.toISOString().replace("T", " ").replace("Z", "");
}

export async function storeSessionImages(input: {
	readonly target: SessionImageTarget;
	readonly images: readonly CollectedImage[];
	readonly sql: postgres.Sql;
	readonly clickhouse: ClickHouseExecutor;
	readonly store: R2EvidenceStorageClient;
	readonly captureId: string;
	readonly now: Date;
}): Promise<ImageCaptureResult> {
	const { target } = input;
	const rows = new Map<string, RudelSessionImagesRow>();
	for (const image of input.images)
		for (const [agentId, recordIdx] of image.references) {
			const key = `${image.sha256}\u0000${agentId}\u0000${recordIdx}`;
			if (rows.has(key)) continue;
			rows.set(key, {
				organization_id: target.organizationId,
				user_id: target.userId,
				session_id: target.sessionId,
				session_source: target.source,
				sha256: image.sha256,
				agent_id: agentId,
				record_idx: recordIdx,
				media_type: image.mediaType,
				bytes: String(image.bytes.byteLength),
				image_source: "inline",
				root_id: "",
				path: "",
				status: "captured",
				skipped_reason: "",
				capture_id: input.captureId,
				captured_at: clickHouseTime(input.now),
				version: String(
					CAPTURED_RANK * RANK_SHIFT + BigInt(input.now.getTime()),
				),
				written_at: clickHouseTime(input.now),
			});
		}
	if (rows.size === 0) return { images: 0, stored: 0, bytesStored: 0 };
	const objectIds = input.images.map((image) => `sha256:${image.sha256}`);
	const known = new Set(
		(
			await input.sql.unsafe<{ objectId: string }[]>(
				`SELECT object_id AS "objectId" FROM repository_evidence_object
				WHERE organization_id = $1 AND object_id = ANY($2::text[]) AND status = 'available'`,
				[target.organizationId, objectIds],
			)
		).map((row) => row.objectId),
	);
	let stored = 0;
	let bytesStored = 0;
	for (const image of input.images) {
		const objectId = `sha256:${image.sha256}`;
		if (known.has(objectId)) continue;
		const objectKey = createEvidenceObjectKey(target.organizationId, objectId);
		await input.store.putObject({
			body: image.bytes,
			contentType: image.mediaType,
			metadata: { "opaline-sha256": image.sha256 },
			objectKey,
		});
		const inserted = await input.sql.unsafe<{ objectId: string }[]>(
			`INSERT INTO repository_evidence_object (
				organization_id, object_id, object_key, kind, byte_length, media_type,
				content_encoding, filter_version, status, available_at, updated_at
			) VALUES ($1, $2, $3, 'image', $4, $5, 'identity', NULL, 'available', $6::timestamptz, $6::timestamptz)
			ON CONFLICT (organization_id, object_id) DO UPDATE SET
				object_key = EXCLUDED.object_key, byte_length = EXCLUDED.byte_length,
				media_type = EXCLUDED.media_type, status = 'available',
				available_at = EXCLUDED.available_at, updated_at = EXCLUDED.updated_at
			WHERE repository_evidence_object.status <> 'available'
			RETURNING object_id AS "objectId"`,
			[
				target.organizationId,
				objectId,
				objectKey,
				image.bytes.byteLength,
				image.mediaType,
				input.now.toISOString(),
			],
		);
		if (inserted.length > 0) {
			stored += 1;
			bytesStored += image.bytes.byteLength;
		}
	}
	await persistSessionImageRows({
		clickhouse: input.clickhouse,
		rows: [...rows.values()],
	});
	return { images: rows.size, stored, bytesStored };
}
