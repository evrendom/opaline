import { describe, expect, test } from "bun:test";
import {
	attachCodexCorrelation,
	buildConversationTrace,
	getTranscriptToolFileActivities,
	parseCodexConversations,
} from "@rudel/api-routes";
import type { TraceEvent } from "@/components/conversation/conversation-trace";
import { deriveTranscriptSectionFoldMetadata } from "./session-transcript-folds";

function toolEvent(
	id: string,
	toolName: string,
	input: Record<string, unknown>,
	provider: "claude" | "codex" | undefined = undefined,
): Extract<TraceEvent, { kind: "tool" }> {
	return {
		id,
		input,
		kind: "tool",
		provider,
		result: undefined,
		timestamp: "2026-08-01T10:00:00.000Z",
		toolName,
	};
}

function permutations<T>(values: readonly T[]): T[][] {
	if (values.length < 2) return [[...values]];
	return values.flatMap((value, index) =>
		permutations(values.filter((_, valueIndex) => valueIndex !== index)).map(
			(remainder) => [value, ...remainder],
		),
	);
}

describe("Codex transcript fold counters", () => {
	test("counts the same per-file facts that semantic cards derive", () => {
		const events: TraceEvent[] = [
			toolEvent(
				"patch",
				"apply_patch",
				attachCodexCorrelation(
					{
						input: `*** Begin Patch
*** Add File: src/new.ts
+new
*** Update File: src/old.ts
@@
-old
+new
*** Delete File: src/gone.ts
-gone
*** End Patch`,
					},
					undefined,
				),
				"codex",
			),
			toolEvent(
				"codex-view",
				"view_image",
				attachCodexCorrelation({ path: "art/codex.png" }, undefined),
				"codex",
			),
			toolEvent("claude-view", "Read", { file_path: "art/claude.png" }),
			toolEvent("claude-read", "Read", { file_path: "src/claude.ts" }),
			toolEvent(
				"codex-read",
				"exec_command",
				attachCodexCorrelation({ cmd: "cat src/codex.ts" }, undefined),
				"codex",
			),
		];

		expect(
			deriveTranscriptSectionFoldMetadata(events, "group", false),
		).toMatchObject({
			filesEdited: 2,
			filesRead: 2,
			filesViewed: 2,
			filesWritten: 1,
			toolCalls: 5,
		});
	});

	test("does not count structured patch changes when success is false", () => {
		const event = toolEvent(
			"failed-patch",
			"apply_patch",
			attachCodexCorrelation(
				{
					input: "*** Begin Patch\n*** Add File: guessed.ts\n+x\n*** End Patch",
				},
				{
					changes: {
						"/repo/failed.ts": {
							move_path: null,
							type: "add",
							unified_diff: "+x",
						},
					},
					success: false,
				},
			),
			"codex",
		);

		expect(
			deriveTranscriptSectionFoldMetadata([event], "group", false),
		).toMatchObject({
			filesEdited: 0,
			filesRead: 0,
			filesViewed: 0,
			filesWritten: 0,
		});
	});

	test("ignores a Claude apply-patch collision carrying the legacy marker", () => {
		const collision = toolEvent(
			"claude-collision",
			"apply_patch",
			{
				__rudel_codex_correlation: { success: true },
				input: "*** Begin Patch\n*** Add File: collision.ts\n+x\n*** End Patch",
			},
			"claude",
		);

		expect(
			getTranscriptToolFileActivities(
				collision.toolName,
				collision.input,
				collision.provider,
			),
		).toEqual([]);
		expect(
			deriveTranscriptSectionFoldMetadata([collision], "group", false),
		).toMatchObject({
			filesEdited: 0,
			filesRead: 0,
			filesViewed: 0,
			filesWritten: 0,
		});
	});

	test("keeps card facts and fold counters equal across generated operation orders", () => {
		const patch =
			"*** Begin Patch\n*** Add File: src/new.ts\n+new\n*** End Patch";
		const operations = [
			'await tools.exec_command({ cmd: "cat src/read.ts" });',
			'await tools.view_image({ path: "art/shot.png" });',
			`await tools.apply_patch(${JSON.stringify(patch)});`,
		];

		for (const [index, orderedOperations] of permutations(
			operations,
		).entries()) {
			const callId = `outer-${index}`;
			const content = [
				JSON.stringify({
					payload: { id: `generated-${index}` },
					timestamp: "2026-08-01T09:59:59.000Z",
					type: "session_meta",
				}),
				JSON.stringify({
					payload: {
						call_id: callId,
						input: orderedOperations.join("\n"),
						name: "exec",
						type: "custom_tool_call",
					},
					timestamp: "2026-08-01T10:00:00.000Z",
					type: "response_item",
				}),
				JSON.stringify({
					payload: {
						call_id: callId,
						output: "done",
						type: "custom_tool_call_output",
					},
					timestamp: "2026-08-01T10:00:01.000Z",
					type: "response_item",
				}),
			].join("\n");
			const events = buildConversationTrace(parseCodexConversations(content))
				.flatMap((item) => (item.kind === "agent" ? item.events : []))
				.filter(
					(event): event is Extract<TraceEvent, { kind: "tool" }> =>
						event.kind === "tool",
				);
			const facts = events.flatMap((event) =>
				getTranscriptToolFileActivities(
					event.toolName,
					event.input,
					event.provider,
				),
			);

			expect(facts.map((fact) => fact.operation).sort()).toEqual([
				"created",
				"read",
				"viewed",
			]);
			expect(
				deriveTranscriptSectionFoldMetadata(events, "group", false),
			).toMatchObject({
				filesEdited: 0,
				filesRead: 1,
				filesViewed: 1,
				filesWritten: 1,
				toolCalls: 3,
			});
		}
	});
});
