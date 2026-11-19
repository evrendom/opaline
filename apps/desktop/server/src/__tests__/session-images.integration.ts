import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	type RepositoryEvidenceInitInput,
	RepositoryEvidenceInitInputSchema,
	type RepositoryEvidenceObjectDescriptor,
} from "@rudel/api-routes";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { deleteUserSessions } from "../services/org-session.service.js";
import {
	commitRepositoryEvidence,
	initRepositoryEvidence,
} from "../services/repository-evidence.service.js";
import { buildRepositoryEvidenceIndexRow } from "../services/repository-evidence-index.service.js";
import { publishRepositoryEvidenceIndexAfterCommit } from "../services/repository-evidence-index-publication.service.js";
import {
	readSessionImage,
	type SignImageUrlInput,
} from "../services/session-image-read.service.js";
import { FakeEvidenceR2 } from "./helpers/fake-evidence-r2.js";

/**
 * Session images end to end: a capture uploads screenshots as image objects
 * and lists them with the records that carry them; the commit verifies the
 * bytes and stages the rows with the capture, the evidence index publication
 * writes them to rudel.session_images, the reader returns each with a signed
 * link to its object, a later capture reuses the stored object (stored once
 * per workspace) and never downgrades what an earlier one knew, another
 * session cannot read an image it never named, and account deletion purges
 * the rows. Needs local ClickHouse and Postgres (CI).
 */

setDefaultTimeout(120_000);

const RUN_ID = `session_images_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const ORGANIZATION_ID = `${RUN_ID}_org`;
const USER_ID = `${RUN_ID}_user`;
const SESSION_ID = `${RUN_ID}-session`;
const OTHER_SESSION_ID = `${RUN_ID}-other`;
const clickhouse = getClickhouse();
const r2 = new FakeEvidenceR2();
// Its own client: an earlier file in the integration run ends the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", { max: 2 });

afterAll(async () => {
	for (const table of [
		"rudel.session_images",
		"rudel.repository_session_evidence_index",
	]) {
		await clickhouse
			.execute({
				query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String}`,
				query_params: { organizationId: ORGANIZATION_ID },
			})
			.catch(() => {});
	}
	await sqlClient.unsafe(
		"DELETE FROM repository_evidence_upload_intent WHERE organization_id = $1",
		[ORGANIZATION_ID],
	);
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		ORGANIZATION_ID,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [USER_ID]);
	await sqlClient.end();
});

interface EvidenceObject {
	readonly bytes: Uint8Array;
	readonly descriptor: RepositoryEvidenceObjectDescriptor;
}

function describeBytes(
	bytes: Uint8Array,
	kind: RepositoryEvidenceObjectDescriptor["kind"],
	mediaType: string,
): EvidenceObject {
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	return {
		bytes,
		descriptor: {
			byteLength: bytes.byteLength,
			contentEncoding: "identity",
			filterVersion: null,
			kind,
			mediaType,
			objectId: `sha256:${sha256}`,
			sha256,
		},
	};
}

/** A small PNG-like payload; only its bytes and digest matter here. */
function screenshot(seed: string): EvidenceObject {
	const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	return describeBytes(
		new Uint8Array([...header, ...new TextEncoder().encode(seed)]),
		"image",
		"image/png",
	);
}

function reference(
	image: EvidenceObject,
	recordIndex: number,
	agentId: string | null = null,
) {
	return {
		sha256: image.descriptor.sha256,
		mediaType: "image/png",
		bytes: image.descriptor.byteLength,
		source: "inline",
		agentId,
		recordIndex,
	};
}

