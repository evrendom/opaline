import { describe, expect, test } from "bun:test";
import {
	REPOSITORY_EVIDENCE_MAX_AGGREGATE_BYTES,
	REPOSITORY_EVIDENCE_MAX_IMAGE_AGGREGATE_BYTES,
	REPOSITORY_EVIDENCE_MAX_IMAGE_BYTES,
	REPOSITORY_EVIDENCE_MAX_IMAGE_OBJECTS,
	REPOSITORY_EVIDENCE_PROTOCOL,
	RepositoryEvidenceCommitInputSchema,
	RepositoryEvidenceInitInputSchema,
} from "../repository-evidence.js";

const MANIFEST_HASH = "a".repeat(64);
const BLOB_HASH = "b".repeat(64);

function makeInitInput() {
	return {
		capture: {
			baseGitCommit: "1".repeat(40),
			contextId: "00000000-0000-4000-8000-000000000101",
			headGitCommit: "2".repeat(40),
			parentContextId: null,
			timing: {
				captureCompletedAt: "2026-09-19T11:00:01.000Z",
				captureStartedAt: "2026-09-19T11:00:00.000Z",
				firstActionAt: "2026-09-19T11:00:02.000Z",
				firstActionBasis: "native-hook",
				firstActionRelationship: "before-first-action",
				lifecycle: "start",
			},
			transcriptWatermark: {
				byteOffset: 128,
				eventOrdinal: 3,
				lastEventAt: "2026-09-19T11:00:00.500Z",
			},
		},
		coverage: [
			{ area: "git-state", reason: null, status: "complete" },
			{
				area: "available-skills",
				reason: "Agent harness did not expose its global skill directory",
				status: "partial",
			},
		],
		manifestObjectId: `sha256:${MANIFEST_HASH}`,
		objects: [
			{
				byteLength: 512,
				contentEncoding: "identity",
				filterVersion: 1,
				kind: "context-manifest",
				mediaType: "application/json",
				objectId: `sha256:${MANIFEST_HASH}`,
				sha256: MANIFEST_HASH,
			},
			{
				byteLength: 1_024,
				contentEncoding: "gzip",
				filterVersion: 1,
				kind: "source-blob",
				mediaType: "text/plain",
				objectId: `sha256:${BLOB_HASH}`,
				sha256: BLOB_HASH,
			},
		],
		operationId: "00000000-0000-4000-8000-000000000102",
		organizationId: "organization-1",
		protocol: REPOSITORY_EVIDENCE_PROTOCOL,
		repository: {
			local: {
				installationId: "00000000-0000-4000-8000-000000000103",
				repositoryId: `local-repository:${"c".repeat(64)}`,
				worktreeId: `local-worktree:${"d".repeat(64)}`,
			},
			remoteHint: {
				host: "GitHub.com",
				name: "athena",
				owner: "opalinehq",
				provider: "github",
			},
			provider: {
				host: "GitHub.com",
				name: "athena",
				nodeId: "R_kgDOExample",
				owner: "opalinehq",
				provider: "github",
				repositoryId: "123456789",
			},
		},
		session: {
			agentId: null,
			parentAgentId: null,
			runId: "run-1",
			segmentId: "segment-1",
			sessionId: "session-1",
			source: "codex",
		},
	};
}

