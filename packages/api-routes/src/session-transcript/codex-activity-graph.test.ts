import { describe, expect, test } from "bun:test";
import {
	attachCodexOperationMetadata,
	buildCodexActivityGraph,
} from "./codex-activity-graph.js";
import { parseCodexConversations } from "./codex-conversation-parser.js";
import { translateCodexToolCall } from "./codex-tool-translation.js";
import { buildConversationTrace } from "./conversation-trace.js";

function transcript(lines: readonly Record<string, unknown>[]) {
	return lines.map((line) => JSON.stringify(line)).join("\n");
}

describe("Codex normalized activity graph", () => {
	test("emits every nested operation and correlates a compatible inner lifecycle positionally", () => {
		const graph = buildCodexActivityGraph(
			transcript([
				{
					payload: {
						call_id: "outer",
						input: `await tools.exec_command({ cmd: "rg --files" });
await tools.apply_patch("*** Begin Patch\\n*** Add File: a.ts\\n+x\\n*** End Patch");`,
						name: "exec",
						type: "custom_tool_call",
					},
					timestamp: "2026-08-21T10:00:00.000Z",
					type: "response_item",
				},
				{
					payload: {
						call_id: "inner-patch",
						changes: { "a.ts": { type: "add", unified_diff: "+x" } },
						success: true,
						type: "patch_apply_end",
					},
					timestamp: "2026-08-21T10:00:01.000Z",
					type: "event_msg",
				},
				{
					payload: {
						call_id: "outer",
						output: [
							{ text: "done", type: "input_text" },
							{ image_url: "data:image/png;base64,AAAA", type: "input_image" },
						],
						type: "custom_tool_call_output",
					},
					timestamp: "2026-08-21T10:00:02.000Z",
					type: "response_item",
				},
			]),
		);

		expect(graph.carriers).toHaveLength(1);
		expect(
			graph.carriers[0]?.operations.map((operation) => operation.name),
		).toEqual(["exec_command", "apply_patch"]);
		expect(graph.carriers[0]?.operations[1]?.correlation).toBe("positional");
		expect(graph.carriers[0]?.outputBlocks.map((block) => block.type)).toEqual([
			"text",
			"image",
		]);
		expect(
			graph.carriers[0]?.operations.flatMap((operation) =>
				operation.outputBlocks.map((block) => block.type),
			),
		).toEqual(["text", "image"]);
	});

	test("recognizes computer use from MCP lifecycle metadata without classifying every node call", () => {
		const content = transcript([
			{
				payload: {
					call_id: "outer",
					input: `const result = await tools.mcp__node_repl__js({ code: "await sky.get_app_state({ app: 'chrome' })" });
for (const block of result.content ?? []) image(block.image_url);`,
					name: "exec",
					type: "custom_tool_call",
				},
				timestamp: "2026-08-21T10:00:00.000Z",
				type: "response_item",
			},
			{
				payload: {
					call_id: "inner-mcp",
					result: {
						Ok: {
							_meta: {
								"codex/toolSurface": { kind: "browserUse" },
							},
							content: [
								{
									image_url: "data:image/png;base64,AAAA",
									type: "input_image",
								},
							],
						},
					},
					type: "mcp_tool_call_end",
				},
				timestamp: "2026-08-21T10:00:01.000Z",
				type: "event_msg",
			},
			{
				payload: {
					call_id: "outer",
					output: "done",
					type: "custom_tool_call_output",
				},
				timestamp: "2026-08-21T10:00:02.000Z",
				type: "response_item",
			},
		]);
		const graph = buildCodexActivityGraph(content);

		expect(graph.carriers[0]?.operations).toMatchObject([
			{
				computerUseTarget: "chrome",
				correlation: "positional",
				name: "mcp__node_repl__js",
				outputBlocks: [{ type: "image" }, { type: "text" }],
				outputScope: "mixed",
			},
		]);
		const operation = graph.carriers[0]?.operations[0];
		const carrier = graph.carriers[0];
		expect(
			operation &&
				translateCodexToolCall(
					operation.name,
					attachCodexOperationMetadata(operation.input, operation, carrier),
				),
		).toMatchObject({
			activity: "interacting",
			primaryLabel: "chrome",
			verb: "Interacted with",
		});
		const serializedConversation = JSON.stringify(
			parseCodexConversations(content),
		);
		expect(
			serializedConversation.match(/data:image\/png;base64,AAAA/gu),
		).toHaveLength(1);
		expect(serializedConversation).not.toContain("codex/toolSurface");
	});

	test("classifies lexed browser-runtime families without inspecting strings or comments", () => {
		const browserCells = [
			`const { setupBrowserRuntime } = await import("/plugins/chrome/scripts/browser-client.mjs");`,
			`await import("@oai/sky");`,
			`globalThis.browser = await agent.browsers.getForUrl("https://app.instantly.ai/");`,
			`nodeRepl.write(await browser.documentation());`,
			`var pw = await import("playwright"); var browserAudit = await pw.chromium.launch(); var pageAudit = await browserAudit.newPage(); await pageAudit.goto("https://example.com"); await pageAudit.screenshot();`,
		] as const;
		for (const [index, code] of browserCells.entries()) {
			const graph = buildCodexActivityGraph(
				transcript([
					{
						payload: {
							call_id: `outer-${index}`,
							input: `await tools.mcp__node_repl__js(${JSON.stringify({ code, title: "Connect to Instantly" })});`,
							name: "exec",
							type: "custom_tool_call",
						},
						timestamp: "2026-08-20T12:35:23.854Z",
						type: "response_item",
					},
				]),
			);
			const operation = graph.carriers[0]?.operations[0];
			const carrier = graph.carriers[0];

			expect(operation?.computerUseTarget).toBe("computer");
			expect(
				operation &&
					translateCodexToolCall(
						operation.name,
						attachCodexOperationMetadata(operation.input, operation, carrier),
					),
			).toMatchObject({ activity: "interacting", verb: "Interacted with" });
		}

		const ordinaryCells = [
			{
				code: "const total = values.reduce((sum, value) => sum + value, 0);",
			},
			{ code: 'const note = "browser.click(";' },
			{ code: "// browser.click({ x: 1, y: 2 });\nconst answer = 42;" },
			{ code: 'const note = "@oai/sky and sky.click({ x: 1 })";' },
			{ code: "// @oai/sky sky.click({ x: 1 });\nconst answer = 42;" },
			{
				code: 'nodeRepl.write(await agent.documentation.get("bootstrap-troubleshooting"));',
				title: "Retry browser connection",
			},
			{
				code: 'nodeRepl.write(await agent.documentation.get("chrome-troubleshooting"));',
				title: "Check browser connection",
			},
		] as const;
		for (const [index, fixture] of ordinaryCells.entries()) {
			const ordinaryNodeRepl = buildCodexActivityGraph(
				transcript([
					{
						payload: {
							call_id: `ordinary-node-${index}`,
							input: `await tools.mcp__node_repl__js(${JSON.stringify(fixture)});`,
							name: "exec",
							type: "custom_tool_call",
						},
						timestamp: "2026-08-20T12:35:23.854Z",
						type: "response_item",
					},
				]),
			);
			const ordinaryOperation = ordinaryNodeRepl.carriers[0]?.operations[0];
			const ordinaryCarrier = ordinaryNodeRepl.carriers[0];

			expect(ordinaryOperation?.computerUseTarget).toBeUndefined();
			expect(
				ordinaryOperation &&
					translateCodexToolCall(
						ordinaryOperation.name,
						attachCodexOperationMetadata(
							ordinaryOperation.input,
							ordinaryOperation,
							ordinaryCarrier,
						),
					),
			).toMatchObject({ activity: "external", verb: "Used external tool" });
		}
	});

	test("uses established browser-state lineage as image provenance", () => {
		const content = transcript([
			{
				payload: {
					call_id: "outer-state",
					input:
						'await tools.mcp__node_repl__js({ code: "var savedPageState = await sky.get_app_state({ app: \\"Dia\\" });" });',
					name: "exec",
					type: "custom_tool_call",
				},
				type: "response_item",
			},
			{
				payload: {
					call_id: "outer-read-state",
					input:
						'await tools.mcp__node_repl__js({ code: "var savedLines = savedPageState.text.split(\\"\\n\\");" });',
					name: "exec",
					type: "custom_tool_call",
				},
				type: "response_item",
			},
			{
				payload: {
					call_id: "outer-read-derived-state",
					input:
						'await tools.mcp__node_repl__js({ code: "nodeRepl.write(savedLines.filter(Boolean));" });',
					name: "exec",
					type: "custom_tool_call",
				},
				type: "response_item",
			},
			{
				payload: {
					call_id: "outer-tab-binding",
					input:
						'await tools.mcp__node_repl__js({ code: "await browser.tabs.finalize({ keep: [] });" });',
					name: "exec",
					type: "custom_tool_call",
				},
				type: "response_item",
			},
			{
				payload: {
					call_id: "outer-image",
					input:
						'await tools.mcp__node_repl__js({ code: "renderCurrentFrame();" });',
					name: "exec",
					type: "custom_tool_call",
				},
				type: "response_item",
			},
			{
				payload: {
					call_id: "outer-image",
					output: [
						{ image_url: "data:image/png;base64,AAAA", type: "input_image" },
					],
					type: "custom_tool_call_output",
				},
				type: "response_item",
			},
		]);
		const operations = buildCodexActivityGraph(content).carriers.flatMap(
			(carrier) => carrier.operations,
		);

		expect(operations.map((operation) => operation.computerUseTarget)).toEqual([
			"Dia",
			"computer",
			"computer",
			"computer",
			"computer",
		]);
	});

	test("keeps generic chart and image-processing outputs external", () => {
		const fixtures = [
			{
				callId: "chart-image",
				code: "const chart = await renderChart(dataset); await nodeRepl.emitImage(chart);",
			},
			{
				callId: "processed-image",
				code: "const processed = await sharpenImage(sourceImage); nodeRepl.write(processed);",
			},
		] as const;
		const content = transcript(
			fixtures.flatMap((fixture) => [
				{
					payload: {
						call_id: fixture.callId,
						input: `tools.mcp__node_repl__js(${JSON.stringify({ code: fixture.code })})`,
						name: "exec",
						type: "custom_tool_call",
					},
					type: "response_item",
				},
				{
					payload: {
						call_id: fixture.callId,
						output: [
							{
								image_url: "data:image/png;base64,AAAA",
								type: "input_image",
							},
						],
						type: "custom_tool_call_output",
					},
					type: "response_item",
				},
			]),
		);
		const operations = buildCodexActivityGraph(content).carriers.flatMap(
			(carrier) => carrier.operations,
		);

		expect(
			operations.map((operation) => ({
				computerUseTarget: operation.computerUseTarget,
				id: operation.id,
			})),
		).toEqual([
			{ computerUseTarget: undefined, id: "chart-image:0:0" },
			{ computerUseTarget: undefined, id: "processed-image:0:0" },
		]);
	});

	test("retains ambiguous lifecycle evidence without duplicating an operation", () => {
		const graph = buildCodexActivityGraph(
			transcript([
				{
					payload: {
						call_id: "outer",
						input: `await tools.apply_patch(firstPatch);
await tools.apply_patch(secondPatch);`,
						name: "exec",
						type: "custom_tool_call",
					},
					timestamp: "2026-08-21T10:00:00.000Z",
					type: "response_item",
				},
				{
					payload: {
						call_id: "inner",
						success: true,
						type: "patch_apply_end",
					},
					timestamp: "2026-08-21T10:00:01.000Z",
					type: "event_msg",
				},
				{
					payload: {
						call_id: "outer",
						output: "done",
						type: "custom_tool_call_output",
					},
					timestamp: "2026-08-21T10:00:02.000Z",
					type: "response_item",
				},
			]),
		);

		expect(graph.carriers[0]?.operations).toHaveLength(2);
		expect(graph.lifecycleRecords).toMatchObject([
			{ confidence: "ambiguous-positional" },
		]);
		expect(graph.standaloneOperations).toHaveLength(0);
		const trace = buildConversationTrace(
			parseCodexConversations(
				transcript([
					{
						payload: { id: "ambiguous" },
						timestamp: "2026-08-21T09:59:59.000Z",
						type: "session_meta",
					},
					{
						payload: {
							call_id: "outer",
							input: `await tools.apply_patch(firstPatch);
await tools.apply_patch(secondPatch);`,
							name: "exec",
							type: "custom_tool_call",
						},
						timestamp: "2026-08-21T10:00:00.000Z",
						type: "response_item",
					},
					{
						payload: {
							call_id: "inner",
							exit_code: 1,
							type: "patch_apply_end",
						},
						timestamp: "2026-08-21T10:00:01.000Z",
						type: "event_msg",
					},
					{
						payload: {
							call_id: "outer",
							output: "failed",
							type: "custom_tool_call_output",
						},
						timestamp: "2026-08-21T10:00:02.000Z",
						type: "response_item",
					},
				]),
			),
		);
		expect(
			trace.some(
				(item) =>
					item.kind === "agent" &&
					item.events.some(
						(event) => event.kind === "orphan-result" && event.result.isError,
					),
			),
		).toBe(true);
	});

	test("retains a truly unmatched lifecycle as a standalone operation", () => {
		const graph = buildCodexActivityGraph(
			transcript([
				{
					payload: {
						call_id: "inner-patch",
						changes: { "a.ts": { type: "add" } },
						success: true,
						type: "patch_apply_end",
					},
					timestamp: "2026-08-21T10:00:00.000Z",
					type: "event_msg",
				},
			]),
		);

		expect(graph.standaloneOperations).toMatchObject([
			{
				correlation: "unmatched",
				name: "apply_patch",
			},
		]);
	});

	test("conserves every output block when a carrier has multiple output records", () => {
		const content = transcript([
			{
				payload: {
					arguments: '{"cmd":"pwd"}',
					call_id: "command",
					name: "exec_command",
					type: "function_call",
				},
				timestamp: "2026-08-21T10:00:00.000Z",
				type: "response_item",
			},
			{
				payload: {
					call_id: "command",
					output: "first",
					type: "function_call_output",
				},
				timestamp: "2026-08-21T10:00:01.000Z",
				type: "response_item",
			},
			{
				payload: {
					call_id: "command",
					output: [
						{ image_url: "data:image/png;base64,AAAA", type: "input_image" },
					],
					type: "function_call_output",
				},
				timestamp: "2026-08-21T10:00:02.000Z",
				type: "response_item",
			},
		]);
		const graph = buildCodexActivityGraph(content);

		expect(graph.carriers[0]?.outputBlocks.map((block) => block.type)).toEqual([
			"text",
			"image",
		]);
		const serializedConversation = JSON.stringify(
			parseCodexConversations(content),
		);
		expect(serializedConversation.match(/first/gu)).toHaveLength(1);
		expect(
			serializedConversation.match(/data:image\/png;base64,AAAA/gu),
		).toHaveLength(1);
	});

	test("preserves explicitly typed empty text blocks as text", () => {
		const graph = buildCodexActivityGraph(
			transcript([
				{
					payload: {
						arguments: JSON.stringify({ cmd: "pwd" }),
						call_id: "empty-text",
						name: "exec_command",
						type: "function_call",
					},
					type: "response_item",
				},
				{
					payload: {
						call_id: "empty-text",
						output: [{ text: "", type: "output_text" }],
						type: "function_call_output",
					},
					type: "response_item",
				},
			]),
		);

		expect(graph.carriers[0]?.outputBlocks).toEqual([
			{ rawType: "output_text", text: "", type: "text" },
		]);
	});

	test("does not present an unmatched MCP tool named exec as a JavaScript carrier", () => {
		const graph = buildCodexActivityGraph(
			transcript([
				{
					payload: {
						call_id: "inner",
						invocation: { tool_name: "exec" },
						result: { Ok: { content: [{ text: "done", type: "text" }] } },
						type: "mcp_tool_call_end",
					},
					timestamp: "2026-08-21T10:00:00.000Z",
					type: "event_msg",
				},
			]),
		);
		const operation = graph.standaloneOperations[0];
		expect(operation).toBeDefined();
		if (!operation) return;

		expect(
			translateCodexToolCall(
				operation.name,
				attachCodexOperationMetadata(operation.input, operation, undefined),
			),
		).toMatchObject({
			activity: "external",
			script: undefined,
			verb: "Used external tool",
		});
	});
});