async function captureSession(input: {
	readonly sessionId?: string;
	readonly completedAt: string;
	readonly images: readonly EvidenceObject[];
	readonly manifestImages: Record<string, unknown>;
}): Promise<{ contextId: string; uploaded: string[] }> {
	const sessionId = input.sessionId ?? SESSION_ID;
	const manifest = describeBytes(
		new TextEncoder().encode(
			JSON.stringify({
				contextIndex: { facets: [], skills: [] },
				localContext: { entries: [], images: input.manifestImages },
			}),
		),
		"context-manifest",
		"application/json",
	);
	const repositoryHash = createHash("sha256").update(sessionId).digest("hex");
	const evidence: RepositoryEvidenceInitInput =
		RepositoryEvidenceInitInputSchema.parse({
			capture: {
				baseGitCommit: null,
				contextId: crypto.randomUUID(),
				headGitCommit: null,
				parentContextId: null,
				timing: {
					captureCompletedAt: input.completedAt,
					captureStartedAt: input.completedAt,
					firstActionAt: null,
					firstActionBasis: "unavailable",
					firstActionRelationship: "unknown",
					lifecycle: "checkpoint",
				},
				transcriptWatermark: null,
			},
			coverage: [{ area: "git-state", reason: null, status: "complete" }],
			manifestObjectId: manifest.descriptor.objectId,
			objects: [
				manifest.descriptor,
				...input.images.map((image) => image.descriptor),
			],
			operationId: crypto.randomUUID(),
			organizationId: ORGANIZATION_ID,
			protocol: "repository_evidence_v1",
			repository: {
				local: {
					installationId: crypto.randomUUID(),
					repositoryId: `local-repository:${repositoryHash}`,
					worktreeId: `local-worktree:${repositoryHash}`,
				},
				provider: null,
				remoteHint: null,
			},
			session: {
				agentId: null,
				parentAgentId: null,
				runId: "run",
				segmentId: "segment",
				sessionId,
				source: "claude_code",
			},
		});
	const initialized = await initRepositoryEvidence({
		database: sqlClient,
		input: evidence,
		now: () => new Date(),
		organizationId: ORGANIZATION_ID,
		r2,
		randomUUID: () => crypto.randomUUID(),
		userId: USER_ID,
	});
	const bytes = new Map(
		[manifest, ...input.images].map((item) => [
			item.descriptor.objectId,
			item.bytes,
		]),
	);
	const committed = await commitRepositoryEvidence({
		database: sqlClient,
		input: {
			objects: initialized.missingObjects.map((missing) => {
				const content = bytes.get(missing.objectId);
				if (!content) throw new Error("Unexpected evidence object");
				return {
					objectId: missing.objectId,
					objectKey: missing.objectKey,
					parts: [
						{ etag: r2.putPart(missing.uploadId, 1, content), partNumber: 1 },
					],
					uploadId: missing.uploadId,
				};
			}),
			organizationId: ORGANIZATION_ID,
			uploadReceiptId: initialized.uploadReceiptId,
		},
		now: () => new Date(),
		organizationId: ORGANIZATION_ID,
		prepareIndex: (prepared) =>
			buildRepositoryEvidenceIndexRow(
				prepared.input,
				prepared.manifest,
				new Date(),
				USER_ID,
			),
		r2,
		randomUUID: () => crypto.randomUUID(),
		userId: USER_ID,
	});
	// Inline publication has a 3 s budget; a slow CI ClickHouse gets retries.
	for (let attempt = 0; attempt < 5; attempt++) {
		await publishRepositoryEvidenceIndexAfterCommit({
			clickhouse,
			database: sqlClient,
			organizationId: ORGANIZATION_ID,
			contextId: committed.output.contextId,
		});
		const [capture] = await sqlClient.unsafe<Array<{ published: boolean }>>(
			`SELECT index_published_at IS NOT NULL AS published
			 FROM repository_evidence_capture WHERE organization_id = $1 AND context_id = $2`,
			[ORGANIZATION_ID, committed.output.contextId],
		);
		if (capture?.published) break;
	}
	return {
		contextId: committed.output.contextId,
		uploaded: initialized.missingObjects.map((missing) => missing.objectId),
	};
}

const signed: SignImageUrlInput[] = [];

function read(image: EvidenceObject | string, sessionId = SESSION_ID) {
	return readSessionImage(
		{
			organizationId: ORGANIZATION_ID,
			ownerId: USER_ID,
			sessionId,
			sha256: typeof image === "string" ? image : image.descriptor.sha256,
		},
		{
			clickhouse,
			database: sqlClient,
			signUrl: () => async (input) => {
				signed.push(input);
				return `https://r2.test/${input.objectKey}`;
			},
		},
	);
}

async function countRows(): Promise<number> {
	const [row] = await clickhouse.query<{ count: string }>({
		query:
			"SELECT count() AS count FROM rudel.session_images FINAL WHERE organization_id = {organizationId:String}",
		query_params: { organizationId: ORGANIZATION_ID },
	});
	return Number(row?.count ?? 0);
}

const FIRST = screenshot("first screenshot");
const SECOND = screenshot("second screenshot");
const SKIPPED = screenshot("a skipped one");