describe("repository evidence contract", () => {
	test("accepts stable identities, timing proof, coverage, and content-addressed objects", () => {
		const parsed = RepositoryEvidenceInitInputSchema.parse(makeInitInput());

		expect(parsed.repository.provider?.host).toBe("github.com");
		expect(parsed.repository.remoteHint?.host).toBe("github.com");
		expect(parsed.objects).toHaveLength(2);
		expect(parsed.capture.timing.firstActionRelationship).toBe(
			"before-first-action",
		);
	});

	test("rejects digest mismatches, duplicate coverage, and missing reasons", () => {
		const valid = makeInitInput();
		const input = {
			...valid,
			objects: valid.objects.map((object, index) =>
				index === 0
					? { ...object, objectId: `sha256:${"e".repeat(64)}` }
					: object,
			),
			coverage: [
				{ area: "git-state", reason: null, status: "complete" },
				{ area: "git-state", reason: null, status: "partial" },
			],
		};

		const result = RepositoryEvidenceInitInputSchema.safeParse(input);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((issue) => issue.message)).toContain(
				"Object ID must contain the declared SHA-256 digest",
			);
			expect(result.error.issues.map((issue) => issue.message)).toContain(
				"Incomplete coverage requires an explicit reason",
			);
			expect(result.error.issues.map((issue) => issue.message)).toContain(
				"Evidence coverage areas must be unique",
			);
		}
	});

	test("rejects evidence above the bounded aggregate upload size", () => {
		const valid = makeInitInput();
		const objects = Array.from({ length: 3 }, (_, index) => {
			const sha256 = `${index + 1}`.repeat(64);
			return {
				byteLength: REPOSITORY_EVIDENCE_MAX_AGGREGATE_BYTES / 2,
				contentEncoding: "identity",
				filterVersion: null,
				kind: index === 0 ? "context-manifest" : "source-blob",
				mediaType: "application/octet-stream",
				objectId: `sha256:${sha256}`,
				sha256,
			};
		});
		const input = {
			...valid,
			manifestObjectId: objects[0]?.objectId ?? "",
			objects,
		};

		expect(RepositoryEvidenceInitInputSchema.safeParse(input).success).toBe(
			false,
		);
	});

	test("allows a commit with no completed objects when init reused every object", () => {
		expect(
			RepositoryEvidenceCommitInputSchema.parse({
				organizationId: "organization-1",
				objects: [],
				uploadReceiptId: "00000000-0000-4000-8000-000000000104",
			}),
		).toEqual({
			organizationId: "organization-1",
			objects: [],
			uploadReceiptId: "00000000-0000-4000-8000-000000000104",
		});
	});

	describe("image objects", () => {
		const image = (index: number, byteLength: number) => {
			const sha256 = index.toString(16).padStart(64, "0");
			return {
				byteLength,
				contentEncoding: "identity",
				filterVersion: null,
				kind: "image",
				mediaType: "image/png",
				objectId: `sha256:${sha256}`,
				sha256,
			};
		};
		const withObjects = (objects: unknown[]) => {
			const valid = makeInitInput();
			return { ...valid, objects: [...valid.objects, ...objects] };
		};
		const messages = (input: unknown) => {
			const result = RepositoryEvidenceInitInputSchema.safeParse(input);
			return result.success
				? []
				: result.error.issues.map((issue) => issue.message);
		};

		test("accepts raw images beside the repository context", () => {
			const parsed = RepositoryEvidenceInitInputSchema.parse(
				withObjects([image(1, 3 * 1024 * 1024), image(2, 1_024)]),
			);
			expect(parsed.objects.map((object) => object.kind)).toEqual([
				"context-manifest",
				"source-blob",
				"image",
				"image",
			]);
		});

		test("images have their own budget, outside the aggregate for everything else", () => {
			// Over the 128 MiB of everything else, within the image budget.
			const count = Math.ceil(
				(REPOSITORY_EVIDENCE_MAX_AGGREGATE_BYTES + 1) /
					REPOSITORY_EVIDENCE_MAX_IMAGE_BYTES,
			);
			expect(
				messages(
					withObjects(
						Array.from({ length: count }, (_, index) =>
							image(index + 1, REPOSITORY_EVIDENCE_MAX_IMAGE_BYTES),
						),
					),
				),
			).toEqual([]);
			const over = Math.floor(
				REPOSITORY_EVIDENCE_MAX_IMAGE_AGGREGATE_BYTES /
					REPOSITORY_EVIDENCE_MAX_IMAGE_BYTES,
			);
			expect(
				messages(
					withObjects(
						Array.from({ length: over + 1 }, (_, index) =>
							image(index + 1, REPOSITORY_EVIDENCE_MAX_IMAGE_BYTES),
						),
					),
				),
			).toEqual([
				`Aggregate images exceed ${REPOSITORY_EVIDENCE_MAX_IMAGE_AGGREGATE_BYTES} bytes`,
			]);
			expect(
				messages(
					withObjects(
						Array.from(
							{ length: REPOSITORY_EVIDENCE_MAX_IMAGE_OBJECTS + 1 },
							(_, index) => image(index + 1, 1_024),
						),
					),
				),
			).toEqual([
				`A capture holds at most ${REPOSITORY_EVIDENCE_MAX_IMAGE_OBJECTS} images`,
			]);
		});

		test("an image is raw, image/<subtype> and at most 32 MiB", () => {
			expect(
				messages(
					withObjects([
						{ ...image(1, 1_024), contentEncoding: "gzip" },
						{ ...image(2, 1_024), mediaType: "text/html" },
						image(3, REPOSITORY_EVIDENCE_MAX_IMAGE_BYTES + 1),
					]),
				),
			).toEqual([
				"An image object holds its raw bytes (identity encoding)",
				"An image object needs an image/<subtype> media type",
				`An image object exceeds ${REPOSITORY_EVIDENCE_MAX_IMAGE_BYTES} bytes`,
			]);
		});
	});
});
