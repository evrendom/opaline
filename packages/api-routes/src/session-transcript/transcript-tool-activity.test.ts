import { expect, test } from "bun:test";
import { ok as assert } from "node:assert";
import { SessionDetailTraceItemSchema } from "../schemas/session-detail-payload.js";
import { parseCodexConversations } from "./codex-conversation-parser.js";
import {
	classifySimpleShellCommand,
	translateCodexToolCall,
} from "./codex-tool-translation.js";
import { buildConversationTrace } from "./conversation-trace.js";
import { deriveTranscriptToolActivity } from "./transcript-tool-activity.js";
import { readTranscriptToolOutputText } from "./transcript-tool-output.js";

const skillPath = "/repo/.claude/skills/testing-bun/SKILL.md";

test("Claude skill invocation and Codex skill read share the same semantic identity", () => {
	const claude = deriveTranscriptToolActivity({
		toolName: "Skill",
		input: { skill: "testing-bun" },
		provider: "claude",
	});
	const codex = deriveTranscriptToolActivity({
		toolName: "exec_command",
		input: { cmd: `cat ${skillPath}` },
		provider: "codex",
	});
	expect(claude.kind).toBe("skill");
	expect(codex.kind).toBe("skill");
	expect(codex.skills).toEqual(claude.skills);
	expect(codex.files).toEqual([{ operation: "read", path: skillPath }]);
	expect(codex.verb).toBe("Loaded skill");
	expect(claude.verb).toBe("Used skill");
});

test("one compound call retains every read, search and execution action without inflating tool calls", () => {
	const activity = deriveTranscriptToolActivity({
		toolName: "exec_command",
		provider: "codex",
		input: {
			cmd: `wc -l ${skillPath}; cat ${skillPath}\nsed -n '1,20p' src/a.ts && rg 'left|right' src`,
		},
	});
	expect(activity.skills).toEqual(["testing-bun"]);
	expect(activity.actions.map((action) => action.kind)).toEqual([
		"executing",
		"skill",
		"reading",
		"searching",
	]);
	expect(activity.files).toEqual([
		{ operation: "read", path: skillPath },
		{ operation: "read", path: "src/a.ts" },
	]);
	expect(
		classifySimpleShellCommand("cat a.ts b.ts").files.map((file) => file.path),
	).toEqual(["a.ts", "b.ts"]);
});

test("references to skill paths and dynamic shell expressions do not invent skill loads", () => {
	for (const cmd of [
		`rg '${skillPath}' src`,
		`echo '${skillPath}'`,
		`cat "$SKILL_ROOT/testing-bun/SKILL.md"`,
		`if false; then cat ${skillPath}; fi`,
		`cat ${skillPath} > copy.md`,
	]) {
		expect(
			deriveTranscriptToolActivity({
				toolName: "exec_command",
				provider: "codex",
				input: { cmd },
			}).skills,
		).toEqual([]);
	}
	expect(classifySimpleShellCommand("rg 'left;right' src").activity).toBe(
		"searching",
	);
});

test("web and agent actions preserve their actual operation and target", () => {
	expect(
		translateCodexToolCall("web__run", {
			open: [{ ref_id: "https://example.com" }],
		}),
	).toMatchObject({ verb: "Opened", primaryLabel: "https://example.com" });
	expect(
		deriveTranscriptToolActivity({
			toolName: "web__run",
			provider: "codex",
			input: {
				open: [{ ref_id: "page1" }],
				find: [{ ref_id: "page1", pattern: "needle" }],
			},
		}).actions,
	).toEqual([
		{ kind: "web-research", verb: "Opened", targets: ["page1"] },
		{ kind: "web-research", verb: "Found in page", targets: ["needle"] },
	]);
	expect(
		translateCodexToolCall("collaboration.send_message", {
			target: "reviewer",
			message: "Review this",
		}),
	).toMatchObject({ verb: "Messaged agent", primaryLabel: "reviewer" });
	expect(
		translateCodexToolCall("collaboration.wait_agent", { target: "reviewer" })
			.verb,
	).toBe("Waited for agent");
});

