import { describe, expect, test } from "bun:test";
import {
	ciRunNodeId,
	commitNodeId,
	idPrefixRange,
	pullRequestNodeId,
	runNodeId,
	sessionNodeId,
	sessionScopeId,
	splitL1NodeId,
} from "./l1-edge-ids.js";

const session = { userId: "u/1", source: "codex", sessionId: "s 1" };

describe("L1 node ids", () => {
	test("encode every component, so ids round-trip and a slash cannot shift them", () => {
		expect(runNodeId(session, "", 42)).toBe("u%2F1/codex/s%201//42");
		expect(splitL1NodeId(runNodeId(session, "agent/x", 7))).toEqual([
			"u/1",
			"codex",
			"s 1",
			"agent/x",
			"7",
		]);
		expect(sessionNodeId(session, "")).toBe("u%2F1/codex/s%201/");
		expect(commitNodeId("101", "D4E5F6A")).toBe("101/d4e5f6a");
		expect(pullRequestNodeId("101", 133)).toBe("101/133");
		expect(ciRunNodeId("101", "actions_run", "7001", 2)).toBe(
			"101/actions_run/7001/2",
		);
	});

	test("a session's run and stream ids fall inside its prefix range, other sessions outside", () => {
		const { from, to } = idPrefixRange(sessionScopeId(session));
		const inside = (id: string) => id >= from && id < to;
		expect(inside(runNodeId(session, "", 1))).toBe(true);
		expect(inside(sessionNodeId(session, "sub"))).toBe(true);
		expect(inside(runNodeId({ ...session, sessionId: "s 10" }, "", 1))).toBe(
			false,
		);
		expect(inside(sessionScopeId(session))).toBe(false);
	});
});

describe("edge queue backoff", () => {
	test("doubles per attempt with bounded jitter and a ceiling", async () => {
		const { l1EdgeRetryDelayMs } = await import("./l1-edge-queue.service.js");
		expect(l1EdgeRetryDelayMs(1, 0)).toBe(30_000);
		expect(l1EdgeRetryDelayMs(3, 0)).toBe(120_000);
		expect(l1EdgeRetryDelayMs(3, 1)).toBe(150_000);
		expect(l1EdgeRetryDelayMs(40, 1)).toBe(6 * 3_600_000);
	});
});
