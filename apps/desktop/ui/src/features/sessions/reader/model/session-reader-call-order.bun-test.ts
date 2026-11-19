import { describe, expect, test } from "bun:test";
import { isReadOnlyCommand, runsAlongside } from "./session-reader-call-order";

describe("call order", () => {
	test("commands that only read", () => {
		for (const command of [
			"ls -la",
			'cd /src; grep -n "cost:\\|sig" a.ts | head -20',
			"git -C repo status -sb && git log --oneline -8 origin/main",
			"find . -name '*.ts' 2>/dev/null | wc -l",
			"sed -n 1,40p a.ts",
			"git branch --show-current",
			"command grep -rn x . < /dev/null",
		])
			expect([command, isReadOnlyCommand(command)]).toEqual([command, true]);
	});

	test("commands that change something", () => {
		for (const command of [
			"cd repo && git fetch -q origin && git status",
			"sed -i '' s/a/b/ a.ts",
			"echo hi > a.txt",
			"find . -name '*.tmp' -delete",
			"cat a | tee b",
			"ls $(pwd)",
			"bun test",
			"git branch -D old",
			"sleep 50",
		])
			expect([command, isReadOnlyCommand(command)]).toEqual([command, false]);
	});

	test("tools", () => {
		expect(runsAlongside("Read")).toBe(true);
		expect(runsAlongside("Edit")).toBe(false);
		expect(runsAlongside("mcp__opaline__find")).toBe(false);
		expect(runsAlongside("Bash", "git status")).toBe(true);
		expect(runsAlongside("Bash")).toBe(false);
	});
});
