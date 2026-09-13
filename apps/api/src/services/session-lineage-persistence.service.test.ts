import { describe, expect, test } from "bun:test";
import type { SessionLineageEdge } from "@rudel/api-routes";
import {
	buildSessionLineageRow,
	buildUnmatchedSessionLineageRow,
	fingerprintPrompt,
	resolveInputSequence,
} from "./session-lineage-persistence.service.js";

const FINGERPRINT_KEY = "lineage-test-fingerprint-key-that-is-long-enough";

function edge(): SessionLineageEdge {
	return {
		anchor: {
			anchorTs: "2026-08-22T05:41:37.609Z",
			command: "claude -p 'review this'",
			echoedSessionIds: [],
			operationOrdinal: 1,
			organizationId: "org-1",
			parentIngestedAt: "2026-08-22T05:42:00.010Z",
			parentSessionDate: "2026-08-22T05:00:00.000Z",
			parentSessionId: "parent-1",
			parentSource: "codex",
			prompt: "review this",
			targetModel: "claude-fable-5",
			targetProvider: "claude",
			toolUseId: "carrier-1",
			userId: "user-1",
			workdir: "/workspace/rudel",
		},
		child: {
			assistantMessageCount: 4,
			childFirstIngestedAt: "2026-08-22T05:43:00.020Z",
			childLatestIngestedAt: "2026-08-22T05:44:00.030Z",
			childSessionDate: "2026-08-22T05:41:39.211Z",
			childSessionId: "child-1",
			childSource: "claude_code",
			childStartTs: "2026-08-22T05:41:39.211Z",
			entrypoint: "sdk-cli",
			model: "claude-fable-5",
			organizationId: "org-1",
			originator: undefined,
			outcome: "successful",
			provider: "claude",
			rootPrompt: "review this",
			threadSource: undefined,
			userId: "user-1",
			workdir: "/workspace/rudel",
		},
		confidence: "prompt_echo",
		countable: true,
		reason: "exact prompt echo",
	};
}

describe("session-lineage persistence", () => {
	test("builds a deterministic child-keyed replacement row", () => {
		const lineageEdge = edge();
		const row = buildSessionLineageRow({
			derivedAt: "2026-08-22T06:00:00.000Z",
			edge: lineageEdge,
			fingerprintKey: FINGERPRINT_KEY,
		});
		const secondRow = buildSessionLineageRow({
			derivedAt: "2026-08-22T07:00:00.000Z",
			edge: lineageEdge,
			fingerprintKey: FINGERPRINT_KEY,
		});

		expect(row.organization_id).toBe("org-1");
		expect(row.child_session_id).toBe("child-1");
		expect(row.parent_session_id).toBe("parent-1");
		expect(row.carrier).toBe("codex_custom_exec");
		expect(row.countable).toBe(1);
		expect(row.prompt_fingerprint).toHaveLength(64);
		expect(row.replacement_version).toBe(secondRow.replacement_version);
		expect(row.input_sequence).toBe(secondRow.input_sequence);
		expect(row.derived_at).not.toBe(secondRow.derived_at);
	});

	test("uses the newest raw evidence as the low 48-bit input sequence", () => {
		const lineageEdge = edge();
		const sequence = resolveInputSequence(lineageEdge);
		const row = buildSessionLineageRow({
			derivedAt: "2026-08-22T06:00:00.000Z",
			edge: lineageEdge,
			fingerprintKey: FINGERPRINT_KEY,
		});

		expect(sequence).toBe(
			BigInt(Date.parse(lineageEdge.child.childLatestIngestedAt)),
		);
		expect(BigInt(row.replacement_version) & ((1n << 48n) - 1n)).toBe(sequence);
	});

	test("scopes prompt fingerprints to the derivation version and secret", () => {
		expect(fingerprintPrompt("review this", FINGERPRINT_KEY)).toBe(
			fingerprintPrompt("review this", FINGERPRINT_KEY),
		);
		expect(fingerprintPrompt("review that", FINGERPRINT_KEY)).not.toBe(
			fingerprintPrompt("review this", FINGERPRINT_KEY),
		);
		expect(() => fingerprintPrompt("review this", "short")).toThrow(
			"at least 32 characters",
		);
	});

	test("stores unmatched children as non-counting diagnostic state", () => {
		const lineageEdge = edge();
		const row = buildUnmatchedSessionLineageRow({
			child: lineageEdge.child,
			derivedAt: "2026-08-22T06:00:00.000Z",
			fingerprintKey: FINGERPRINT_KEY,
			inputEvidenceAt: "2026-08-22T05:45:00.000Z",
		});

		expect(row).toMatchObject({
			carrier: "unmatched",
			confidence: "ambiguous",
			countable: 0,
			parent_session_id: "",
			reason: "unmatched child candidate",
		});
		expect(row.input_sequence).toBe(
			String(Date.parse("2026-08-22T05:45:00.000Z")),
		);
	});
});
