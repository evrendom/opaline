import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ingestRudelSessionLineage } from "../generated/chkit-ingest.js";
import type { RudelSessionLineageRow } from "../generated/chkit-types.js";
import { createTestExecutor, waitForQuery } from "./helpers/executor.js";

setDefaultTimeout(120_000);

const executor = createTestExecutor();
const testPrefix = `session_lineage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const organizationId = `org_${testPrefix}`;

afterAll(async () => {
	await executor
		.execute(
			`DELETE FROM rudel.session_lineage WHERE organization_id = '${organizationId}' SETTINGS lightweight_deletes_sync = 0`,
		)
		.catch(() => {});
});

function row(input: {
	childModel: string;
	childSessionId: string;
	childSource?: "claude_code" | "codex";
	inputSequence: bigint;
}): RudelSessionLineageRow {
	const derivationVersion = 1n;
	return {
		anchor_operation_ordinal: 0,
		anchor_tool_use_id: "tool-1",
		anchor_ts: "2026-08-22 12:00:00.000",
		carrier: "claude_bash",
		child_entrypoint: "",
		child_first_ingested_at: "2026-08-22 12:01:00.000",
		child_model: input.childModel,
		child_originator: "codex_exec",
		child_session_date: "2026-08-22 12:00:01.000",
		child_session_id: input.childSessionId,
		child_source: input.childSource ?? "codex",
		child_start_ts: "2026-08-22 12:00:01.000",
		confidence: "prompt_echo",
		countable: 1,
		derivation_version: Number(derivationVersion),
		derived_at: "2026-08-22 12:05:00.000",
		input_sequence: input.inputSequence.toString(),
		organization_id: organizationId,
		outcome: "successful",
		parent_session_date: "2026-08-22 11:00:00.000",
		parent_session_id: "parent-1",
		parent_source: "claude_code",
		prompt_fingerprint: "a".repeat(64),
		reason: "exact prompt echo",
		replacement_version: (
			(derivationVersion << 48n) |
			input.inputSequence
		).toString(),
		user_id: "user-1",
		workdir: "/workspace/rudel",
	};
}

describe("session lineage replacing state", () => {
	test("replaces one immutable child identity by the explicit version", async () => {
		await ingestRudelSessionLineage(executor, [
			row({
				childModel: "gpt-5.5",
				childSessionId: `${testPrefix}_child`,
				inputSequence: 1n,
			}),
			row({
				childModel: "gpt-5.6",
				childSessionId: `${testPrefix}_child`,
				inputSequence: 2n,
			}),
		]);

		const rows = await waitForQuery<{
			child_model: string;
			replacement_version: string;
		}>(
			executor,
			`SELECT child_model, toString(replacement_version) AS replacement_version
			FROM rudel.session_lineage FINAL
			WHERE organization_id = '${organizationId}'
				AND user_id = 'user-1'
				AND child_source = 'codex'
				AND child_session_id = '${testPrefix}_child'`,
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.child_model).toBe("gpt-5.6");
		expect(rows[0]?.replacement_version).toBe(((1n << 48n) | 2n).toString());
	});

	test("keeps the same child id from different providers as distinct keys", async () => {
		const sharedChildId = `${testPrefix}_shared`;
		await ingestRudelSessionLineage(executor, [
			row({
				childModel: "gpt-5.5",
				childSessionId: sharedChildId,
				childSource: "codex",
				inputSequence: 3n,
			}),
			row({
				childModel: "claude-fable-5",
				childSessionId: sharedChildId,
				childSource: "claude_code",
				inputSequence: 4n,
			}),
		]);

		const rows = await waitForQuery<{ count: number | string }>(
			executor,
			`SELECT count() AS count
			FROM rudel.session_lineage FINAL
			WHERE organization_id = '${organizationId}'
				AND user_id = 'user-1'
				AND child_session_id = '${sharedChildId}'`,
		);

		expect(Number(rows[0]?.count ?? 0)).toBe(2);
	});
});
