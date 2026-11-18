import { describe, expect, test } from "bun:test";
import { RudelSessionImagesRowSchema } from "@rudel/ch-schema/generated";
import {
	extractSessionImages,
	MAX_IMAGE_REFERENCES,
	parseStagedSessionImages,
	type SessionImageCapture,
	type SessionImageRow,
} from "./session-images.service.js";

const CAPTURE_ID = "4f0f0e3e-6c1b-4a5e-9d55-2f3a3f8f0c11";
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const RANK = 2n ** 48n;
const CAPTURED_MS = BigInt(Date.parse("2026-10-16T10:00:00.000Z"));

function reference(
	sha256: string,
	recordIndex: number | null,
	extra: Record<string, unknown> = {},
) {
	return {
		sha256,
		mediaType: "image/png",
		bytes: 2_048,
		source: "inline",
		agentId: null,
		recordIndex,
		...extra,
	};
}

function image(sha256: string, byteLength = 4_096, mediaType = "image/png") {
	return {
		byteLength,
		contentEncoding: "identity" as const,
		filterVersion: null,
		kind: "image" as const,
		mediaType,
		objectId: `sha256:${sha256}`,
		sha256,
	};
}

function capture(
	images: unknown,
	options: {
		readonly objects?: ReturnType<typeof image>[];
		readonly topLevel?: boolean;
		readonly completedAt?: string;
	} = {},
): SessionImageCapture {
	const manifest: Record<string, unknown> = {
		contextIndex: { facets: [], skills: [] },
	};
	if (images !== undefined) {
		if (options.topLevel) manifest.images = images;
		else manifest.localContext = { entries: [], images };
	}
	return {
		organizationId: "org_1",
		userId: "user_1",
		stagedAt: new Date("2026-10-16T10:00:05.000Z"),
		manifest,
		input: {
			capture: {
				baseGitCommit: null,
				contextId: CAPTURE_ID,
				headGitCommit: null,
				parentContextId: null,
				timing: {
					captureCompletedAt: options.completedAt ?? "2026-10-16T10:00:00.000Z",
					captureStartedAt: "2026-10-16T09:59:59.000Z",
					firstActionAt: null,
					firstActionBasis: "unavailable",
					firstActionRelationship: "unknown",
					lifecycle: "end",
				},
				transcriptWatermark: null,
			},
			objects: options.objects ?? [],
			session: {
				agentId: null,
				parentAgentId: null,
				runId: "run",
				segmentId: "segment",
				sessionId: "session_1",
				source: "claude_code",
			},
		},
	};
}

function byKey(rows: readonly SessionImageRow[]) {
	return new Map(
		rows.map((row) => [
			`${row.sha256.slice(0, 1)}:${row.agent_id}:${row.record_idx}`,
			row,
		]),
	);
}

