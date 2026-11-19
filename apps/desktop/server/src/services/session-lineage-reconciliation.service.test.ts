import { describe, expect, test } from "bun:test";
import type { RawLineageSession } from "@rudel/api-routes";
import type { RudelSessionLineageRow } from "@rudel/ch-schema/generated";
import {
	buildSessionLineageLagCountQuery,
	buildSessionLineageScopeSessionsQuery,
	buildStaleSessionLineageQuery,
	reconcileSessionLineageOnce,
	reconcileSessionLineageUntilCaughtUp,
	type SessionLineageReconciliationEnvironment,
	type StaleSessionLineageChildRow,
} from "./session-lineage-reconciliation.service.js";

const FINGERPRINT_KEY = "lineage-test-fingerprint-key-that-is-long-enough";

function parentSession(): RawLineageSession {
	return {
		content: JSON.stringify({
			message: {
				content: [
					{
						id: "tool-1",
						input: {
							command: "codex exec -m gpt-5.5 'do the work'",
							workdir: "/workspace/rudel",
						},
						name: "Bash",
						type: "tool_use",
					},
				],
			},
			timestamp: "2026-08-22T12:00:00.000Z",
			type: "assistant",
		}),
		firstIngestedAt: "2026-08-22T12:00:00.100Z",
		latestIngestedAt: "2026-08-22T12:00:00.100Z",
		organizationId: "org-1",
		projectPath: "/workspace/rudel",
		sessionDate: "2026-08-22T11:00:00.000Z",
		sessionId: "parent-1",
		source: "claude_code",
		userId: "user-1",
	};
}

