import type { RunIndexColumn } from "./run-index.js";

/**
 * Images of a session: the screenshots and pasted images its transcript
 * carried, as the CLI uploads them with the session's evidence captures.
 * Transcripts keep only a marker where an image was
 * (`opaline-image-omitted:v1;sha256=<hex>;bytes=<n>;type=<media type>`); the
 * bytes are the evidence object `sha256:<hex>`, stored once per workspace.
 * Without the schema toolkit, so the API's writer and reader import the
 * columns at runtime (`@rudel/ch-schema/session-images`).
 *
 * One row per session, image and transcript record that carries it
 * (`agent_id`, `record_idx`; 0 for an image a capture lists without a
 * record), whichever capture last saw it: a row that knows the image was
 * captured is never replaced by one that only knows it was skipped or not
 * uploaded (`version`).
 *
 * Kept until a deletion request, like the transcripts the images belong to.
 */

export const SESSION_IMAGES_TABLE = "rudel.session_images";

export const SESSION_IMAGES_KEY = [
	"organization_id",
	"user_id",
	"session_id",
	"session_source",
	"sha256",
	"agent_id",
	"record_idx",
];
export const SESSION_IMAGES_VERSION = "version";
export const SESSION_IMAGES_COMMENT =
	"Images of a session (screenshots, pasted images) as its evidence captures listed them: one row per session, image and transcript record, the most knowing capture's; the bytes are the evidence object sha256:<sha256>.";

/** Every column of `rudel.session_images`, in table order. */
export const SESSION_IMAGE_COLUMNS: readonly RunIndexColumn[] = [
	{
		name: "organization_id",
		type: "String",
		comment: "Owning workspace ID; tenant boundary.",
	},
	{ name: "user_id", type: "String", comment: "Session owner." },
	{
		name: "session_id",
		type: "String",
		comment: "Native session ID within organization and user.",
	},
	{
		name: "session_source",
		type: "LowCardinality(String)",
		comment: "Transcript source: claude_code or codex.",
	},
	{
		name: "sha256",
		type: "String",
		comment:
			"SHA-256 (hex) of the decoded image bytes, as the transcript marker names it; the evidence object is sha256:<sha256>.",
	},
	{
		name: "agent_id",
		type: "String",
		comment:
			"Transcript stream of the record that carries the image; empty for the main stream or no record.",
	},
	{
		name: "record_idx",
		type: "UInt32",
		comment:
			"1-based JSONL line of that record in its stream; 0 for an image the capture lists without a record.",
	},
	{
		name: "media_type",
		type: "LowCardinality(String)",
		comment:
			"Image media type (image/png, image/jpeg, ...); the uploaded object's when captured.",
	},
	{
		name: "bytes",
		type: "UInt64",
		comment:
			"Decoded image size in bytes; the uploaded object's when captured.",
	},
	{
		name: "image_source",
		type: "LowCardinality(String)",
		comment:
			"inline (base64 in the transcript record) or file (an image file the record names); empty without a record.",
	},
	{
		name: "root_id",
		type: "LowCardinality(String)",
		comment: "Capture root of a file image; empty otherwise.",
	},
	{
		name: "path",
		type: "String",
		comment: "Path of a file image, as the CLI names it; empty otherwise.",
	},
	{
		name: "status",
		type: "LowCardinality(String)",
		comment:
			"captured (the capture uploaded the image or found it stored), skipped (the CLI did not upload it: skipped_reason) or not_uploaded (named, not part of the capture's upload).",
	},
	{
		name: "skipped_reason",
		type: "LowCardinality(String)",
		comment:
			"Why the CLI skipped the image (its reason, e.g. too-large, unreadable); empty otherwise.",
	},
	{
		name: "capture_id",
		type: "String",
		comment: "Evidence capture (context id) that wrote the row.",
	},
	{
		name: "captured_at",
		type: "DateTime64(3, 'UTC')",
		comment: "When that capture completed on the member's machine.",
	},
	{
		name: "version",
		type: "UInt64",
		comment:
			"Replacing version: rank (3 captured, 2 skipped, 1 not_uploaded) * 2^48 + captured_at in ms, so a later capture replaces an earlier one unless it knows less.",
	},
	{
		name: "written_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"UTC millisecond time the API accepted the capture and staged the row.",
	},
];
