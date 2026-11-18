import { describe, expect, test } from "bun:test";
import { parseCodexConversations } from "./codex-conversation-parser.js";
import {
	getTranscriptToolFileActivities,
	translateCodexToolCall,
} from "./codex-tool-translation.js";
import {
	buildConversationTrace,
	type TraceEvent,
} from "./conversation-trace.js";

const fixtureUrl = (name: string) =>
	new URL(`./__fixtures__/${name}`, import.meta.url);

async function readFixture(name: string) {
	return Bun.file(fixtureUrl(name)).text();
}

function toolEvents(content: string) {
	return buildConversationTrace(parseCodexConversations(content)).flatMap(
		(item) =>
			item.kind === "agent"
				? item.events.filter(
						(event): event is Extract<TraceEvent, { kind: "tool" }> =>
							event.kind === "tool",
					)
				: [],
	);
}

describe("Codex era fixtures", () => {
	test("direct era retains genuine prompts and translates direct carriers", async () => {
		const content = await readFixture("codex-direct-era.jsonl");
		const conversations = parseCodexConversations(content);
		const memberPrompts = conversations.flatMap((entry) =>
			entry.type === "user" && typeof entry.message.content === "string"
				? [entry.message.content]
				: [],
		);
		const events = toolEvents(content);
		const read = events.find((event) => event.toolName === "exec_command");
		const patch = events.find((event) => event.toolName === "apply_patch");
		const failure = events.find(
			(event) => event.input.cmd === "missing-command",
		);

		expect(memberPrompts).toEqual(["inspect the session"]);
		expect(
			conversations.filter(
				(entry) =>
					entry.type === "assistant" &&
					entry.message.content.some((block) => block.type === "thinking"),
			),
		).toHaveLength(1);
		expect(
			read && translateCodexToolCall(read.toolName, read.input),
		).toMatchObject({
			activity: "reading",
			primaryLabel: "app.ts (1–220)",
		});
		expect(
			patch && translateCodexToolCall(patch.toolName, patch.input).files,
		).toHaveLength(3);
		expect(failure?.result?.isError).toBe(true);
	});

	test("end-event era prefers authoritative classifications, diffs, and failures", async () => {
		const content = await readFixture("codex-end-event-era.jsonl");
		const conversations = parseCodexConversations(content);
		const events = toolEvents(content);
		const structuredRead = events.find(
			(event) => event.input.cmd === "printf source",
		);
		const patches = events.filter((event) => event.toolName === "apply_patch");
		const systemMessages = conversations.flatMap((entry) =>
			entry.type === "system" && "message" in entry
				? [entry.message.content]
				: [],
		);

		expect(
			structuredRead &&
				translateCodexToolCall(structuredRead.toolName, structuredRead.input),
		).toMatchObject({
			activity: "reading",
			exitCode: 0,
			files: [{ path: "/repo/src/real.ts" }],
		});
		expect(
			patches[0] &&
				translateCodexToolCall(patches[0].toolName, patches[0].input),
		).toMatchObject({
			files: [
				{
					diff: "@@ -1 +1 @@\n-old\n+new",
					movePath: "/repo/src/moved.ts",
					path: "/repo/src/real.ts",
				},
			],
			success: true,
		});
		expect(patches[1]?.result?.isError).toBe(true);
		expect(systemMessages).toEqual([
			"Error: transport disconnected",
			"Thread rolled back",
		]);
	});

	test("current era expands literal cells and literal command arrays", async () => {
		const directEvents = toolEvents(
			await readFixture("codex-direct-era.jsonl"),
		);
		const currentContent = await readFixture("codex-custom-exec-era.jsonl");
		const currentEvents = toolEvents(currentContent);
		const directRead = directEvents.find(
			(event) => event.input.cmd === "sed -n '1,220p' src/app.ts",
		);
		const literalRead = currentEvents.find(
			(event) => event.input.cmd === "sed -n '1,220p' src/app.ts",
		);
		const expandedCommands = currentEvents.filter(
			(event) => event.input.cmd === "pwd" || event.input.cmd === "ls",
		);
		const web = currentEvents.find(
			(event) => event.toolName === "web_search_call",
		);

		const directTranslation = directRead
			? translateCodexToolCall(directRead.toolName, directRead.input)
			: undefined;
		const literalTranslation = literalRead
			? translateCodexToolCall(literalRead.toolName, literalRead.input)
			: undefined;
		expect(literalTranslation).toMatchObject({
			activity: directTranslation?.activity,
			files: directTranslation?.files,
			primaryLabel: directTranslation?.primaryLabel,
		});
		expect(expandedCommands).toHaveLength(2);
		expect(
			expandedCommands.map((event) =>
				translateCodexToolCall(event.toolName, event.input),
			),
		).toMatchObject([
			{ activity: "executing", verb: "Ran" },
			{ activity: "executing", verb: "Ran" },
		]);
		expect(
			web && translateCodexToolCall(web.toolName, web.input),
		).toMatchObject({
			activity: "web-research",
			primaryLabel: "official docs",
			verb: "Searched",
		});
		expect(
			parseCodexConversations(currentContent).some(
				(entry) =>
					entry.type === "system" &&
					"message" in entry &&
					entry.message.content === "Context compacted",
			),
		).toBe(true);
	});

	test("orphan results remain visible and never attach to another call", () => {
		const content = [
			JSON.stringify({
				payload: { id: "orphan" },
				timestamp: "2026-08-01T10:00:00.000Z",
				type: "session_meta",
			}),
			JSON.stringify({
				payload: {
					call_id: "missing-call",
					output: "orphan output",
					type: "function_call_output",
				},
				timestamp: "2026-08-01T10:00:01.000Z",
				type: "response_item",
			}),
		].join("\n");

		const events = buildConversationTrace(
			parseCodexConversations(content),
		).flatMap((item) => (item.kind === "agent" ? item.events : []));
		expect(events).toHaveLength(1);
		expect(events[0]?.kind).toBe("orphan-result");
	});

	test("keeps the complete operation stream and ledger invariant across direct and custom-exec eras", () => {
		const patch =
			"*** Begin Patch\n*** Add File: src/new.ts\n+new\n*** End Patch";
		const direct = [
			JSON.stringify({
				payload: {
					arguments: JSON.stringify({ cmd: "cat src/app.ts" }),
					call_id: "direct-read",
					name: "exec_command",
					type: "function_call",
				},
				timestamp: "2026-08-01T10:00:00.000Z",
				type: "response_item",
			}),
			JSON.stringify({
				payload: {
					call_id: "direct-patch",
					input: patch,
					name: "apply_patch",
					type: "custom_tool_call",
				},
				timestamp: "2026-08-01T10:00:01.000Z",
				type: "response_item",
			}),
		].join("\n");
		const custom = JSON.stringify({
			payload: {
				call_id: "outer",
				input: `await tools.exec_command({ cmd: "cat src/app.ts" });\nawait tools.apply_patch(${JSON.stringify(patch)});`,
				name: "exec",
				type: "custom_tool_call",
			},
			timestamp: "2026-08-01T10:00:00.000Z",
			type: "response_item",
		});
		const derive = (content: string) =>
			toolEvents(content).map((event) => {
				const translation = translateCodexToolCall(event.toolName, event.input);
				return {
					activity: translation.activity,
					files: getTranscriptToolFileActivities(
						event.toolName,
						event.input,
						event.provider,
					),
					verb: translation.verb,
				};
			});

		expect(derive(custom)).toEqual(derive(direct));
	});
});
