import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildConversationTrace, parseConversations } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationTrace } from "./ConversationTrace";
import {
	createTraceExpansionStore,
	TraceExpansionStoreProvider,
} from "./expandable-trace-row";

function line(value: Readonly<Record<string, unknown>>) {
	return JSON.stringify(value);
}

const CLAUDE_COLLISION_TRANSCRIPT = [
	line({
		message: { content: "Inspect the collision fixture", role: "user" },
		sessionId: "claude-collision-session",
		timestamp: "2026-08-21T09:00:00.000Z",
		type: "user",
		uuid: "claude-user-1",
	}),
	line({
		message: {
			content: [
				{
					thinking: "Keep Claude semantics despite Codex-looking names.",
					type: "thinking",
				},
				{
					id: "claude-tool-patch",
					input: {
						__rudel_codex_correlation: { success: true },
						input:
							"*** Begin Patch\n*** Add File: collision.ts\n+export const collision = true;\n*** End Patch",
					},
					name: "apply_patch",
					type: "tool_use",
				},
				{
					id: "claude-tool-exec",
					input: { cmd: "sed -n '1,20p' collision.ts" },
					name: "exec_command",
					type: "tool_use",
				},
				{
					id: "claude-tool-view",
					input: { path: "art/collision.png" },
					name: "view_image",
					type: "tool_use",
				},
				{ text: "Claude response after the tools.", type: "text" },
			],
			role: "assistant",
		},
		sessionId: "claude-collision-session",
		timestamp: "2026-08-21T09:00:01.000Z",
		type: "assistant",
		uuid: "claude-assistant-1",
	}),
	line({
		message: {
			content: [
				{
					content: "Patch result",
					tool_use_id: "claude-tool-patch",
					type: "tool_result",
				},
				{
					content: "Command result",
					tool_use_id: "claude-tool-exec",
					type: "tool_result",
				},
				{
					content: "Image result",
					tool_use_id: "claude-tool-view",
					type: "tool_result",
				},
			],
			role: "user",
		},
		sessionId: "claude-collision-session",
		timestamp: "2026-08-21T09:00:02.000Z",
		type: "user",
		uuid: "claude-results-1",
	}),
].join("\n");

describe("Claude rendered transcript golden", () => {
	test("pins the full collision transcript with explicit Claude provenance", () => {
		const conversations = parseConversations(CLAUDE_COLLISION_TRANSCRIPT);
		expect(
			conversations.every(
				(entry) => entry.type === "summary" || entry.provider === "claude",
			),
		).toBe(true);
		const items = buildConversationTrace(conversations);
		const store = createTraceExpansionStore();
		for (const item of items) {
			if (item.kind === "agent") {
				for (const event of item.events) {
					store.setExpanded(event.id, true);
				}
			}
		}
		const markup = renderToStaticMarkup(
			<TraceExpansionStoreProvider store={store}>
				<ConversationTrace agentSectionMode="expanded" items={items} />
			</TraceExpansionStoreProvider>,
		);

		expect(markup).toContain("Claude response after the tools.");
		expect(markup).toContain("Patch result");
		expect(markup).toContain("Command result");
		expect(markup).toContain("Image result");
		expect(markup).toContain(">Reasoning<");
		expect(markup).not.toContain("Reasoning summary");
		expect(markup).not.toContain(">Wrote<");
		expect(markup).not.toContain(">Read<");
		expect(createHash("sha256").update(markup).digest("hex")).toBe(
			"bdd065da906e1723964dab2c73cfda4a1f196e46ddcdd7fac31b3a914b038f1d",
		);
	});
});
