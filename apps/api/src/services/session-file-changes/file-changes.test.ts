import { describe, expect, test } from "bun:test";
import type { SessionDetailTurn } from "@rudel/api-routes";
import type { SessionDetailDerivation } from "../session-detail-derivation.service.js";
import {
	collectDerivationFileChanges,
	collectSessionFileChanges,
	wholeFileFromRead,
} from "./file-changes.js";
import { traceStepOf } from "./run-trace.js";
import type { SessionToolCall } from "./tool-calls.js";

let clock = 0;
const call = (
	toolName: string,
	input: Record<string, unknown>,
	result: SessionToolCall["result"] = { content: "ok", isError: false },
): SessionToolCall => ({
	id: `call-${++clock}`,
	input,
	result,
	timestamp: new Date(Date.UTC(2026, 9, 21, 10, 0, clock)).toISOString(),
	toolName,
});

const numbered = (text: string) =>
	text
		.split("\n")
		.map((line, index) => `${String(index + 1).padStart(6)}\t${line}`)
		.join("\n");

describe("wholeFileFromRead", () => {
	test("reads numbered lines back as the file, both styles", () => {
		expect(wholeFileFromRead({}, numbered("a\nb"))).toBe("a\nb\n");
		expect(wholeFileFromRead({}, "1→a\n2→b")).toBe("a\nb\n");
	});

	test("drops the harness's reminders after the file", () => {
		expect(
			wholeFileFromRead(
				{},
				`${numbered("a")}\n\n<system-reminder>x</system-reminder>`,
			),
		).toBe("a\n");
	});

	test("a part of a file, or not its text, is no whole file", () => {
		expect(wholeFileFromRead({ offset: 10 }, numbered("a"))).toBeNull();
		expect(wholeFileFromRead({}, "     5\ta")).toBeNull();
		expect(wholeFileFromRead({}, "File does not exist.")).toBeNull();
		const capped = Array.from({ length: 2000 }, (_, index) => `l${index}`);
		expect(wholeFileFromRead({}, numbered(capped.join("\n")))).toBeNull();
	});
});

