import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { describe, expect, it } from "vitest";
import {
	mcpServerLabel,
	readUseHint,
	turnOfHint,
	writeUseHint,
} from "./reader-use-hint";

const turn = (
	turnId: string,
	startedAt: string,
	skills: string[] = [],
): SessionDetailTurnSummary =>
	({
		turnId,
		startedAt,
		skills,
		skillEvents: [],
	}) as unknown as SessionDetailTurnSummary;

describe("reader use hints", () => {
	it("round-trips skill and MCP hints", () => {
		expect(readUseHint(writeUseHint({ kind: "skill", name: "ui" }))).toEqual({
			kind: "skill",
			name: "ui",
		});
		expect(
			readUseHint(writeUseHint({ kind: "mcp", name: "t3-code", at: 42 })),
		).toEqual({ kind: "mcp", name: "t3-code", at: 42 });
		expect(readUseHint("nonsense")).toBeNull();
	});

	it("finds the first turn that used a skill and the turn an MCP call fell in", () => {
		const turns = [
			turn("a", "2026-11-17T10:00:00Z"),
			turn("b", "2026-11-17T10:05:00Z", ["anthropic-skills:docx"]),
			turn("c", "2026-11-17T10:10:00Z", ["docx"]),
		];
		expect(turnOfHint({ kind: "skill", name: "docx" }, turns)).toBe("b");
		expect(
			turnOfHint(
				{ kind: "mcp", name: "x", at: Date.parse("2026-11-17T10:07:00Z") },
				turns,
			),
		).toBe("b");
	});

	it("labels plugin servers by their plugin", () => {
		expect(mcpServerLabel("plugin_opaline_opaline")).toBe("opaline");
		expect(mcpServerLabel("t3-code")).toBe("t3-code");
	});
});
