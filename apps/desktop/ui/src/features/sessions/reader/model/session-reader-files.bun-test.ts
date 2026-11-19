import { describe, expect, test } from "bun:test";
import { getFileOps } from "./session-reader-files";

const bash = (command: string) =>
	getFileOps({ input: { command }, toolName: "Bash" });

describe("what a call did to files", () => {
	test("appending edits a file; writing it whole writes it", () => {
		expect(bash('echo "- note" >> MEMORY.md')).toEqual([
			{ operation: "edit", path: "MEMORY.md" },
		]);
		expect(bash("echo hi > out.txt")).toEqual([
			{ operation: "write", path: "out.txt" },
		]);
		expect(bash("cat a.txt | tee -a log.txt")).toContainEqual({
			operation: "edit",
			path: "log.txt",
		});
	});

	test("a Write writes, a Read reads", () => {
		expect(
			getFileOps({
				input: { content: "x", file_path: "/a/globe3d.ts" },
				toolName: "Write",
			}),
		).toEqual([{ operation: "write", path: "/a/globe3d.ts" }]);
		expect(
			getFileOps({ input: { file_path: "/tmp/atc.png" }, toolName: "Read" }),
		).toEqual([{ operation: "read", path: "/tmp/atc.png" }]);
	});
});
