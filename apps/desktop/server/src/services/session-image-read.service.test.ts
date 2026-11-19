import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	readSessionImage,
	type SessionImageReadDependencies,
	type SignImageUrlInput,
} from "./session-image-read.service.js";

const SHA = "a".repeat(64);
const SCOPE = {
	organizationId: "org_1",
	ownerId: "user_1",
	sessionId: "session_1",
	sha256: SHA,
};
const NOW = new Date("2026-10-16T12:00:00.000Z");

function summary(overrides: Record<string, unknown> = {}) {
	return {
		rows: "3",
		status: "captured",
		skipped_reason: "",
		media_type: "image/png",
		bytes: "4096",
		captured_at: "2026-10-16 10:00:00.000",
		reference_count: "2",
		refs: [
			["", 4, "inline", "", ""],
			["agent-1", "9", "file", "codex-images", "shots/1.png"],
		],
		...overrides,
	};
}

function deps(options: {
	readonly rows?: readonly object[];
	readonly objects?: readonly object[];
	readonly sign?: false | Error;
}): SessionImageReadDependencies & {
	readonly statements: ClickHouseStatement[];
	readonly signed: SignImageUrlInput[];
	readonly lookups: unknown[][];
} {
	const statements: ClickHouseStatement[] = [];
	const signed: SignImageUrlInput[] = [];
	const lookups: unknown[][] = [];
	const clickhouse: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			statements.push(statement);
			return [...(options.rows ?? [])] as T[];
		},
	};
	const database = {
		unsafe: async (_query: string, params: unknown[]) => {
			lookups.push(params);
			return [
				...(options.objects ?? [
					{ objectKey: "evidence/v2/org/aa/key", mediaType: "image/png" },
				]),
			];
		},
	};
	return {
		clickhouse,
		database: database as unknown as postgres.Sql,
		signUrl: () =>
			options.sign === false
				? null
				: async (input) => {
						if (options.sign instanceof Error) throw options.sign;
						signed.push(input);
						return `https://r2.example/${input.objectKey}?signature=1`;
					},
		now: () => NOW,
		statements,
		signed,
		lookups,
	};
}

describe("readSessionImage", () => {
	test("a captured image comes with its records and a short-lived signed link", async () => {
		const env = deps({ rows: [summary()] });
		expect(await readSessionImage(SCOPE, env)).toEqual({
			status: "captured",
			sha256: SHA,
			mediaType: "image/png",
			bytes: 4096,
			skippedReason: null,
			capturedAt: "2026-10-16T10:00:00.000Z",
			references: [
				{
					agentId: null,
					recordIndex: 4,
					source: "inline",
					path: null,
					rootId: null,
				},
				{
					agentId: "agent-1",
					recordIndex: 9,
					source: "file",
					path: "shots/1.png",
					rootId: "codex-images",
				},
			],
			referencesMore: 0,
			url: "https://r2.example/evidence/v2/org/aa/key?signature=1",
			urlExpiresAt: "2026-10-16T12:05:00.000Z",
		});
		expect(env.signed).toEqual([
			{
				objectKey: "evidence/v2/org/aa/key",
				contentType: "image/png",
				contentDisposition: 'inline; filename="aaaaaaaaaaaa.png"',
				expiresInSeconds: 300,
			},
		]);
		// The workspace's object, by the image's object id.
		expect(env.lookups).toEqual([["org_1", `sha256:${SHA}`]]);
	});

	test("reads only the session's own rows, by owner and sha256", async () => {
		const env = deps({ rows: [summary()] });
		await readSessionImage(SCOPE, env);
		const [statement] = env.statements;
		expect(statement?.query).toContain("FROM rudel.session_images FINAL");
		expect(statement?.query).toContain(
			"organization_id = {organizationId:String}",
		);
		expect(statement?.query).toContain("user_id = {ownerId:String}");
		expect(statement?.query).toContain("session_id = {sessionId:String}");
		expect(statement?.query).toContain("sha256 = {sha256:String}");
		expect(statement?.query_params).toEqual({
			organizationId: "org_1",
			ownerId: "user_1",
			sessionId: "session_1",
			sha256: SHA,
			maxReferences: 256,
		});
	});

	test("an image the session's captures never name is not_captured, and nothing is signed", async () => {
		for (const rows of [[], [summary({ rows: "0", status: "" })]]) {
			const env = deps({ rows });
			expect(await readSessionImage(SCOPE, env)).toEqual({
				status: "not_captured",
				sha256: SHA,
				mediaType: null,
				bytes: null,
				skippedReason: null,
				capturedAt: null,
				references: [],
				referencesMore: 0,
			});
			expect(env.lookups).toEqual([]);
			expect(env.signed).toEqual([]);
		}
	});

	test("skipped and not uploaded images say so, without a link", async () => {
		const skipped = deps({
			rows: [summary({ status: "skipped", skipped_reason: "too-large" })],
		});
		expect(await readSessionImage(SCOPE, skipped)).toMatchObject({
			status: "skipped",
			skippedReason: "too-large",
		});
		const missing = deps({ rows: [summary({ status: "not_uploaded" })] });
		const result = await readSessionImage(SCOPE, missing);
		expect(result.status).toBe("not_uploaded");
		expect(result.url).toBeUndefined();
		expect(skipped.signed).toEqual([]);
		expect(missing.signed).toEqual([]);
	});

	test("counts the records left out of references", async () => {
		const env = deps({ rows: [summary({ reference_count: "300" })] });
		expect((await readSessionImage(SCOPE, env)).referencesMore).toBe(298);
	});

	test("a type a browser could run is a download of opaque bytes", async () => {
		const env = deps({ rows: [summary({ media_type: "image/svg+xml" })] });
		await readSessionImage(SCOPE, env);
		expect(env.signed[0]).toMatchObject({
			contentType: "application/octet-stream",
			contentDisposition: 'attachment; filename="aaaaaaaaaaaa.bin"',
		});
	});

	test("a captured image without its object or storage says why", async () => {
		expect(
			await readSessionImage(SCOPE, deps({ rows: [summary()], objects: [] })),
		).toMatchObject({ status: "captured", urlUnavailable: "blob-unavailable" });
		expect(
			await readSessionImage(SCOPE, deps({ rows: [summary()], sign: false })),
		).toMatchObject({ urlUnavailable: "storage-unavailable" });
		expect(
			await readSessionImage(
				SCOPE,
				deps({ rows: [summary()], sign: new Error("no credentials") }),
			),
		).toMatchObject({ urlUnavailable: "storage-unavailable" });
	});
});