describe("extractSessionImages", () => {
	test("one row per image and record, captured when the upload declares it", () => {
		const rows = extractSessionImages(
			capture(
				{
					references: [
						reference(A, 4),
						reference(A, 9, { agentId: "agent-1" }),
						reference(B, 5, {
							source: "file",
							path: "screenshots/shot.png",
							rootId: "codex-images",
							mediaType: "image/jpeg",
						}),
					],
					omitted: 0,
					skipped: [],
				},
				{ objects: [image(A, 4_096, "image/webp")] },
			),
		);
		for (const row of rows)
			expect(RudelSessionImagesRowSchema.parse(row)).toEqual(row);
		const keyed = byKey(rows);
		expect(keyed.size).toBe(3);
		expect(keyed.get("a::4")).toEqual({
			organization_id: "org_1",
			user_id: "user_1",
			session_id: "session_1",
			session_source: "claude_code",
			sha256: A,
			agent_id: "",
			record_idx: 4,
			// The verified upload's type and size win over the reference's.
			media_type: "image/webp",
			bytes: "4096",
			image_source: "inline",
			root_id: "",
			path: "",
			status: "captured",
			skipped_reason: "",
			capture_id: CAPTURE_ID,
			captured_at: "2026-10-16 10:00:00.000",
			version: String(3n * RANK + CAPTURED_MS),
			written_at: "2026-10-16 10:00:05.000",
		});
		expect(keyed.get("a:agent-1:9")?.status).toBe("captured");
		expect(keyed.get("b::5")).toMatchObject({
			status: "not_uploaded",
			media_type: "image/jpeg",
			bytes: "2048",
			image_source: "file",
			root_id: "codex-images",
			path: "screenshots/shot.png",
			version: String(1n * RANK + CAPTURED_MS),
		});
	});

	test("a skipped image keeps the CLI's reason, on its records or on its own", () => {
		const rows = extractSessionImages(
			capture({
				references: [reference(A, 2)],
				omitted: 0,
				skipped: [
					{ sha256: A, reason: "too-large" },
					{ sha256: C, reason: "unreadable" },
					{ sha256: C, reason: "duplicate-entry" },
				],
			}),
		);
		const keyed = byKey(rows);
		expect(keyed.get("a::2")).toMatchObject({
			status: "skipped",
			skipped_reason: "too-large",
			version: String(2n * RANK + CAPTURED_MS),
		});
		expect(keyed.get("c::0")).toMatchObject({
			status: "skipped",
			skipped_reason: "unreadable",
			image_source: "",
			media_type: "",
			bytes: "0",
		});
		expect(rows).toHaveLength(2);
	});

	test("an uploaded image no reference names still gets a row", () => {
		const rows = extractSessionImages(
			capture(
				{ references: [], omitted: 0, skipped: [] },
				{ objects: [image(B)] },
			),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			sha256: B,
			record_idx: 0,
			status: "captured",
			media_type: "image/png",
			bytes: "4096",
		});
	});

	test("reads images at the manifest's top level too", () => {
		const rows = extractSessionImages(
			capture(
				{ references: [reference(A, 1)], omitted: 0, skipped: [] },
				{ topLevel: true },
			),
		);
		expect(rows.map((row) => row.record_idx)).toEqual([1]);
	});

	test("a reference without a record is the image's own row", () => {
		const rows = extractSessionImages(
			capture({ references: [reference(A, null)], omitted: 0, skipped: [] }),
		);
		expect(rows.map((row) => [row.agent_id, row.record_idx])).toEqual([
			["", 0],
		]);
	});

	test("old CLIs and malformed entries produce no rows, and never throw", () => {
		expect(extractSessionImages(capture(undefined))).toEqual([]);
		expect(extractSessionImages(capture("images"))).toEqual([]);
		expect(
			extractSessionImages(
				capture({
					references: [
						reference("A".repeat(64), 1),
						reference(A, 0),
						reference(A, 1, { mediaType: "text/html" }),
						reference(A, 1, { source: "url" }),
						reference(A, 1, { bytes: -1 }),
						reference(A, 1, { path: "bad\u0000path", source: "file" }),
						null,
						"x",
					],
					skipped: [{ sha256: A, reason: "Too Large" }, { sha256: "nope" }],
				}),
			),
		).toEqual([]);
		// Non-image objects never count as captured images.
		expect(
			extractSessionImages(
				capture(undefined, {
					objects: [{ ...image(A), kind: "source-blob" as never }],
				}),
			),
		).toEqual([]);
		expect(
			extractSessionImages(
				capture(
					{ references: [reference(A, 1)] },
					{ completedAt: "not a time" },
				),
			),
		).toEqual([]);
	});

	test("reads at most MAX_IMAGE_REFERENCES references", () => {
		const rows = extractSessionImages(
			capture({
				references: Array.from(
					{ length: MAX_IMAGE_REFERENCES + 10 },
					(_, index) => reference(A, index + 1),
				),
			}),
		);
		expect(rows).toHaveLength(MAX_IMAGE_REFERENCES);
	});

	test("the first reference of an image in a record describes it", () => {
		const rows = extractSessionImages(
			capture({
				references: [
					reference(A, 3, { mediaType: "image/gif" }),
					reference(A, 3, { mediaType: "image/png" }),
				],
			}),
		);
		expect(rows.map((row) => row.media_type)).toEqual(["image/gif"]);
	});
});

describe("parseStagedSessionImages", () => {
	test("keeps rows that parse and counts the rest", () => {
		const [row] = extractSessionImages(
			capture({ references: [reference(A, 1)] }),
		);
		expect(parseStagedSessionImages([row, { sha256: 1 }])).toEqual({
			rows: row ? [row] : [],
			invalid: 1,
		});
		expect(parseStagedSessionImages(null)).toEqual({ rows: [], invalid: 0 });
		expect(parseStagedSessionImages({})).toEqual({ rows: [], invalid: 1 });
	});
});