function childSession(): RawLineageSession {
	return {
		content: [
			{
				timestamp: "2026-08-22T12:00:01.000Z",
				type: "session_meta",
				payload: {
					cwd: "/workspace/rudel",
					id: "child-1",
					originator: "codex_exec",
					thread_source: "user",
				},
			},
			{
				timestamp: "2026-08-22T12:00:01.100Z",
				type: "response_item",
				payload: {
					content: [{ text: "do the work", type: "input_text" }],
					role: "user",
					type: "message",
				},
			},
			{
				timestamp: "2026-08-22T12:00:02.000Z",
				type: "turn_context",
				payload: { model: "gpt-5.5" },
			},
			{
				timestamp: "2026-08-22T12:00:03.000Z",
				type: "response_item",
				payload: { role: "assistant", type: "message" },
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n"),
		firstIngestedAt: "2026-08-22T12:01:00.000Z",
		latestIngestedAt: "2026-08-22T12:02:00.000Z",
		organizationId: "org-1",
		projectPath: "/workspace/rudel",
		sessionDate: "2026-08-22T12:00:01.000Z",
		sessionId: "child-1",
		source: "codex",
		userId: "user-1",
	};
}

function staleChild(): StaleSessionLineageChildRow {
	return {
		child_latest_ingested_at: "2026-08-22T12:02:00.000Z",
		child_session_id: "child-1",
		child_source: "codex",
		organization_id: "org-1",
		user_id: "user-1",
	};
}

function nativeChildSession(
	sessionId = "child-1",
	parentSessionId = "parent-native",
): RawLineageSession {
	const child = childSession();
	return {
		...child,
		sessionId,
		content: [
			{
				timestamp: "2026-08-22T12:00:01.000Z",
				type: "session_meta",
				payload: {
					id: sessionId,
					parent_thread_id: parentSessionId,
					source: {
						subagent: {
							thread_spawn: { parent_thread_id: parentSessionId },
						},
					},
					thread_source: "subagent",
				},
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n"),
	};
}

function environment(
	inserted: RudelSessionLineageRow[],
	sessions: readonly RawLineageSession[],
): SessionLineageReconciliationEnvironment {
	return {
		fingerprintKey: FINGERPRINT_KEY,
		insertRows: async (rows) => {
			inserted.push(...rows);
		},
		now: () => new Date("2026-08-22T12:05:00.000Z"),
		queryLagCount: async () => 0,
		queryScopeSessions: async () => sessions,
		queryStaleChildren: async () => [staleChild()],
	};
}

describe("session-lineage reconciliation", () => {
	test("discovers attested children independently from full scoped look-back", () => {
		const staleQuery = buildStaleSessionLineageQuery();
		const scopeQuery = buildSessionLineageScopeSessionsQuery();
		const lagQuery = buildSessionLineageLagCountQuery();

		expect(staleQuery).toContain("originator");
		expect(staleQuery).toContain("codex_exec");
		expect(staleQuery).toContain("entrypoint");
		expect(staleQuery).toContain("sdk-cli");
		expect(staleQuery).toContain(
			"lineage.input_sequence < toUInt64(toUnixTimestamp64Milli(if(",
		);
		expect(staleQuery).toContain("lineage.confidence = 'native_parent_id'");
		expect(scopeQuery).toContain("organization_id = {orgId:String}");
		expect(scopeQuery).toContain("user_id = {userId:String}");
		expect(scopeQuery).not.toContain("toIntervalDay");
		expect(staleQuery).toContain("raw_parent_scopes AS");
		expect(staleQuery).toContain("parents.parent_latest_ingested_at");
		expect(lagQuery).toContain("SELECT count() AS count");
	});

	test("correlates a successful provider-attested child and persists one edge", async () => {
		const inserted: RudelSessionLineageRow[] = [];
		const result = await reconcileSessionLineageOnce(
			25,
			environment(inserted, [parentSession(), childSession()]),
		);

		expect(result).toEqual({
			anchors: 1,
			candidates: 1,
			edges: 1,
			failedEdges: 0,
			remainingLag: 0,
			unmatchedAnchors: 0,
			unmatchedChildren: 0,
		});
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			child_model: "gpt-5.5",
			child_session_id: "child-1",
			confidence: "prompt_echo",
			countable: 1,
			parent_session_id: "parent-1",
		});
	});

	test("persists unmatched child diagnostics without manufacturing an edge", async () => {
		const inserted: RudelSessionLineageRow[] = [];
		const result = await reconcileSessionLineageOnce(
			25,
			environment(inserted, [childSession()]),
		);

		expect(result.unmatchedChildren).toBe(1);
		expect(result.edges).toBe(0);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			confidence: "ambiguous",
			countable: 0,
			parent_session_id: "",
			reason: "unmatched child candidate",
		});
	});

	test("repairs explicit native metadata and only marks a projected child", async () => {
		const recorded: string[] = [];
		const env: SessionLineageReconciliationEnvironment = {
			...environment([], [nativeChildSession()]),
			recordAgentMetadata: async (session, evidence) => {
				recorded.push(
					`${session.sessionId}:${evidence?.parentSessionId ?? "root"}`,
				);
			},
			projectNativeLineage: async () => true,
		};

		const result = await reconcileSessionLineageOnce(25, env);

		expect(recorded).toEqual(["child-1:parent-native"]);
		expect(result).toMatchObject({
			candidates: 1,
			edges: 1,
			unmatchedChildren: 0,
		});
	});

	test("does not count native children outside the stale batch", async () => {
		const projected: string[] = [];
		const env: SessionLineageReconciliationEnvironment = {
			...environment(
				[],
				[
					nativeChildSession(),
					nativeChildSession("already-current", "other-parent"),
				],
			),
			projectNativeLineage: async (session) => {
				projected.push(session.sessionId);
				return true;
			},
		};

		const result = await reconcileSessionLineageOnce(1, env);

		expect(projected).toEqual(["child-1"]);
		expect(result.unmatchedChildren).toBe(0);
		expect(result.edges).toBe(1);
	});

	test("repairs pending native projections even when raw lineage is current", async () => {
		let repairCalls = 0;
		const env: SessionLineageReconciliationEnvironment = {
			...environment([], []),
			queryStaleChildren: async () => [],
			repairNativeLineage: async () => {
				repairCalls += 1;
				return 1;
			},
		};

		const result = await reconcileSessionLineageOnce(25, env);

		expect(repairCalls).toBe(1);
		expect(result).toEqual({
			anchors: 0,
			candidates: 1,
			edges: 1,
			failedEdges: 0,
			remainingLag: 0,
			unmatchedAnchors: 0,
			unmatchedChildren: 0,
		});
	});

	test("drains bounded native projection repair batches", async () => {
		const repairs = [2, 2, 1];
		let repairCalls = 0;
		const env: SessionLineageReconciliationEnvironment = {
			...environment([], []),
			queryStaleChildren: async () => [],
			repairNativeLineage: async () => {
				const repaired = repairs[repairCalls] ?? 0;
				repairCalls += 1;
				return repaired;
			},
		};

		const result = await reconcileSessionLineageUntilCaughtUp(2, env);

		expect(repairCalls).toBe(3);
		expect(result).toMatchObject({ candidates: 5, edges: 5 });
	});
});
