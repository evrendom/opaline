import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { catalogSources, FACT_CATALOG } from "./fact-catalog.js";
import {
	addCensusText,
	type CensusAgent,
	censusPathParts,
	censusRecordKind,
	censusRecordPaths,
	censusStepText,
	censusStream,
	compareCensus,
	createCensus,
	formatCensusReport,
	type IgnoredPath,
	isIgnoredPath,
	pathMatches,
} from "./fact-census.js";
import {
	CENSUS_IGNORED_PATHS,
	FACT_CENSUS_CATALOG,
} from "./fact-census-ignored.js";

function paths(record: Record<string, unknown>, agent: CensusAgent): string[] {
	return [...censusRecordPaths(record, agent).keys()].sort();
}

describe("census paths", () => {
	test("Claude records: type, system subtype and attachment type name the record", () => {
		expect(
			paths(
				{
					type: "system",
					subtype: "stop_hook_summary",
					hookCount: 2,
					hookInfos: [{ command: "lint", durationMs: 4 }],
				},
				"claude_code",
			),
		).toEqual([
			"system/stop_hook_summary.hookCount",
			"system/stop_hook_summary.hookInfos[].command",
			"system/stop_hook_summary.hookInfos[].durationMs",
		]);
		expect(
			paths(
				{
					type: "attachment",
					attachment: { type: "plan_mode", planFilePath: "/p" },
				},
				"claude_code",
			),
		).toEqual(["attachment/plan_mode.attachment.planFilePath"]);
	});

	test("content blocks are named by type, tool calls by tool, MCP tools collapse", () => {
		expect(
			paths(
				{
					type: "assistant",
					message: {
						content: [
							{ type: "text", text: "hi" },
							{
								type: "tool_use",
								id: "toolu_1",
								name: "Bash",
								input: { command: "ls", timeout: 1000 },
							},
							{
								type: "tool_use",
								id: "toolu_2",
								name: "mcp__posthog__exec",
								input: { anything: { nested: true } },
							},
						],
					},
				},
				"claude_code",
			),
		).toEqual([
			"assistant.message.content[text].text",
			"assistant.message.content[tool_use:Bash].id",
			"assistant.message.content[tool_use:Bash].input.command",
			"assistant.message.content[tool_use:Bash].input.timeout",
			"assistant.message.content[tool_use:Bash].name",
			"assistant.message.content[tool_use:mcp__{*}].id",
			"assistant.message.content[tool_use:mcp__{*}].input",
			"assistant.message.content[tool_use:mcp__{*}].name",
		]);
	});

	test("keys that are data collapse to {*}: ids, paths, model names", () => {
		expect(
			paths(
				{
					type: "assistant",
					wireToolInputs: { toolu_01ABC: { command: "cd /r && ls" } },
					message: { model: "x" },
				},
				"claude_code",
			),
		).toEqual(["assistant.message.model", "assistant.wireToolInputs.{*}"]);
		expect(
			paths(
				{
					type: "cost-state",
					modelUsage: { "claude-opus-5-5": { costUSD: 1 } },
				},
				"claude_code",
			),
		).toEqual(["cost-state.modelUsage.{*}.costUSD"]);
		expect(
			paths(
				{
					type: "event_msg",
					payload: {
						type: "item_completed",
						turn_id: "t1",
						item: {
							type: "FileChange",
							id: "call_1",
							changes: {
								"/repo/src/a.ts": { type: "update", unified_diff: "@@" },
								"/repo/b.ts": { type: "add" },
							},
						},
					},
				},
				"codex",
			),
		).toEqual([
			"event_msg/item_completed.turn_id",
			"event_msg/item_completed:FileChange.changes.{*}.type",
			"event_msg/item_completed:FileChange.changes.{*}.unified_diff",
			"event_msg/item_completed:FileChange.id",
		]);
	});

	test("Codex calls are named by tool; JSON arguments are walked; envelope fields follow @", () => {
		expect(
			paths(
				{
					type: "response_item",
					timestamp: "t",
					metadata: { user_input_order: 1 },
					payload: {
						type: "function_call",
						name: "exec_command",
						call_id: "call_1",
						arguments: JSON.stringify({
							cmd: "ls",
							workdir: "/r",
							timeout_ms: 5,
						}),
					},
				},
				"codex",
			),
		).toEqual([
			"response_item/function_call:exec_command.arguments.cmd",
			"response_item/function_call:exec_command.arguments.timeout_ms",
			"response_item/function_call:exec_command.arguments.workdir",
			"response_item/function_call:exec_command.call_id",
			"response_item/function_call:exec_command.name",
			"response_item/function_call:exec_command@metadata.user_input_order",
			"response_item/function_call:exec_command@timestamp",
		]);
		expect(
			paths(
				{
					type: "response_item",
					payload: {
						type: "function_call",
						name: "_create_pull_request",
						arguments: "{}",
					},
				},
				"codex",
			),
		).toEqual([
			"response_item/function_call:_{*}.arguments",
			"response_item/function_call:_{*}.name",
		]);
	});

	test("an output's transport envelope is walked; other JSON output stays text", () => {
		expect(
			paths(
				{
					type: "response_item",
					payload: {
						type: "custom_tool_call_output",
						output: JSON.stringify({
							output: "ok",
							metadata: { exit_code: 0 },
						}),
					},
				},
				"codex",
			),
		).toEqual([
			"response_item/custom_tool_call_output.output.metadata.exit_code",
			"response_item/custom_tool_call_output.output.output",
		]);
		expect(
			paths(
				{
					type: "response_item",
					payload: {
						type: "function_call_output",
						output: JSON.stringify({ agents: [{ name: "x" }] }),
					},
				},
				"codex",
			),
		).toEqual(["response_item/function_call_output.output"]);
	});

	test("output conventions add a ~ path; command output that mentions them does not", () => {
		const output = (text: string) =>
			paths(
				{
					type: "response_item",
					payload: { type: "function_call_output", output: text },
				},
				"codex",
			);
		expect(
			output(
				'exec_command failed: CreateProcess { message: "Rejected(\\"rejected by user\\")" }',
			),
		).toEqual([
			"response_item/function_call_output.output",
			"response_item/function_call_output.output~Rejected",
		]);
		expect(output("aborted by user after 3.2s")).toContain(
			"response_item/function_call_output.output~aborted by user",
		);
		expect(
			output(
				"Chunk ID: a\nWall time: 1.0 seconds\nProcess exited with code 1\nOutput:\n",
			),
		).toEqual([
			"response_item/function_call_output.output",
			"response_item/function_call_output.output~Chunk ID",
			"response_item/function_call_output.output~Process exited with code",
			"response_item/function_call_output.output~Wall time",
		]);
		expect(output("Output:\naborted by user after 3s")).toEqual([
			"response_item/function_call_output.output",
		]);
	});

	test("only enum-like values are kept; free text is a type and a length", () => {
		const census = createCensus();
		addCensusText(
			census,
			[
				JSON.stringify({
					type: "user",
					version: "2.1.1",
					permissionMode: "plan",
					message: { content: "secret token sk_live_123" },
				}),
				JSON.stringify({
					type: "user",
					permissionMode: "default",
					message: { content: "x" },
				}),
			].join("\n"),
		);
		const claude = census.paths.get("claude_code");
		expect(claude?.get("user.permissionMode")?.values).toEqual(
			new Map([
				["plan", 1],
				["default", 1],
			]),
		);
		const content = claude?.get("user.message.content");
		expect(content?.values.size).toBe(0);
		expect(content?.maxChars).toBe(24);
		// The version carries forward to records that do not name one.
		expect(content?.versions).toEqual(new Map([["2.1.1", 2]]));
	});

	test("the agent is detected per stream; Codex versions come from session_meta", () => {
		const census = createCensus();
		addCensusText(
			census,
			[
				JSON.stringify({
					type: "session_meta",
					payload: { cli_version: "0.156.0" },
				}),
				JSON.stringify({ type: "turn_context", payload: { model: "m" } }),
				"not json",
			].join("\n"),
		);
		expect(census.files.get("codex")).toBe(1);
		expect(census.unparseable.get("codex")).toBe(1);
		expect(
			census.paths.get("codex")?.get("turn_context/.model")?.versions,
		).toEqual(new Map([["0.156.0", 1]]));
	});
});

