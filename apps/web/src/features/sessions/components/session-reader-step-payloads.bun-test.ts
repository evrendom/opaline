import { describe, expect, test } from "bun:test";
import { getToolResultView } from "./session-reader-step-payloads";

function tool(toolName: string, input: Record<string, unknown>) {
	return {
		id: "t1",
		input,
		kind: "tool" as const,
		result: undefined,
		timestamp: "2026-10-10T10:00:00.000Z",
		toolName,
	};
}

describe("step inspector results", () => {
	test("a read file loses its line gutter and keeps its real line numbers", () => {
		expect(
			getToolResultView(
				tool("Read", { file_path: "src/app.tsx", offset: 40 }),
				"    40→const a = 1;\n    41→export { a };",
			),
		).toEqual({
			language: "tsx",
			startLine: 40,
			text: "const a = 1;\nexport { a };",
		});
	});

	test("JSON output is pretty-printed, everything else stays text", () => {
		expect(getToolResultView(tool("Bash", {}), '{"ok":true}')).toEqual({
			language: "json",
			text: '{\n  "ok": true\n}',
		});
		expect(getToolResultView(tool("Bash", {}), "done\n")).toEqual({
			language: "text",
			text: "done",
		});
	});
});
