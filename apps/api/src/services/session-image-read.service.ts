import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getLogger } from "@logtape/logtape";
import {
	SESSION_IMAGE_MAX_REFERENCES,
	SESSION_IMAGE_URL_TTL_SECONDS,
	type SessionImage,
	type SessionImageInput,
	type SessionImageReference,
} from "@rudel/api-routes/session-images";
import { SESSION_IMAGES_TABLE } from "@rudel/ch-schema/session-images";
import type postgres from "postgres";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { createLocalObjectStoreClient } from "./local-object-store.js";
import {
	createObjectStoreS3Client,
	type R2IngestConfiguration,
} from "./r2-ingest-storage.service.js";

const logger = getLogger(["rudel", "api", "session-images"]);

/**
 * Raster types a browser renders without running anything; any other image
 * type (SVG can carry script) is served as a download of opaque bytes.
 */
const INLINE_MEDIA_TYPES: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/bmp": "bmp",
};

interface SessionImageSummaryRow {
	readonly rows: number | string;
	readonly status: string;
	readonly skipped_reason: string;
	readonly media_type: string;
	readonly bytes: string;
	readonly captured_at: string;
	readonly reference_count: number | string;
	readonly refs: ReadonlyArray<
		readonly [string, number | string, string, string, string]
	>;
}

export interface SignImageUrlInput {
	readonly objectKey: string;
	readonly contentType: string;
	readonly contentDisposition: string;
	readonly expiresInSeconds: number;
}

export interface SessionImageReadDependencies {
	readonly clickhouse: ClickHouseExecutor;
	readonly database: postgres.Sql;
	/** Signs a GET of an evidence object, or null when the store is not configured. */
	readonly signUrl: () =>
		| ((input: SignImageUrlInput) => Promise<string>)
		| null;
	readonly now?: () => Date;
	readonly signal?: AbortSignal;
}

const STATUSES = new Set(["captured", "skipped", "not_uploaded"]);

/**
 * One image of a session whose owner the caller may read (the caller
 * checks). Only an image the session's own captures name is found, so a
 * sha256 seen elsewhere reads `not_captured` here; a captured one comes with
 * a short-lived signed link to its bytes. The row that knows most wins
 * (`version`: captured over skipped over not uploaded, then the latest).
 */
export async function readSessionImage(
	input: SessionImageInput & {
		readonly organizationId: string;
		readonly ownerId: string;
	},
	deps: SessionImageReadDependencies,
): Promise<SessionImage> {
	const [summary] = await deps.clickhouse.query<SessionImageSummaryRow>({
		query: `SELECT count() AS rows,
				argMax(status, version) AS status,
				argMax(skipped_reason, version) AS skipped_reason,
				argMax(media_type, version) AS media_type,
				toString(argMax(bytes, version)) AS bytes,
				toString(argMax(captured_at, version)) AS captured_at,
				countIf(record_idx > 0) AS reference_count,
				arraySlice(
					arraySort(groupArrayIf((agent_id, record_idx, image_source, root_id, path), record_idx > 0)),
					1, {maxReferences:UInt32}
				) AS refs
			FROM ${getSafeClickHouseTable(SESSION_IMAGES_TABLE)} FINAL
			WHERE organization_id = {organizationId:String}
				AND user_id = {ownerId:String}
				AND session_id = {sessionId:String}
				AND sha256 = {sha256:String}`,
		query_params: {
			organizationId: input.organizationId,
			ownerId: input.ownerId,
			sessionId: input.sessionId,
			sha256: input.sha256,
			maxReferences: SESSION_IMAGE_MAX_REFERENCES,
		},
		clickhouse_settings: { max_execution_time: 10 },
		abortSignal: deps.signal,
	});
	if (!summary || Number(summary.rows) === 0 || !STATUSES.has(summary.status))
		return notCaptured(input.sha256);

	const references: SessionImageReference[] = summary.refs.map(
		([agentId, recordIndex, source, rootId, path]) => ({
			agentId: agentId || null,
			recordIndex: Number(recordIndex),
			source: source === "inline" || source === "file" ? source : null,
			path: path || null,
			rootId: rootId || null,
		}),
	);
	const image: SessionImage = {
		status: summary.status as SessionImage["status"],
		sha256: input.sha256,
		mediaType: summary.media_type || null,
		bytes: Number(summary.bytes) || null,
		skippedReason: summary.skipped_reason || null,
		capturedAt: `${summary.captured_at.replace(" ", "T")}Z`,
		references,
		referencesMore: Math.max(
			0,
			Number(summary.reference_count) - references.length,
		),
	};
	if (image.status !== "captured") return image;
	return { ...image, ...(await signImage(input, image, deps)) };
}