describe("collectSessionFileChanges", () => {
	test("replays edits over a read: their lines, and the content after", () => {
		const { files } = collectSessionFileChanges([
			{
				agentId: "",
				calls: [
					call(
						"Read",
						{ file_path: "/r/a.ts" },
						{ content: numbered("one\ntwo\nthree"), isError: false },
					),
					call("Edit", {
						file_path: "/r/a.ts",
						new_string: "TWO",
						old_string: "two",
					}),
				],
				turnId: "t1",
			},
		]);
		expect(files).toHaveLength(1);
		const [file] = files;
		expect(file?.reads).toBe(1);
		expect(file?.readTurns).toEqual(["t1"]);
		expect(file?.readBy).toEqual([{ agentId: "", turnId: "t1" }]);
		expect(file?.content).toBe("one\nTWO\nthree\n");
		expect(file?.changes[0]).toMatchObject({
			after: "TWO",
			before: "two",
			line: 2,
			operation: "edited",
			tool: "edit",
			turnId: "t1",
		});
	});

	test("a write is the file's text; a later edit lands in it", () => {
		const { files } = collectSessionFileChanges([
			{
				agentId: "sub1",
				calls: [
					call(
						"Write",
						{ content: "x\ny\n", file_path: "/r/b.ts" },
						{
							content: "File created successfully at: /r/b.ts",
							isError: false,
						},
					),
					call("MultiEdit", {
						edits: [
							{ new_string: "Y", old_string: "y" },
							{ new_string: "X", old_string: "x" },
						],
						file_path: "/r/b.ts",
					}),
				],
				turnId: "t2",
			},
		]);
		const [file] = files;
		expect(file?.changes.map((change) => change.operation)).toEqual([
			"created",
			"edited",
			"edited",
		]);
		expect(file?.changes.map((change) => change.line)).toEqual([1, 2, 1]);
		expect(file?.changes[0]?.agentId).toBe("sub1");
		expect(file?.content).toBe("X\nY\n");
	});

	test("a failed edit changes nothing; an unknown text loses the content", () => {
		const { files } = collectSessionFileChanges([
			{
				agentId: "",
				calls: [
					call("Write", { content: "a\n", file_path: "/r/c.ts" }),
					call(
						"Edit",
						{ file_path: "/r/c.ts", new_string: "b", old_string: "a" },
						{ content: "error", isError: true },
					),
					call("Edit", {
						file_path: "/r/c.ts",
						new_string: "z",
						old_string: "missing",
					}),
				],
				turnId: "t1",
			},
		]);
		const [file] = files;
		expect(file?.changes[1]).toMatchObject({ failed: true, line: 1 });
		expect(file?.changes[2]?.line).toBeNull();
		expect(file?.content).toBeNull();
	});

	test("orders a file's changes by time across streams", () => {
		const late = call("Edit", {
			file_path: "/r/d.ts",
			new_string: "c",
			old_string: "b",
		});
		const early = call("Write", { content: "b\n", file_path: "/r/d.ts" });
		early.timestamp = "2026-10-21T09:00:00.000Z";
		const { files } = collectSessionFileChanges([
			{ agentId: "", calls: [late], turnId: "t2" },
			{ agentId: "sub", calls: [early], turnId: "t1" },
		]);
		expect(files[0]?.changes.map((change) => change.tool)).toEqual([
			"write",
			"edit",
		]);
		expect(files[0]?.content).toBe("c\n");
	});

	test("Codex's shell reads files as Claude's does", () => {
		const { files } = collectSessionFileChanges([
			{
				agentId: "",
				calls: [
					{
						...call("exec_command", { cmd: "cat /r/a.ts", workdir: "/r" }),
						activity: {
							files: [{ operation: "read", path: "/r/a.ts" }],
							status: "succeeded",
							verb: "Ran",
						},
						provider: "codex",
					},
				],
				turnId: "t1",
			},
		]);
		expect(files.map((file) => file.path)).toEqual(["/r/a.ts"]);
	});

	test("a shell command read as part of a search still reads its files", () => {
		const shell = {
			...call("Bash", { command: "ls; cat health-spec.ts" }),
			activity: {
				files: [{ operation: "read" as const, path: "health-spec.ts" }],
				status: "succeeded" as const,
				verb: "Ran",
			},
		};
		expect(traceStepOf(shell, "", "/r/health").kind).toBe("search");
		const { files } = collectSessionFileChanges([
			{ agentId: "", calls: [shell], directory: "/r/health", turnId: "t1" },
		]);
		expect(
			files.map((file) => ({ path: file.path, reads: file.reads })),
		).toEqual([{ path: "/r/health/health-spec.ts", reads: 1 }]);
	});

	test("files only read come after the ones changed", () => {
		const { files } = collectSessionFileChanges([
			{
				agentId: "",
				calls: [
					call("Read", { file_path: "/r/a-read.ts" }),
					call("Write", { content: "z", file_path: "/r/z-written.ts" }),
				],
				turnId: "t1",
			},
		]);
		expect(files.map((file) => file.path)).toEqual([
			"/r/z-written.ts",
			"/r/a-read.ts",
		]);
	});
});

