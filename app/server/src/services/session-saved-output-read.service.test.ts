import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	readSessionSavedOutput,
	type SavedOutputReadDependencies,
} from "./session-saved-output-read.service.js";

const TEXT = "line 1\nline 2\n";
const BLOB = `sha256:${createHash("sha256").update(TEXT).digest("hex")}`;
const SCOPE = {
	organizationId: "org_1",
	ownerId: "user_1",
	sessionId: "session_1",
};

function row(overrides: Record<string, unknown> = {}) {
	return {
		kind: "task_output",
		path: "rerooted/btask.output",
		task_id: "btask",
		tool_use_id: "toolu_1",
		agent_id: "",
		record_idx: 12,
		status: "truncated",
		omitted_reason: "",
		blob_object_id: BLOB,
		source_bytes: String(TEXT.length),
		stored_bytes: String(TEXT.length),
		original_bytes: "900000",
		truncated: true,
		captured_at: "2026-10-16 10:00:00.000",
		capture_reason: "task-output-sweep",
		...overrides,
	};
}

function deps(options: {
	readonly rows?: readonly object[];
	readonly objects?: readonly object[];
	readonly bytes?: Uint8Array | Error;
	readonly r2?: boolean;
}): SavedOutputReadDependencies & {
	readonly statements: ClickHouseStatement[];
	readonly reads: string[];
} {
	const statements: ClickHouseStatement[] = [];
	const reads: string[] = [];
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
		unsafe: async () => [
			...(options.objects ?? [
				{ objectKey: "evidence/v2/key", byteLength: TEXT.length },
			]),
		],
	};
	return {
		clickhouse,
		database: database as unknown as postgres.Sql,
		r2: () =>
			options.r2 === false
				? null
				: {
						async getObject(objectKey: string) {
							reads.push(objectKey);
							if (options.bytes instanceof Error) throw options.bytes;
							return options.bytes ?? new TextEncoder().encode(TEXT);
						},
					},
		statements,
		reads,
	};
}

describe("readSessionSavedOutput", () => {
	test("returns the newest row of the task with its verified text", async () => {
		const env = deps({ rows: [row()] });
		const output = await readSessionSavedOutput(
			{ ...SCOPE, taskId: "btask" },
			env,
		);
		expect(output).toEqual({
			status: "truncated",
			kind: "task_output",
			path: "rerooted/btask.output",
			taskId: "btask",
			toolUseId: "toolu_1",
			agentId: null,
			recordIndex: 12,
			truncated: true,
			originalBytes: 900_000,
			sourceBytes: TEXT.length,
			storedBytes: TEXT.length,
			omittedReason: null,
			capturedAt: "2026-10-16T10:00:00.000Z",
			captureReason: "task-output-sweep",
			text: TEXT,
		});
		expect(env.reads).toEqual(["evidence/v2/key"]);
		const [statement] = env.statements;
		expect(statement?.query).toContain("FINAL");
		expect(statement?.query).toContain("ORDER BY version DESC");
		expect(statement?.query_params).toEqual({
			organizationId: "org_1",
			ownerId: "user_1",
			sessionId: "session_1",
			taskId: "btask",
			taskRoot: "claude-task-outputs",
		});
	});

	test("not captured without a row; missing and omitted without text", async () => {
		expect(
			await readSessionSavedOutput(
				{ ...SCOPE, toolUseId: "toolu_x" },
				deps({ rows: [] }),
			),
		).toMatchObject({
			status: "not_captured",
			toolUseId: "toolu_x",
			kind: null,
		});
		const missing = deps({
			rows: [
				row({
					status: "missing",
					path: "bgone.output",
					blob_object_id: "",
					truncated: false,
					original_bytes: "0",
					capture_reason: "",
				}),
			],
		});
		const output = await readSessionSavedOutput(
			{ ...SCOPE, taskId: "bgone" },
			missing,
		);
		expect(output).toMatchObject({
			status: "missing",
			truncated: false,
			originalBytes: null,
			storedBytes: null,
			captureReason: null,
		});
		expect(output.text).toBeUndefined();
		expect(missing.reads).toEqual([]);
	});

	test("a path lookup is narrowed to its root", async () => {
		const env = deps({ rows: [] });
		await readSessionSavedOutput(
			{ ...SCOPE, path: "toolu_big.txt", kind: "tool_result" },
			env,
		);
		expect(env.statements[0]?.query_params).toMatchObject({
			path: "toolu_big.txt",
			kindRoot: "claude-tool-results",
		});
	});

	test("says why the text is unavailable", async () => {
		const read = (env: SavedOutputReadDependencies) =>
			readSessionSavedOutput({ ...SCOPE, taskId: "btask" }, env);
		expect(
			(await read({ ...deps({ rows: [row()] }), maxTextBytes: 4 }))
				.textUnavailable,
		).toBe("too-large");
		expect(
			(await read(deps({ rows: [row()], objects: [] }))).textUnavailable,
		).toBe("blob-unavailable");
		expect(
			(await read(deps({ rows: [row()], r2: false }))).textUnavailable,
		).toBe("storage-unavailable");
		expect(
			(
				await read(
					deps({ rows: [row()], bytes: new TextEncoder().encode("x") }),
				)
			).textUnavailable,
		).toBe("blob-unavailable");
		expect(
			(await read(deps({ rows: [row()], bytes: new Error("gone") })))
				.textUnavailable,
		).toBe("blob-unavailable");
		const empty = deps({ rows: [row({ stored_bytes: "0" })], objects: [] });
		expect((await read(empty)).text).toBe("");
		expect(empty.reads).toEqual([]);
	});
});
