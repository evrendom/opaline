import {
	REPOSITORY_EVIDENCE_IMAGE_MEDIA_TYPE_PATTERN,
	type RepositoryEvidenceInitInput,
} from "@rudel/api-routes";
import {
	type RudelSessionImagesRow,
	RudelSessionImagesRowSchema,
} from "@rudel/ch-schema/generated";
import { SESSION_IMAGES_TABLE } from "@rudel/ch-schema/session-images";
import { z } from "zod";
import type { ClickHouseExecutor } from "../clickhouse.js";

/**
 * Images of a session: the screenshots and pasted images its transcript
 * carried. The transcript keeps a marker where each image was
 * (`opaline-image-omitted:v1;sha256=<hex>;bytes=<n>;type=<media type>`); the
 * CLI uploads the bytes as `image` evidence objects (`sha256:<hex>`, raw,
 * stored once per workspace) and lists every image with the records that
 * carry it in the manifest's `images` (in `localContext`, like the saved
 * output references, or at the top level):
 *
 * `{ references: [{ sha256, mediaType, bytes, source: "inline" | "file",
 * path?, rootId?, agentId, recordIndex }], omitted, skipped: [{ sha256,
 * reason }] }`
 *
 * The commit turns the verified manifest into one row per image and record,
 * staged in Postgres with the capture and published to `rudel.session_images`
 * with its index row. An image is `captured` when this capture's upload
 * declares it (its bytes are verified against the digest at commit, or were
 * stored before), `skipped` when the CLI says why it did not upload it, and
 * `not_uploaded` otherwise (an earlier capture may have carried it; the read
 * takes the session's best row). Old CLIs send no `images` and produce no
 * rows, and anything malformed is left out: a capture never fails over its
 * images.
 */

/** References read per capture; the rest are ignored. */
export const MAX_IMAGE_REFERENCES = 2_048;
/** Skipped images read per capture. */
export const MAX_SKIPPED_IMAGES = 512;

export type SessionImageRow = RudelSessionImagesRow;
export type SessionImageStatus = "captured" | "skipped" | "not_uploaded";

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/u);
const MEDIA_TYPE = z
	.string()
	.regex(REPOSITORY_EVIDENCE_IMAGE_MEDIA_TYPE_PATTERN);
const BYTES = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const IDENTIFIER = z.string().min(1).max(256);
const RECORD_INDEX = z.number().int().positive().max(0xffff_ffff);
// A file image's path as the CLI names it, without control characters.
const PATH = z
	.string()
	.min(1)
	.max(1_024)
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejects them
	.refine((path) => !/[\u0000-\u001f\u007f]/u.test(path));
const REFERENCE = z.object({
	sha256: SHA256,
	mediaType: MEDIA_TYPE,
	bytes: BYTES,
	source: z.enum(["inline", "file"]),
	path: PATH.optional(),
	rootId: IDENTIFIER.optional(),
	agentId: IDENTIFIER.nullable(),
	recordIndex: RECORD_INDEX.nullable(),
});
type Reference = z.infer<typeof REFERENCE>;
const SKIPPED = z.object({
	sha256: SHA256,
	reason: z.string().regex(/^[a-z0-9-]{1,64}$/u),
});
type Skipped = z.infer<typeof SKIPPED>;

/** Rank of what a row knows; a later capture replaces a row only at the same rank or above. */
const STATUS_RANK: Readonly<Record<SessionImageStatus, bigint>> = {
	captured: 3n,
	skipped: 2n,
	not_uploaded: 1n,
};
const RANK_SHIFT = 2n ** 48n;

export interface SessionImageCapture {
	readonly organizationId: string;
	readonly userId: string;
	readonly input: Pick<
		RepositoryEvidenceInitInput,
		"capture" | "objects" | "session"
	>;
	readonly manifest: unknown;
	readonly stagedAt: Date;
}

/**
 * The capture's image rows, or an empty list when its manifest names none
 * and its upload carries none. Pure; never throws on manifest content.
 */
