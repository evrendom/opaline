import { describe, expect, test } from "bun:test";
import {
	CLAUDE_TYPES_SNAPSHOT,
	claudeTypesCoverage,
} from "../../session-transcript/transcript-records/claude-types-coverage.js";
import { generateClaudeTypesSnapshot } from "./oracle.js";

describe("Claude published-types oracle", () => {
	test("expands aliases, unions, arrays, maps and typed blocks with declaration lines", () => {
		const text = `export type ToolInputSchemas = FileReadInput | ToolOutputSchemas;
export type ToolOutputSchemas = FileReadOutput;
export interface FileReadInput { file_path: string; options?: Record<string, number> }
export type FileReadOutput = { content: ({type: "text"; text:string} | {type:"image"; data:string})[] } | null;`;
		const pin = generateClaudeTypesSnapshot(text, "synthetic", "synthetic");
		expect(pin.diagnostics).toEqual([]);
		expect(pin.tools).toEqual(["Read"]);
		expect(pin.paths.map((entry) => entry.path)).toContain(
			"assistant.message.content[tool_use:Read].input.options.{*}",
		);
		expect(pin.paths.map((entry) => entry.path)).toContain(
			"user.toolUseResult.content[text].text",
		);
		expect(pin.paths.map((entry) => entry.path)).toContain(
			"user.toolUseResult.content[image].data",
		);
		expect(pin.paths.some((entry) => entry.path.endsWith("[text].type"))).toBe(
			false,
		);
		expect(
			pin.paths.find((entry) => entry.path.endsWith(".file_path"))?.source,
		).toBe("sdk-tools.d.ts:3");
	});
	test("every Claude catalog tool payload is declared or explicitly noted, never hidden by arbitrary MCP JSON", () => {
		const coverage = claudeTypesCoverage();
		expect(coverage.unaccounted).toEqual([]);
		expect(coverage.matches + coverage.noted.length).toBe(
			coverage.catalogSources,
		);
		expect(coverage.noted.length).toBeGreaterThan(0);
		expect(coverage.blindSpots.length).toBeGreaterThan(0);
		expect(coverage.localNotInSdk).toContain(
			"user.toolUseResult.staleRecovered",
		);
		expect(CLAUDE_TYPES_SNAPSHOT.version).toBe("0.3.287");
		expect(CLAUDE_TYPES_SNAPSHOT.claudeCodeVersion).toBe("2.1.287");
		expect(CLAUDE_TYPES_SNAPSHOT.diagnostics).toEqual([]);
		expect(
			CLAUDE_TYPES_SNAPSHOT.paths.every((entry) =>
				/^sdk-tools\.d\.ts:\d+$/u.test(entry.source),
			),
		).toBe(true);
	});
});
