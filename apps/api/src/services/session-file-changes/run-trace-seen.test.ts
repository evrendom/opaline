import { describe, expect, test } from "bun:test";
import { SESSION_RUN_SEEN_LIMIT } from "@rudel/api-routes";
import { seenOfRead, traceStepOf } from "./run-trace.js";

describe("what a read saw", () => {
	test("a Read's numbered lines lose their numbers and keep where they start", () => {
		expect(
			seenOfRead(
				"    40\tconst a = 1;\n    41\t\n    42→return a;\n<system-reminder>x</system-reminder>",
			),
		).toEqual({ cut: false, line: 40, text: "const a = 1;\n\nreturn a;" });
	});

	test("text a read didn't number is kept as it came, from line 1", () => {
		expect(seenOfRead([{ text: "hello\nworld\n", type: "text" }])).toEqual({
			cut: false,
			line: 1,
			text: "hello\nworld",
		});
		expect(seenOfRead("3\tthree\n7\tseven")?.line).toBe(1);
	});

	test("a shell read starts where its command says", () => {
		expect(seenOfRead("a\nb", "sed -n '120,200p' src/x.ts")?.line).toBe(120);
		expect(seenOfRead("a", "tail -n +40 src/x.ts")?.line).toBe(40);
		expect(seenOfRead("a", "cat src/x.ts")?.line).toBe(1);
	});

	test("no text is nothing seen; too much is cut and said so", () => {
		expect(seenOfRead([{ source: {}, type: "image" }])).toBeNull();
		const seen = seenOfRead("x".repeat(SESSION_RUN_SEEN_LIMIT + 5));
		expect(seen?.cut).toBe(true);
		expect(seen?.text.length).toBe(SESSION_RUN_SEEN_LIMIT);
	});

	test("a read step carries it; a failed read, and other steps, don't", () => {
		const read = (isError: boolean) =>
			traceStepOf(
				{
					id: "r",
					input: { file_path: "/x/a.ts" },
					result: { content: "     1\tok", isError },
					timestamp: "2026-10-22T10:00:00.000Z",
					toolName: "Read",
				},
				"",
			);
		expect(read(false).seen).toEqual({ cut: false, line: 1, text: "ok" });
		expect(read(true).seen).toBeNull();
		const edit = traceStepOf(
			{
				id: "e",
				input: { file_path: "/x/a.ts", new_string: "b", old_string: "a" },
				timestamp: "2026-10-22T10:00:01.000Z",
				toolName: "Edit",
			},
			"",
		);
		expect("seen" in edit).toBe(false);
	});

	test("line numbers past what's safe aren't taken as lines", () => {
		expect(seenOfRead(`${"9".repeat(30)}\tx`)?.line).toBe(1);
		expect(seenOfRead("x", `sed -n '${"9".repeat(30)},2p' a`)?.line).toBe(1);
	});

	test("a shell read to a file's end ends where what it returned does", () => {
		const step = traceStepOf(
			{
				activity: {
					files: [{ operation: "read", path: "/r/a.ts" }],
					status: "completed",
					verb: "Read",
				},
				id: "c",
				input: { command: "cat /r/a.ts" },
				result: { content: "one\ntwo\nthree\n", isError: false },
				timestamp: "2026-10-22T10:00:00.000Z",
				toolName: "Bash",
			},
			"",
			"/r",
		);
		expect(step.ranges).toEqual([{ from: 1, path: "/r/a.ts", to: 3 }]);
	});

	test("an MCP call says the tool it called", () => {
		const step = traceStepOf(
			{
				id: "m",
				input: {},
				timestamp: "2026-10-22T10:00:00.000Z",
				toolName: "mcp__plugin_opaline_opaline__find",
			},
			"",
		);
		expect(step.kind).toBe("tool");
		expect(step.tool).toBe("mcp__plugin_opaline_opaline__find");
	});
});