export function extractSessionImages(
	capture: SessionImageCapture,
): SessionImageRow[] {
	const capturedAt = new Date(capture.input.capture.timing.captureCompletedAt);
	if (!Number.isFinite(capturedAt.getTime())) return [];
	const manifest = asRecord(capture.manifest);
	const images =
		asRecord(asRecord(manifest?.localContext)?.images) ??
		asRecord(manifest?.images);
	const references = readList(
		images?.references,
		REFERENCE,
		MAX_IMAGE_REFERENCES,
	);
	const skipped = new Map<string, Skipped>();
	for (const item of readList(images?.skipped, SKIPPED, MAX_SKIPPED_IMAGES))
		if (!skipped.has(item.sha256)) skipped.set(item.sha256, item);
	// What this capture's upload declares, verified at commit.
	const uploaded = new Map<string, { mediaType: string; bytes: number }>();
	for (const object of capture.input.objects) {
		if (object.kind !== "image") continue;
		uploaded.set(object.sha256, {
			mediaType: object.mediaType,
			bytes: object.byteLength,
		});
	}
	if (references.length === 0 && skipped.size === 0 && uploaded.size === 0)
		return [];

	const base = {
		organization_id: capture.organizationId,
		user_id: capture.userId,
		session_id: capture.input.session.sessionId,
		session_source: capture.input.session.source,
		capture_id: capture.input.capture.contextId,
		captured_at: formatDateTime(capturedAt),
		written_at: formatDateTime(capture.stagedAt),
	};
	const describe = (sha256: string, reference: Reference | undefined) => {
		const object = uploaded.get(sha256);
		const skip = skipped.get(sha256);
		const status: SessionImageStatus = object
			? "captured"
			: skip
				? "skipped"
				: "not_uploaded";
		return {
			status,
			skipped_reason: status === "skipped" ? (skip?.reason ?? "") : "",
			media_type: object?.mediaType ?? reference?.mediaType ?? "",
			bytes: String(object?.bytes ?? reference?.bytes ?? 0),
			version: String(
				STATUS_RANK[status] * RANK_SHIFT + BigInt(capturedAt.getTime()),
			),
		};
	};
	const rows = new Map<string, SessionImageRow>();
	for (const reference of references) {
		const agentId = reference.agentId ?? "";
		const recordIdx = reference.recordIndex ?? 0;
		const key = `${reference.sha256}\0${agentId}\0${recordIdx}`;
		// The first reference of an image in a record describes it.
		if (rows.has(key)) continue;
		const file = reference.source === "file";
		rows.set(key, {
			...base,
			sha256: reference.sha256,
			agent_id: agentId,
			record_idx: recordIdx,
			image_source: reference.source,
			root_id: file ? (reference.rootId ?? "") : "",
			path: file ? (reference.path ?? "") : "",
			...describe(reference.sha256, reference),
		});
	}
	// Images the capture holds or skipped without naming their record.
	const named = new Set(references.map((reference) => reference.sha256));
	for (const sha256 of new Set([...uploaded.keys(), ...skipped.keys()])) {
		if (named.has(sha256)) continue;
		rows.set(`${sha256}\0\0`, {
			...base,
			sha256,
			agent_id: "",
			record_idx: 0,
			image_source: "",
			root_id: "",
			path: "",
			...describe(sha256, undefined),
		});
	}
	return [...rows.values()];
}

/** Staged rows as published; a row that no longer parses is left out. */
export function parseStagedSessionImages(value: unknown): {
	readonly rows: SessionImageRow[];
	readonly invalid: number;
} {
	if (!Array.isArray(value))
		return { rows: [], invalid: value == null ? 0 : 1 };
	const rows: SessionImageRow[] = [];
	let invalid = 0;
	for (const item of value) {
		const parsed = RudelSessionImagesRowSchema.safeParse(item);
		if (parsed.success) rows.push(parsed.data);
		else invalid += 1;
	}
	return { rows, invalid };
}

export async function persistSessionImageRows(input: {
	readonly clickhouse: ClickHouseExecutor;
	readonly rows: readonly SessionImageRow[];
	readonly signal?: AbortSignal;
}): Promise<void> {
	if (input.rows.length === 0) return;
	await input.clickhouse.insert({
		table: SESSION_IMAGES_TABLE,
		values: [...input.rows],
		abortSignal: input.signal,
	});
}

function readList<T>(value: unknown, schema: z.ZodType<T>, limit: number): T[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, limit).flatMap((item) => {
		const parsed = schema.safeParse(item);
		return parsed.success ? [parsed.data] : [];
	});
}

function formatDateTime(value: Date): string {
	return value.toISOString().replace("T", " ").replace("Z", "");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}