describe("session images (integration)", () => {
	test("setup", async () => {
		await sqlClient.unsafe(
			`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Member', $2, false)`,
			[USER_ID, `${USER_ID}@example.com`],
		);
		await sqlClient.unsafe(
			"INSERT INTO organization (id, name, slug) VALUES ($1, 'Workspace', $1)",
			[ORGANIZATION_ID],
		);
		await sqlClient.unsafe(
			"INSERT INTO member (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
			[`${ORGANIZATION_ID}_m`, ORGANIZATION_ID, USER_ID],
		);
	});

	test("a capture's images are verified, stored, indexed per record and read back", async () => {
		const { contextId, uploaded } = await captureSession({
			completedAt: "2026-10-16T10:00:00.000Z",
			images: [FIRST],
			manifestImages: {
				references: [
					reference(FIRST, 3),
					reference(FIRST, 7, "agent-1"),
					reference(SECOND, 5),
				],
				omitted: 0,
				skipped: [{ sha256: SKIPPED.descriptor.sha256, reason: "too-large" }],
			},
		});
		expect(uploaded).toContain(FIRST.descriptor.objectId);
		const [staged] = await sqlClient.unsafe<
			Array<{ images: unknown; publishedAt: string | null }>
		>(
			`SELECT images, index_published_at::text AS "publishedAt"
			 FROM repository_evidence_capture WHERE organization_id = $1 AND context_id = $2`,
			[ORGANIZATION_ID, contextId],
		);
		expect(Array.isArray(staged?.images)).toBe(true);
		expect(staged?.publishedAt).not.toBeNull();
		const [object] = await sqlClient.unsafe<
			Array<{ kind: string; objectKey: string; mediaType: string }>
		>(
			`SELECT kind, object_key AS "objectKey", media_type AS "mediaType"
			 FROM repository_evidence_object WHERE organization_id = $1 AND object_id = $2`,
			[ORGANIZATION_ID, FIRST.descriptor.objectId],
		);
		expect(object).toMatchObject({ kind: "image", mediaType: "image/png" });
		expect(await countRows()).toBe(4);

		const first = await read(FIRST);
		expect(first).toMatchObject({
			status: "captured",
			mediaType: "image/png",
			bytes: FIRST.descriptor.byteLength,
			references: [
				{ agentId: null, recordIndex: 3, source: "inline" },
				{ agentId: "agent-1", recordIndex: 7, source: "inline" },
			],
			referencesMore: 0,
			url: `https://r2.test/${object?.objectKey}`,
		});
		expect(signed.at(-1)).toMatchObject({
			contentType: "image/png",
			expiresInSeconds: 300,
		});
		// The signed object holds exactly the image's bytes.
		expect(await r2.getObject(object?.objectKey ?? "")).toEqual(FIRST.bytes);

		expect(await read(SECOND)).toMatchObject({
			status: "not_uploaded",
			references: [{ recordIndex: 5 }],
		});
		expect((await read(SECOND)).url).toBeUndefined();
		expect(await read(SKIPPED)).toMatchObject({
			status: "skipped",
			skippedReason: "too-large",
			references: [],
		});
		expect(await read("d".repeat(64))).toMatchObject({
			status: "not_captured",
		});
	});

	test("a later capture reuses the stored image, uploads the new one, and never downgrades", async () => {
		const signedBefore = signed.length;
		const { uploaded } = await captureSession({
			completedAt: "2026-10-16T11:00:00.000Z",
			images: [FIRST, SECOND],
			manifestImages: {
				references: [reference(FIRST, 12), reference(SECOND, 5)],
				omitted: 0,
				skipped: [],
			},
		});
		// Stored once per workspace: only the new image is uploaded.
		expect(uploaded).toContain(SECOND.descriptor.objectId);
		expect(uploaded).not.toContain(FIRST.descriptor.objectId);
		expect(await read(SECOND)).toMatchObject({ status: "captured" });
		expect(
			(await read(FIRST)).references.map((item) => item.recordIndex),
		).toEqual([3, 12, 7]);

		// A capture that names the images without uploading them knows less.
		await captureSession({
			completedAt: "2026-10-16T12:00:00.000Z",
			images: [],
			manifestImages: {
				references: [reference(FIRST, 3), reference(SECOND, 20)],
				omitted: 0,
				skipped: [],
			},
		});
		expect(await read(FIRST)).toMatchObject({ status: "captured" });
		expect(await read(SECOND)).toMatchObject({
			status: "captured",
			references: [{ recordIndex: 5 }, { recordIndex: 20 }],
		});
		expect(signed.length).toBeGreaterThan(signedBefore);
	});

	test("another session cannot read an image it never named", async () => {
		await captureSession({
			sessionId: OTHER_SESSION_ID,
			completedAt: "2026-10-16T12:30:00.000Z",
			images: [],
			manifestImages: { references: [], omitted: 0, skipped: [] },
		});
		const signedBefore = signed.length;
		expect(await read(FIRST, OTHER_SESSION_ID)).toMatchObject({
			status: "not_captured",
		});
		expect(signed.length).toBe(signedBefore);
	});

	test("account deletion purges the rows", async () => {
		await deleteUserSessions(USER_ID);
		expect(await countRows()).toBe(0);
	});
});
