import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Images of a session: the screenshots and pasted images its transcript
 * carried. The transcript keeps a marker where each one was
 * (`opaline-image-omitted:v1;sha256=<hex>;bytes=<n>;type=<media type>`, see
 * `inline-image-marker.ts`); the CLI uploads the bytes with the session's
 * evidence captures. One image is found by the marker's sha256, and only
 * within a session whose captures name it.
 *
 * `captured`: the bytes are stored; `url` is a short-lived signed link to
 * them. `skipped`: the CLI saw the image and did not upload it
 * (`skippedReason`). `not_uploaded`: a capture names the image, none of the
 * session's uploads carried it. `not_captured`: no capture of the session
 * names it (an older CLI, or a session captured before the image existed).
 */

export const SESSION_IMAGE_STATUSES = [
	"captured",
	"skipped",
	"not_uploaded",
	"not_captured",
] as const;
export const SessionImageStatusSchema = z.enum(SESSION_IMAGE_STATUSES);
export type SessionImageStatus = z.infer<typeof SessionImageStatusSchema>;

/** References returned per image, in stream and record order. */
export const SESSION_IMAGE_MAX_REFERENCES = 256;
/** How long a signed image link stays valid. */
export const SESSION_IMAGE_URL_TTL_SECONDS = 300;

export const SessionImageInputSchema = z.object({
	sessionId: z.string().min(1).max(200),
	/** The marker's sha256 (hex of the decoded image bytes). */
	sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type SessionImageInput = z.infer<typeof SessionImageInputSchema>;

export const SessionImageReferenceSchema = z.object({
	/** Transcript stream of the record; null for the main stream. */
	agentId: z.string().nullable(),
	/** 1-based JSONL line of the record in its stream. */
	recordIndex: z.number().int().positive(),
	/** `inline`: base64 in the record; `file`: an image file the record names. */
	source: z.enum(["inline", "file"]).nullable(),
	path: z.string().nullable(),
	rootId: z.string().nullable(),
});
export type SessionImageReference = z.infer<typeof SessionImageReferenceSchema>;

export const SessionImageSchema = z.object({
	status: SessionImageStatusSchema,
	sha256: z.string(),
	mediaType: z.string().nullable(),
	/** Decoded image size. */
	bytes: z.number().int().nonnegative().nullable(),
	skippedReason: z.string().nullable(),
	/** When the capture that knows most about the image completed. */
	capturedAt: z.string().nullable(),
	/** The records that carry the image, up to `SESSION_IMAGE_MAX_REFERENCES`. */
	references: z.array(SessionImageReferenceSchema),
	/** Records left out of `references`. */
	referencesMore: z.number().int().nonnegative(),
	/** Signed link to the image bytes (captured only), valid until `urlExpiresAt`. */
	url: z.string().url().optional(),
	urlExpiresAt: z.string().optional(),
	/** Why a captured image came back without `url`. */
	urlUnavailable: z
		.enum(["blob-unavailable", "storage-unavailable"])
		.optional(),
});
export type SessionImage = z.infer<typeof SessionImageSchema>;

export const sessionImagesContract = {
	/** One image of a session the caller may read. */
	get: oc.input(SessionImageInputSchema).output(SessionImageSchema),
};