describe("patterns and the ignore list", () => {
	test("* stays inside one step, ** crosses steps, descendants never include ~conventions", () => {
		expect(pathMatches("*.cwd", "user.cwd")).toBe(true);
		expect(pathMatches("*.cwd", "attachment/x.attachment.cwd")).toBe(false);
		expect(pathMatches("a.**", "a.b[].c")).toBe(true);
		expect(
			pathMatches(
				"assistant.message.content[tool_use:*].name",
				"assistant.message.content[tool_use:mcp__{*}].name",
			),
		).toBe(true);
		expect(pathMatches("x.output", "x.output.metadata", true)).toBe(true);
		expect(pathMatches("x.output", "x.output~Rejected", true)).toBe(false);
		expect(pathMatches("x.output", "x.outputs", true)).toBe(false);
	});

	test("an except path stays reported", () => {
		const rule: IgnoredPath = {
			path: "a.input.**",
			except: ["a.input.timeout"],
			reason: "r",
			rule: "bookkeeping",
		};
		expect(isIgnoredPath("a.input.command", "codex", [rule])).toBe(true);
		expect(isIgnoredPath("a.input.timeout", "codex", [rule])).toBe(false);
		expect(
			isIgnoredPath("a.input.command", "codex", [
				{ ...rule, agent: "claude_code" },
			]),
		).toBe(false);
	});

	test("every ignored path says why", () => {
		for (const rule of CENSUS_IGNORED_PATHS) {
			expect(rule.reason.trim()).not.toBe("");
			expect([
				"verified_duplicate",
				"stream_identity",
				"constant_watch",
				"text_copy",
				"bookkeeping",
			]).toContain(rule.rule);
			if (rule.rule === "verified_duplicate")
				expect(rule.verification.length).toBeGreaterThan(30);
			if (rule.rule === "constant_watch")
				expect("observedConstant" in rule).toBe(true);
		}
	});

	test("WATCH follow-up maps varying literals; round 3 retains collaboration state containers", () => {
		for (const source of [
			"event_msg/item_completed:AgentMessage.delivery",
			"event_msg/exec_command_end.source",
			"event_msg/item_completed:McpToolCall.mcpAppResourceUri",
			"response_item/message:*@metadata.client_authored",
			"response_item/*.internal_chat_message_metadata_passthrough.content_item_kinds[]",
		])
			expect(catalogSources("codex")).toContain(source);
		expect(catalogSources("claude_code")).toContain(
			"attachment/*.renderedRole",
		);
		expect(
			isIgnoredPath(
				"attachment/environment.renderedRole",
				"claude_code",
				CENSUS_IGNORED_PATHS,
			),
		).toBe(false);
		const census = createCensus(CENSUS_IGNORED_PATHS);
		addCensusText(
			census,
			JSON.stringify({
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: { type: "CollabAgentToolCall", agents_states: {} },
				},
			}),
			"codex",
		);
		expect(census.alerts.get("codex")?.size).toBe(0);
		addCensusText(
			census,
			JSON.stringify({
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: { type: "CollabAgentToolCall", agents_states: [] },
				},
			}),
			"codex",
		);
		expect(census.alerts.get("codex")?.size).toBe(0);
		expect(catalogSources("codex")).toContain(
			"event_msg/item_completed:CollabAgentToolCall.agents_states",
		);
		expect(
			isIgnoredPath(
				"event_msg/item_completed:CollabAgentToolCall.agents_states",
				"codex",
				CENSUS_IGNORED_PATHS,
			),
		).toBe(false);
	});

	test("WATCH checks non-enum values, every array member and populated containers without retaining values", () => {
		const ignored: IgnoredPath[] = [
			{
				path: "attachment/test.attachment.flag",
				rule: "constant_watch",
				observedConstant: false,
				reason: "observed false",
			},
			{
				path: "attachment/test.attachment.names[]",
				rule: "constant_watch",
				observedConstant: "known",
				reason: "observed known",
			},
			{
				path: "attachment/test.attachment.empty",
				rule: "constant_watch",
				observedConstant: [],
				reason: "observed []",
			},
		];
		const census = createCensus(ignored);
		addCensusText(
			census,
			[
				JSON.stringify({
					type: "attachment",
					attachment: {
						type: "test",
						flag: false,
						names: ["known"],
						empty: [],
					},
				}),
				JSON.stringify({
					type: "attachment",
					attachment: {
						type: "test",
						flag: true,
						names: ["known", "a secret never retained"],
						empty: ["new"],
					},
				}),
			].join("\n"),
		);
		const report = compareCensus(census, { sources: () => [], ignored });
		expect(report.agents[0]?.alerts.map((issue) => issue.path).sort()).toEqual([
			"attachment/test.attachment.empty",
			"attachment/test.attachment.flag",
			"attachment/test.attachment.names[]",
		]);
		expect(JSON.stringify(report.agents[0]?.alerts)).not.toContain(
			"a secret never retained",
		);
		expect(formatCensusReport(report)).toContain("ALERT constant_watch");
	});

	test("stop-sequence WATCH accepts null and empty but alerts on a populated value", () => {
		const census = createCensus(CENSUS_IGNORED_PATHS);
		const addLine = censusStream(census, "claude_code");
		for (const stopSequence of [null, ""])
			addLine(
				JSON.stringify({
					type: "assistant",
					message: { stop_sequence: stopSequence },
				}),
			);
		expect(census.alerts.get("claude_code")?.size).toBe(0);
		addLine(
			JSON.stringify({
				type: "assistant",
				message: { stop_sequence: "a secret stop sequence" },
			}),
		);
		const alerts =
			compareCensus(census, FACT_CENSUS_CATALOG).agents[0]?.alerts ?? [];
		expect(alerts).toEqual([
			{
				rule: "constant_watch",
				path: "assistant.message.stop_sequence",
				expected: '[null,""]',
				count: 1,
			},
		]);
		expect(JSON.stringify(alerts)).not.toContain("a secret stop sequence");
	});

	test("Codex stream identity checks thread IDs, not root lineage, and reports literal paths", () => {
		const census = createCensus(CENSUS_IGNORED_PATHS);
		const addLine = censusStream(census, "codex", {
			sessionId: "child-thread",
		});
		addLine(
			JSON.stringify({
				type: "session_meta",
				payload: { id: "child-thread", session_id: "root-session" },
			}),
		);
		addLine(
			JSON.stringify({
				type: "token_usage_record",
				payload: { thread_id: "child-thread", session_id: "root-session" },
			}),
		);
		for (const recordType of ["session_meta", "token_usage_record"])
			addLine(
				JSON.stringify({
					type: recordType,
					payload: { session_id: "root-session" },
				}),
			);
		expect(census.alerts.get("codex")?.size).toBe(0);
		addLine(
			JSON.stringify({
				type: "session_meta",
				payload: { id: "other-thread", session_id: "root-session" },
			}),
		);
		addLine(
			JSON.stringify({
				type: "token_usage_record",
				payload: { thread_id: "other-thread", session_id: "root-session" },
			}),
		);
		const alerts =
			compareCensus(census, FACT_CENSUS_CATALOG).agents.find(
				(agent) => agent.agent === "codex",
			)?.alerts ?? [];
		expect(alerts.map((issue) => issue.path).sort()).toEqual([
			"session_meta/.id",
			"token_usage_record/.thread_id",
		]);
		expect(alerts.every((issue) => issue.count === 1)).toBe(true);
		expect(JSON.stringify(alerts)).not.toContain("root-session");
	});

	test("stream identity checks attachment restatements and resets at file boundaries", () => {
		const census = createCensus();
		addCensusText(
			census,
			[
				JSON.stringify({
					type: "user",
					sessionId: "session-a",
					agentId: "agent-a",
					isSidechain: true,
				}),
				JSON.stringify({
					type: "attachment",
					attachment: { type: "test" },
					sessionId: "session-b",
					agentId: "agent-b",
					isSidechain: false,
				}),
			].join("\n"),
		);
		addCensusText(
			census,
			JSON.stringify({
				type: "user",
				sessionId: "session-b",
				agentId: "agent-b",
				isSidechain: false,
			}),
		);
		const alerts =
			compareCensus(census, FACT_CENSUS_CATALOG).agents[0]?.alerts ?? [];
		expect(alerts.length).toBe(3);
		expect(
			alerts.every(
				(issue) => issue.rule === "stream_identity" && issue.count === 1,
			),
		).toBe(true);
		expect(JSON.stringify(alerts)).not.toContain("session-a");
	});

	test("a path the catalog names is mapped, others unmapped, and unseen sources are listed", () => {
		const census = createCensus();
		addCensusText(
			census,
			[
				JSON.stringify({
					type: "user",
					sessionId: "s",
					toolDenialKind: "permission-rule",
					brandNewField: 1,
				}),
			].join("\n"),
		);
		const [claude] = compareCensus(census, FACT_CENSUS_CATALOG).agents;
		expect(claude?.unmapped.map((path) => path.path)).toEqual([
			"user.brandNewField",
		]);
		expect(claude?.mappedPaths).toBe(1);
		expect(claude?.ignoredPaths).toBe(1);
		expect(claude?.unseenSources).not.toContain("user.toolDenialKind");
		expect(claude?.unseenSources).toContain("user.permissionMode");
		expect(
			formatCensusReport({ agents: claude === undefined ? [] : [claude] }),
		).toContain("`user.brandNewField`");
	});
});