test("batched output survives serialization once without being attributed to an arbitrary call", () => {
	const timestamp = "2026-09-13T10:00:00.000Z";
	const lines = [
		{ type: "session_meta", payload: { id: "batch-session" } },
		{
			type: "response_item",
			payload: {
				type: "custom_tool_call",
				call_id: "batch-one",
				name: "exec",
				input:
					'text(await tools.exec_command({cmd:"cat a.ts"})); text(await tools.exec_command({cmd:"cat b.ts"}));',
			},
		},
		{
			type: "response_item",
			payload: {
				type: "custom_tool_call_output",
				call_id: "batch-one",
				output: [
					{ type: "input_text", text: "shared output for a and b" },
					{ type: "input_image", image_url: "data:image/png;base64,AAAA" },
				],
			},
		},
	]
		.map((line) => JSON.stringify({ timestamp, ...line }))
		.join("\n");
	const trace = buildConversationTrace(parseCodexConversations(lines));
	const serialized: unknown = JSON.parse(JSON.stringify(trace));
	assert(Array.isArray(serialized));
	const parsed = serialized.map((item) =>
		SessionDetailTraceItemSchema.parse(item),
	);
	const events = parsed.flatMap((item) =>
		item.kind === "agent" ? item.events : [],
	);
	const tools = events.filter((event) => event.kind === "tool");
	expect(tools).toHaveLength(2);
	expect(tools.every((event) => event.result === undefined)).toBe(true);
	expect(
		tools.every(
			(event) => event.activity?.sharedResultId === "batch:batch-one",
		),
	).toBe(true);
	const shared = events.find((event) => event.kind === "orphan-result");
	assert(shared?.kind === "orphan-result");
	expect(shared.result.batch?.toolIds).toEqual(tools.map((event) => event.id));
	expect(shared.result.content).toHaveLength(2);
	expect(
		JSON.stringify(parsed).match(/shared output for a and b/gu),
	).toHaveLength(1);
});

test("display text unwraps recorded tool transport without hiding non-text output", () => {
	expect(
		readTranscriptToolOutputText([
			{
				type: "text",
				text: "Script completed\nWall time 0.1 seconds\nOutput:\n",
			},
			{
				type: "structured",
				value: { output: "# Skill\nUse tests.", exit_code: 0 },
			},
		]),
	).toBe("# Skill\nUse tests.");
	expect(
		readTranscriptToolOutputText([{ type: "image", source: "image.png" }]),
	).toBeUndefined();
});

test("a batch with no recorded output does not promise a shared result", () => {
	const lines = [
		{
			timestamp: "2026-09-13T10:00:00.000Z",
			type: "response_item",
			payload: {
				type: "custom_tool_call",
				name: "exec",
				call_id: "unfinished",
				input:
					'await tools.exec_command({cmd:"pwd"}); await tools.exec_command({cmd:"ls"});',
			},
		},
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
	const events = buildConversationTrace(parseCodexConversations(lines)).flatMap(
		(item) => (item.kind === "agent" ? item.events : []),
	);
	expect(events).toHaveLength(2);
	for (const event of events) {
		assert(event.kind === "tool");
		expect(event.activity?.status).toBe("unrecorded");
		expect(event.activity?.sharedResultId).toBeUndefined();
	}
});

test("shell comments and line continuations do not invent extra file or skill reads", () => {
	const activity = deriveTranscriptToolActivity({
		toolName: "exec_command",
		provider: "codex",
		input: {
			cmd: `# ignored; cat ${skillPath}\ncat real.ts # not-a-file\ncat a.ts \\\n b.ts`,
		},
	});
	expect(activity.skills).toEqual([]);
	expect(activity.files.map((file) => file.path)).toEqual([
		"real.ts",
		"a.ts",
		"b.ts",
	]);
});
