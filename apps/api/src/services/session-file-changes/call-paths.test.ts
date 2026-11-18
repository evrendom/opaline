import { describe, expect, test } from "bun:test";
import { collectSessionFileChanges } from "./file-changes.js";
import { traceStepOf } from "./run-trace.js";

describe("where a call's files are", () => {
	test("a shell read is a read of its files, where the command ran", () => {
		const { files } = collectSessionFileChanges([
			{
				agentId: "sub",
				calls: [
					{
						activity: {
							files: [{ operation: "read", path: "src/a.ts" }],
							status: "completed",
							verb: "Read",
						},
						id: "c",
						input: { command: "cd ~/repo && sed -n '1,40p' src/a.ts" },
						result: { content: "x", isError: false },
						timestamp: "2026-10-22T10:00:00.000Z",
						toolName: "Bash",
					},
				],
				directory: "/Users/me/Documents/app",
				turnId: "t",
			},
		]);
		expect(files.map((file) => [file.path, file.reads])).toEqual([
			["/Users/me/repo/src/a.ts", 1],
		]);
		expect(files[0]?.readBy).toEqual([{ agentId: "sub", turnId: "t" }]);
	});

	test("a step says the directory it ran in", () => {
		const step = traceStepOf(
			{
				id: "c",
				input: { command: "cd ~/repo && cat src/a.ts" },
				timestamp: "2026-10-22T10:00:00.000Z",
				toolName: "Bash",
			},
			"",
			"/Users/me/Documents/app",
		);
		expect(step.directory).toBe("/Users/me/repo");
	});
});