describe("traceStepOf", () => {
	const at = "2026-10-21T10:00:00.000Z";
	test("says each call in a word", () => {
		const step = (
			toolName: string,
			input: Record<string, unknown>,
			files: { operation: string; path: string }[] = [],
		) =>
			traceStepOf(
				{
					activity: { files, status: "succeeded", verb: "Did" },
					id: toolName,
					input,
					timestamp: at,
					toolName,
				},
				"",
			);
		expect(
			step("Read", { file_path: "/r/a.ts" }, [
				{ operation: "read", path: "/r/a.ts" },
			]),
		).toMatchObject({ kind: "read", label: "a.ts" });
		expect(
			step("Edit", { file_path: "/r/a.ts" }, [
				{ operation: "edited", path: "/r/a.ts" },
			]),
		).toMatchObject({ kind: "edit", paths: ["/r/a.ts"] });
		expect(step("Bash", { command: "bun run check-types" })).toMatchObject({
			check: "typecheck",
			kind: "check",
		});
		expect(step("Bash", { command: "rg usageCalls src" }).kind).toBe("search");
		expect(
			step("Bash", { command: "cat src/a.ts" }, [
				{ operation: "read", path: "src/a.ts" },
			]).kind,
		).toBe("read");
		expect(step("Bash", { command: "git status" }).kind).toBe("git");
		expect(step("Task", { description: "port the diff view" })).toMatchObject({
			kind: "subagent",
			label: "port the diff view",
		});
	});
});

test("a search says its command, not the variables it set first", () => {
	const step = traceStepOf(
		{
			id: "s",
			input: { command: 'S=~/x; cd $S && rg "usageCalls" src' },
			timestamp: "2026-10-21T10:00:00.000Z",
			toolName: "Bash",
		},
		"",
	);
	expect(step).toMatchObject({ kind: "search", label: 'rg "usageCalls" src' });
});

describe("collectDerivationFileChanges", () => {
	const at = (second: number) =>
		new Date(Date.UTC(2026, 9, 21, 11, 0, second)).toISOString();
	const body: SessionDetailTurn = {
		responseItems: [
			{ content: "go", id: "user-1", kind: "user", timestamp: at(0) },
			{
				events: [
					{
						content: "Writing it.",
						id: "message-1",
						kind: "message",
						text: "Writing it.",
						timestamp: at(1),
					},
					{
						id: "write-1",
						input: { content: "a\n", file_path: "/r/main.ts" },
						kind: "tool",
						result: { content: "ok", isError: false },
						timestamp: at(2),
						toolName: "Write",
					},
				],
				executionMode: "default",
				id: "agent-1",
				kind: "agent",
				timestamp: at(1),
			},
		],
		revision: "r1",
		turnId: "t1",
		userItems: [],
	};
	const subagent = [
		{
			message: {
				content: [
					{
						id: "toolu_sub",
						input: { content: "s\n", file_path: "/r/sub.ts" },
						name: "Write",
						type: "tool_use",
					},
				],
				role: "assistant",
			},
			sessionId: "sub1",
			timestamp: at(3),
			type: "assistant",
			uuid: "sub-assistant",
		},
		{
			message: {
				content: [
					{ content: "ok", tool_use_id: "toolu_sub", type: "tool_result" },
				],
				role: "user",
			},
			sessionId: "sub1",
			timestamp: at(4),
			type: "user",
			uuid: "sub-user",
		},
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
	const derivation: Partial<SessionDetailDerivation> = {
		overviewBase: {
			session: { projectPath: "/r" },
		} as SessionDetailDerivation["overviewBase"],
		rawSubagents: { sub1: subagent },
		turnBodies: {
			get: (turnId: string) => (turnId === "t1" ? body : undefined),
		} as SessionDetailDerivation["turnBodies"],
		turnSummaries: [
			{ subagentEvents: [{ subagentId: "sub1" }], turnId: "t1" },
		] as unknown as SessionDetailDerivation["turnSummaries"],
	};

	test("reads the tool calls of the turns' agents and of each subagent's transcript", () => {
		const { files, runs } = collectDerivationFileChanges(
			derivation as SessionDetailDerivation,
		);
		expect(
			files.map((file) => ({
				agents: file.changes.map((change) => change.agentId),
				content: file.content,
				path: file.path,
				turns: file.changes.map((change) => change.turnId),
			})),
		).toEqual([
			{ agents: [""], content: "a\n", path: "/r/main.ts", turns: ["t1"] },
			{ agents: ["sub1"], content: "s\n", path: "/r/sub.ts", turns: ["t1"] },
		]);
		expect(runs.length).toBeGreaterThan(0);
	});
});