async function signImage(
	input: { readonly organizationId: string; readonly sha256: string },
	image: SessionImage,
	deps: SessionImageReadDependencies,
): Promise<Pick<SessionImage, "url" | "urlExpiresAt" | "urlUnavailable">> {
	// Objects are stored once per workspace, so an image another capture
	// uploaded first is the same object.
	const [object] = await deps.database.unsafe<
		Array<{ objectKey: string; mediaType: string }>
	>(
		`SELECT object_key AS "objectKey", media_type AS "mediaType"
		 FROM repository_evidence_object
		 WHERE organization_id = $1 AND object_id = $2 AND status = 'available'
		 LIMIT 1`,
		[input.organizationId, `sha256:${input.sha256}`],
	);
	if (!object) return { urlUnavailable: "blob-unavailable" };
	const sign = deps.signUrl();
	if (!sign) return { urlUnavailable: "storage-unavailable" };
	const mediaType = image.mediaType ?? object.mediaType;
	const extension = INLINE_MEDIA_TYPES[mediaType];
	const name = `${input.sha256.slice(0, 12)}.${extension ?? "bin"}`;
	const expiresAt = new Date(
		(deps.now?.() ?? new Date()).getTime() +
			SESSION_IMAGE_URL_TTL_SECONDS * 1000,
	);
	try {
		const url = await sign({
			objectKey: object.objectKey,
			contentType: extension ? mediaType : "application/octet-stream",
			contentDisposition: `${extension ? "inline" : "attachment"}; filename="${name}"`,
			expiresInSeconds: SESSION_IMAGE_URL_TTL_SECONDS,
		});
		return { url, urlExpiresAt: expiresAt.toISOString() };
	} catch (error) {
		logger.warn("Session image link could not be signed: {error}", {
			error: String(error),
		});
		return { urlUnavailable: "storage-unavailable" };
	}
}

function notCaptured(sha256: string): SessionImage {
	return {
		status: "not_captured",
		sha256,
		mediaType: null,
		bytes: null,
		skippedReason: null,
		capturedAt: null,
		references: [],
		referencesMore: 0,
	};
}

/**
 * Presigned GETs of evidence objects, with the response type and disposition
 * pinned by the signature. Signing is local (no request to R2).
 */
export function createR2ImageUrlSigner(
	configuration: R2IngestConfiguration,
): (input: SignImageUrlInput) => Promise<string> {
	if (configuration.backend === "local") {
		const store = createLocalObjectStoreClient(configuration);
		return async (input) =>
			store.signDownload({
				cacheControl: "private, max-age=300",
				contentDisposition: input.contentDisposition,
				contentType: input.contentType,
				expiresInSeconds: input.expiresInSeconds,
				objectKey: input.objectKey,
			});
	}
	const client = createObjectStoreS3Client(configuration);
	return (input) =>
		getSignedUrl(
			client,
			new GetObjectCommand({
				Bucket: configuration.bucket,
				Key: input.objectKey,
				ResponseCacheControl: "private, max-age=300",
				ResponseContentDisposition: input.contentDisposition,
				ResponseContentType: input.contentType,
			}),
			{ expiresIn: input.expiresInSeconds },
		);
}