describe("path parts", () => {
	test("split a path into its record kind and steps", () => {
		expect(
			censusPathParts(
				"user.message.content[tool_use:Bash].input.hooks[].command~Exit code",
			),
		).toEqual({
			head: "user",
			steps: [
				{ kind: "key", name: "message" },
				{ kind: "key", name: "content" },
				{ kind: "block", type: "tool_use", name: "Bash" },
				{ kind: "key", name: "input" },
				{ kind: "key", name: "hooks" },
				{ kind: "element" },
				{ kind: "key", name: "command" },
				{ kind: "convention", id: "Exit code" },
			],
		});
		expect(
			censusPathParts("response_item/function_call:exec_command@metadata.{*}"),
		).toEqual({
			head: "response_item/function_call:exec_command",
			steps: [
				{ kind: "outer", name: "metadata" },
				{ kind: "key", name: "{*}" },
			],
		});
		expect(censusPathParts("event_msg/task_started")).toEqual({
			head: "event_msg/task_started",
			steps: [],
		});
	});

	test("record kinds name the head every path of the record starts with", () => {
		const codex = {
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: { type: "CommandExecution", command: "ls" },
			},
		};
		expect(censusRecordKind(codex, "codex")).toBe(
			"event_msg/item_completed:CommandExecution",
		);
		expect(
			censusRecordKind(
				{ type: "attachment", attachment: { type: "plan_mode" } },
				"claude_code",
			),
		).toBe("attachment/plan_mode");
		const census = createCensus();
		addCensusText(census, `${JSON.stringify(codex)}\n${JSON.stringify(codex)}`);
		expect([...(census.kinds.get("codex") ?? [])]).toEqual([
			["event_msg/item_completed:CommandExecution", 2],
		]);
	});
});

