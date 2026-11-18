import { describe, expect, test } from "bun:test";
import { ok as assert } from "node:assert";
import { buildConversationTrace, parseConversations } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationTrace } from "./ConversationTrace";
import type { TraceEvent } from "./conversation-trace";
import { ConversationTraceInteractionEpisodeRow } from "./conversation-trace-event-row";
import { groupConsecutiveInteractionEpisodes } from "./conversation-trace-interaction-episodes";
import {
	createTraceExpansionStore,
	TraceExpansionIdProvider,
	TraceExpansionStoreProvider,
} from "./expandable-trace-row";

function line(value: Readonly<Record<string, unknown>>) {
	return JSON.stringify(value);
}

function p0ShapedTranscript() {
	const browserClientCode = `if (globalThis.agent?.browsers == null) {
  const { setupBrowserRuntime } = await import("/plugins/chrome/scripts/browser-client.mjs");
  globalThis.agent = await setupBrowserRuntime();
}
globalThis.browser = await agent.browsers.getForUrl("https://app.instantly.ai/");`;
	return [
		line({
			payload: { id: "01a01f2a-d5a1-7ab3-aa81-9266d596d632" },
			timestamp: "2026-08-20T12:35:20.000Z",
			type: "session_meta",
		}),
		line({
			payload: {
				call_id: "outer-connect",
				input: `const result = await tools.mcp__node_repl__js(${JSON.stringify({ code: browserClientCode, title: "Connect to Instantly" })});`,
				name: "exec",
				type: "custom_tool_call",
			},
			timestamp: "2026-08-20T12:35:23.854Z",
			type: "response_item",
		}),
		line({
			payload: {
				call_id: "inner-connect",
				invocation: {
					arguments: { code: browserClientCode, title: "Connect to Instantly" },
					server: "node_repl",
					tool: "js",
				},
				result: {
					Ok: {
						content: [{ text: "No browser is available", type: "text" }],
						isError: true,
					},
				},
				type: "mcp_tool_call_end",
			},
			timestamp: "2026-08-20T12:35:24.215Z",
			type: "event_msg",
		}),
		line({
			payload: {
				call_id: "outer-connect",
				output: "No browser is available",
				type: "custom_tool_call_output",
			},
			timestamp: "2026-08-20T12:35:24.300Z",
			type: "response_item",
		}),
		line({
			payload: {
				call_id: "outer-document",
				input:
					'const result = await tools.mcp__node_repl__js({ title: "Inspect Instantly", code: "nodeRepl.write(await browser.documentation());" });',
				name: "exec",
				type: "custom_tool_call",
			},
			timestamp: "2026-08-20T12:35:25.000Z",
			type: "response_item",
		}),
		line({
			payload: {
				call_id: "outer-document",
				output: [
					{ text: "Instantly sign in", type: "text" },
					{ image_url: "data:image/png;base64,AAAA", type: "image" },
				],
				type: "custom_tool_call_output",
			},
			timestamp: "2026-08-20T12:35:25.300Z",
			type: "response_item",
		}),
	].join("\n");
}

function interactionEvent(
	index: number,
): Extract<TraceEvent, { kind: "tool" }> {
	return {
		id: `interaction-${index}`,
		input: {
			__rudel_codex_operation: {
				computerUseTarget: "Browser",
				operationId: `operation-${index}`,
				provider: "codex",
			},
		},
		kind: "tool",
		provider: "codex",
		result: undefined,
		timestamp: "2026-08-20T12:35:25.000Z",
		toolName: "mcp__node_repl__js",
	};
}

describe("Codex interaction episode presentation", () => {
	test("groups consecutive browser-runtime calls while retaining failures and screenshots on expand", () => {
		const items = buildConversationTrace(
			parseConversations(p0ShapedTranscript()),
		);
		const agent = items.find((item) => item.kind === "agent");
		expect(agent?.kind).toBe("agent");
		const events = agent?.kind === "agent" ? agent.events : [];
		const presented = groupConsecutiveInteractionEpisodes(events);
		expect(presented).toMatchObject([
			{
				events: [{ provider: "codex" }, { provider: "codex" }],
				isError: true,
				kind: "interaction-episode",
				target: "computer",
			},
		]);
		const episode = presented[0];
		expect(episode?.kind).toBe("interaction-episode");
		assert(episode?.kind === "interaction-episode");
		const store = createTraceExpansionStore();
		store.setExpanded(episode.id, true);
		for (const event of episode.events) {
			store.setExpanded(event.id, true);
		}
		const markup = renderToStaticMarkup(
			<TraceExpansionStoreProvider store={store}>
				<ConversationTrace agentSectionMode="expanded" items={items} />
			</TraceExpansionStoreProvider>,
		);

		expect(
			markup.match(/data-trace-interaction-episode="true"/gu),
		).toHaveLength(1);
		expect(markup).toContain('data-trace-interaction-episode-size="2"');
		expect(markup).toContain("Interacted with");
		expect(markup).toContain("computer");
		expect(markup).toContain("No browser is available");
		expect(markup).toContain("data:image/png;base64,AAAA");
		expect(markup).toContain('data-trace-icon-tone="tomato"');
		expect(markup).not.toContain("Used external tool");
		const traceTreeMarkup = renderToStaticMarkup(
			<TraceExpansionStoreProvider store={store}>
				<ConversationTrace expandedSpeakerLayout="trace-tree" items={items} />
			</TraceExpansionStoreProvider>,
		);
		expect(
			traceTreeMarkup.match(/data-trace-interaction-episode="true"/gu),
		).toHaveLength(1);
		expect(traceTreeMarkup).not.toContain("Used external tool");
	});

	test("groups a 1,200-operation episode linearly and bounds expanded child rendering", () => {
		const events = Array.from({ length: 1_200 }, (_, index) =>
			interactionEvent(index),
		);
		const startedAt = performance.now();
		const presented = groupConsecutiveInteractionEpisodes(events);
		const elapsedMs = performance.now() - startedAt;

		expect(elapsedMs).toBeLessThan(500);
		expect(presented).toHaveLength(1);
		const episode = presented[0];
		expect(episode?.kind).toBe("interaction-episode");
		assert(episode?.kind === "interaction-episode");
		expect(episode.events).toHaveLength(1_200);
		expect(episode.events[0]).toBe(events[0]);
		expect(episode.events.at(-1)).toBe(events.at(-1));
		expect(Object.isFrozen(episode.events)).toBe(true);

		const store = createTraceExpansionStore();
		store.setExpanded(episode.id, true);
		const markup = renderToStaticMarkup(
			<TraceExpansionStoreProvider store={store}>
				<TraceExpansionIdProvider expansionId={episode.id}>
					<ConversationTraceInteractionEpisodeRow episode={episode} />
				</TraceExpansionIdProvider>
			</TraceExpansionStoreProvider>,
		);
		expect(markup).toContain('data-trace-interaction-episode-window="100"');
		expect(markup).toContain("1,100 remaining");
		expect(markup).not.toContain("operation-1199");
	});
});
