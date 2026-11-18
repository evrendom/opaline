import { expect, test } from "bun:test";
import type { SessionReaderBody } from "../model/session-reader-model";
import { errorImpact, runErrors } from "./session-reader-run-errors";

const failed = (toolName: string, input: unknown, text: string) => ({
	id: Math.random().toString(),
	input,
	kind: "tool" as const,
	result: { content: text, isError: true },
	timestamp: "2026-10-28T10:00:00.000Z",
	toolName,
});

const bodyOf = (events: ReturnType<typeof failed>[]) =>
	({
		responseItems: [{ events, id: "a", kind: "agent" }],
		userItems: [],
	}) as unknown as SessionReaderBody;

const ok = (toolName: string, input: unknown) => ({
	...failed(toolName, input, "done"),
	result: { content: "done", isError: false },
});

test("failures by who has to act on them, and a call failing again and again", () => {
	const looping = failed(
		"Bash",
		{ command: "cd /w && python3 - <<'EOF'\nboom\nEOF" },
		"Exit code 1\nTraceback (most recent call last):\n  File ...",
	);
	const errors = runErrors(
		bodyOf([
			failed(
				"Bash",
				{ command: "sleep 240; tail -2 x.log" },
				"<tool_use_error>Blocked: sleep 240 followed by: tail -2 x.log</tool_use_error>",
			),
			failed(
				"Bash",
				{ command: "bun install" },
				"error: [package-command-policy]: STOP: This command cannot install or download packages.",
			),
			failed(
				"Bash",
				{ command: "cat src/policy.ts" },
				"Exit code 1\nconsole.error(`STOP: " + "$" + "{message}`);",
			),
			failed(
				"mcp__t3-code__preview_snapshot",
				{},
				"Preview snapshot failed: Preview automation snapshot failed on client preview-1",
			),
			failed(
				"mcp__t3-code__preview_evaluate",
				{ expression: "x" },
				"No active preview tab was found for evaluate. Call preview_open first.",
			),
			failed(
				"Edit",
				{ file_path: "a.ts" },
				"<tool_use_error>File has been modified since read, either by the user or by a linter.</tool_use_error>",
			),
			failed(
				"Write",
				{ file_path: "b.ts" },
				"The user doesn't want to proceed with this tool use.",
			),
			failed(
				"Bash",
				{ command: "cd apps/web && bun run check-types" },
				"Exit code 2\nsrc/a.ts(1,1): error TS2304: Cannot find name 'x'.",
			),
			failed(
				"Bash",
				{ command: "timeout 60 bun dev" },
				"Exit code 124\nready on :3000",
			),
			failed(
				"Bash",
				{ command: "bun test a; ls nope" },
				"Exit code 1\n 12 pass\n 0 fail",
			),
			failed(
				"Bash",
				{
					command:
						"cd ~/.claude && ls -la | head; for d in a b; do [ -e $d ] && echo $d; done",
				},
				"Exit code 1\ntotal 8\ndrwxr-xr-x  . \n",
			),
			looping,
			looping,
			looping,
			looping,
		]),
	);
	expect(errors.harness).toEqual([{ count: 1, label: "sleep" }]);
	expect(errors.hook).toEqual([
		{ count: 1, label: "This command cannot install or download packages" },
	]);
	expect(errors.declined).toBe(1);
	expect(errors.broken).toEqual([
		{ count: 1, label: "t3-code preview snapshot" },
	]);
	expect(errors.misused).toEqual([
		{ count: 1, label: "t3-code preview evaluate" },
		{ count: 1, label: "Edit" },
	]);
	expect(errors.real).toEqual([
		{ count: 4, label: "python3" },
		{ count: 1, label: "bun" },
		{ count: 1, label: "timeout" },
	]);
	expect(errors.exitOnly).toBe(3);
	expect(errors.stuck).toEqual([{ count: 4, label: "python3", streaks: 1 }]);
});

test("a check failing between edits isn't stuck: the agent's fixing it", () => {
	const check = () =>
		failed(
			"Bash",
			{ command: "bun run check-types" },
			"Exit code 2\nerror TS2304: x",
		);
	const edit = () => ok("Edit", { file_path: "a.ts" });
	const errors = runErrors(
		bodyOf([check(), edit(), check(), edit(), check(), edit(), check()]),
	);
	expect(errors.real).toEqual([{ count: 4, label: "bun" }]);
	expect(errors.stuck).toEqual([]);
});

const at = (event: ReturnType<typeof failed>, seconds: number) => ({
	...event,
	result: {
		...event.result,
		timestamp: new Date(Date.UTC(2026, 9, 28, 10, 0, seconds)).toISOString(),
	},
	timestamp: new Date(Date.UTC(2026, 9, 28, 10, 0, seconds)).toISOString(),
});

test("what became of failures: when the same work next worked, or never", () => {
	const build = (fine: boolean, seconds: number) =>
		at(
			fine
				? ok("Bash", { command: "python3 build.py" })
				: failed(
						"Bash",
						{ command: "python3 build.py" },
						"Exit code 1\nTraceback (most recent call last):",
					),
			seconds,
		);
	const impact = errorImpact(
		bodyOf([
			build(false, 0),
			at(ok("Bash", { command: "python3 other.py" }), 5),
			build(false, 10),
			build(true, 38),
			at(failed("Bash", { command: "bun test" }, "Exit code 1\n 1 fail"), 40),
			at(ok("Bash", { command: "bun test" }), 50),
			at(
				failed(
					"mcp__t3-code__preview_snapshot",
					{},
					"Preview automation snapshot failed",
				),
				51,
			),
			at(
				failed(
					"mcp__t3-code__preview_snapshot",
					{},
					"Preview automation snapshot failed",
				),
				52,
			),
			at(failed("Bash", { command: "ls nope; ls" }, "Exit code 1\nok"), 53),
		]),
	);
	expect(impact.quick).toHaveLength(1);
	expect(impact.exitOnly).toHaveLength(1);
	expect(impact.blocked).toHaveLength(0);
	expect(impact.slow).toMatchObject([
		{ label: "python3 build.py", ms: 38_000 },
	]);
	expect(impact.slow[0]?.calls[0]?.step).toBeTruthy();
	expect(impact.unresolved).toMatchObject([
		{ count: 2, label: "t3-code preview snapshot" },
	]);
	expect(impact.unresolved[0]?.calls).toHaveLength(2);
});