describe("the parser fixtures are fully catalogued", () => {
	test("every fixture path is a primary source, explicit context, or ignored", async () => {
		const root = new URL("../__fixtures__", import.meta.url).pathname;
		const census = createCensus();
		const files: string[] = [];
		for (const entry of await readdir(root, { recursive: true }))
			if (entry.endsWith(".jsonl")) files.push(join(root, entry));
		expect(files.length).toBeGreaterThanOrEqual(7);
		for (const file of files.sort())
			addCensusText(census, await Bun.file(file).text());
		for (const paths of census.paths.values())
			for (const path of paths.keys()) {
				const { head, steps } = censusPathParts(path);
				expect(head + steps.map(censusStepText).join("")).toBe(path);
			}
		const report = compareCensus(census, FACT_CENSUS_CATALOG);
		expect(report.agents.map((agent) => agent.agent)).toEqual([
			"claude_code",
			"codex",
		]);
		for (const agent of report.agents)
			expect({
				agent: agent.agent,
				unmapped: agent.unmapped
					.filter(
						(path) =>
							!FACT_CATALOG.some((entry) =>
								entry.agents[agent.agent].sourceMappings.some(
									(source) =>
										source.role === "context" &&
										pathMatches(source.path, path.path),
								),
							),
					)
					.map((path) => path.path),
			}).toEqual({
				agent: agent.agent,
				unmapped: [],
			});
	});

	test("catalog sources are census paths", () => {
		for (const agent of ["claude_code", "codex"] as const)
			for (const source of catalogSources(agent)) {
				const codexShape =
					source.startsWith("response_item/*.") ||
					/^[a-z_]+\/[A-Za-z_]*(?::[^.@]+)?(?:[.@~]|$)/u.test(source) ||
					source.startsWith("*@");
				const claudeShape = /^(?:\*|[a-z-]+(?:\/[a-z_*]+)?)[.~]/u.test(source);
				expect({
					source,
					ok: agent === "codex" ? codexShape : claudeShape,
				}).toEqual({ source, ok: true });
			}
	});
});
