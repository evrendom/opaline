import { catalogSources } from "./fact-catalog.js";
import type { CensusCatalog, IgnoredPath } from "./fact-census.js";

export const CENSUS_IGNORED_PATHS: readonly IgnoredPath[] = [
	{
		path: "assistant.message.content[tool_use:AskUserQuestion].input.questions[].multiSelect",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:AskUserQuestion].input.questions[].multiSelect: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=7.",
	},
	{
		path: "assistant.message.content[tool_use:Edit].input.replace_all",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Edit].input.replace_all: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=865.",
	},
	{
		path: "assistant.message.content[tool_use:ExitPlanMode].input.planFilePath",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:ExitPlanMode].input.planFilePath: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=1.",
	},
	{
		path: "assistant.message.content[tool_use:Grep].input.{*}",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Grep].input.{*}: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=1.",
	},
	{
		path: "assistant.message.content[tool_use:Grep].input.output_mode",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Grep].input.output_mode: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=2.",
	},
	{
		path: "assistant.message.content[tool_use:Grep].input.path",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Grep].input.path: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=2.",
	},
	{
		path: "assistant.message.content[tool_use:Monitor].input.command",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Monitor].input.command: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=61.",
	},
	{
		path: "assistant.message.content[tool_use:Monitor].input.max_results",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Monitor].input.max_results: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=2.",
	},
	{
		path: "assistant.message.content[tool_use:Monitor].input.query",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Monitor].input.query: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=3.",
	},
	{
		path: "assistant.message.content[tool_use:Read].input.limit",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Read].input.limit: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=283.",
	},
	{
		path: "assistant.message.content[tool_use:Read].input.offset",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:Read].input.offset: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=259.",
	},
	{
		path: "assistant.message.content[tool_use:ScheduleWakeup].input.delaySeconds",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:ScheduleWakeup].input.delaySeconds: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=15.",
	},
	{
		path: "assistant.message.content[tool_use:ScheduleWakeup].input.noop",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:ScheduleWakeup].input.noop: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=15.",
	},
	{
		path: "assistant.message.content[tool_use:ScheduleWakeup].input.stop",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:ScheduleWakeup].input.stop: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=5.",
	},
	{
		path: "assistant.message.content[tool_use:SendMessage].input.recipient",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:SendMessage].input.recipient: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=101.",
	},
	{
		path: "assistant.message.content[tool_use:SendMessage].input.to",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:SendMessage].input.to: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=101.",
	},
	{
		path: "assistant.message.content[tool_use:TaskStop].input.task_id",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:TaskStop].input.task_id: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=13.",
	},
	{
		path: "assistant.message.content[tool_use:TaskUpdate].input.status",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:TaskUpdate].input.status: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=48.",
	},
	{
		path: "assistant.message.content[tool_use:TaskUpdate].input.taskId",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:TaskUpdate].input.taskId: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=48.",
	},
	{
		path: "assistant.message.content[tool_use:ToolSearch].input.max_results",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:ToolSearch].input.max_results: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=159.",
	},
	{
		path: "assistant.message.content[tool_use:ToolSearch].input.query",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:ToolSearch].input.query: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=159.",
	},
	{
		path: "assistant.message.content[tool_use:WebFetch].input.offset",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:WebFetch].input.offset: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=2.",
	},
	{
		path: "assistant.message.content[tool_use:WebSearch].input.allowed_domains[]",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:WebSearch].input.allowed_domains[]: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=8.",
	},
	{
		path: "assistant.message.content[tool_use:WebSearch].input.mode",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:WebSearch].input.mode: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=76.",
	},
	{
		path: "assistant.message.content[tool_use:WebSearch].input.query",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#claude_code:assistant.message.content[tool_use:WebSearch].input.query: For every non-Bash tool_use block the parser's item text JSON-equals the block's input on 6,107/6,107 blocks (readClaudeLine run on the full corpus; Edit/Write via the file_change row text, claude-records.ts:253-290); this path n=208.",
	},
	{
		path: "assistant.message.stop_details",
		agent: "claude_code",
		rule: "bookkeeping",
		reason:
			"Null-only container; populated descendants carry the data and are catalogued separately.",
	},
	{
		path: "assistant.message.stop_sequence",
		agent: "claude_code",
		rule: "constant_watch",
		reason: "Judge round 3: null/empty only; WATCH every other future value.",
		observedConstant: null,
		alsoObservedConstants: [""],
	},
	{
		path: "assistant.message.usage.output_tokens_details",
		agent: "claude_code",
		rule: "bookkeeping",
		reason:
			"Null-only container; populated descendants carry the data and are catalogued separately.",
	},
	{
		path: "attachment/nested_memory.attachment.content.path",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"Nested-memory content.path repeats the stored instruction_path filePath on every audited record.",
		verification:
			"Sequential count-only audit: 42/42 records equal the parser's stored filePath, zero missing or different; readClaudeLine chooses attachment.path then content.path.",
	},
	{
		path: "attachment/prompt_snapshot.attachment.cliPrefix",
		agent: "claude_code",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: System-prompt prefix sentence of the request (two variants, 62 and 94 chars).",
	},
	{
		path: "system/model_refusal_no_fallback.apiRefusalExplanation",
		agent: "claude_code",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: SDK explicitly defines refusal explanation as unstable human prose for display only (sdk.d.ts:5425); category and refusal occurrence remain structured facts.",
	},
	{
		path: "user.message.content[tool_result].content[tool_reference].tool_name",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"Tool name a ToolSearch result references; the same names are toolUseResult.matches[] (catalogued offered_tools source).",
		verification:
			"Judge round 3 counted duplicate check: tool_reference names equal matches[] on 112/112 ToolSearch results.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "user.toolUseResult.{*}",
		agent: "claude_code",
		rule: "text_copy",
		reason:
			'Judge round 3 text/definition/media exclusion: Tool-defined MCP result payload keyed by data (SDK sdk-tools.d.ts:424 "MCP tool execution result"); the result text carries the content.',
	},
	{
		path: "user.toolUseResult.bashEditDiff.files[].hunks[].lines[]",
		agent: "claude_code",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Message/reminder/definition/file-content or opaque encoded media/signature body; retain meaningful structured controls separately rather than treating the text as a new fact.",
	},
	{
		path: "user.toolUseResult.commandName",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"Echo of the Skill input.skill, stored as the catalogued calls/skill.",
		verification:
			"Judge round 3 counted duplicate check: commandName equals Skill input.skill on 49/49 results.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "user.toolUseResult.file.type",
		agent: "claude_code",
		rule: "text_copy",
		reason:
			'Judge round 3 text/definition/media exclusion: MIME type of the image a Read returned; carried in the "[screenshot type size sha]" label of the stored result text.',
	},
	{
		path: "user.toolUseResult.mode",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason: "Echo of the call's output_mode, which is stored (input_text).",
		verification:
			"Judge round 3 counted duplicate check: result mode equals the matching tool_use input on 2/2 results (call joined by tool_use_id).; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "user.toolUseResult.outputFile",
		agent: "claude_code",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Path of the background task output file; written into the stored result text.",
	},
	{
		path: "user.toolUseResult.questions[].multiSelect",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason:
			"Restates the AskUserQuestion input.questions, stored in input_text.",
		verification:
			"Judge round 3 counted duplicate check: questions[].multiSelect equals the call input value on 7/7 entries.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "user.toolUseResult.replaceAll",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason: "Echo of the call's replace_all, which is stored (input_text).",
		verification:
			"Judge round 3 counted duplicate check: result replaceAll equals the matching tool_use input on 417/417 results (call joined by tool_use_id).; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "user.toolUseResult.stopped",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason: "Echo of ScheduleWakeup input.stop, which is stored in input_text.",
		verification:
			"Judge round 3 counted duplicate check: result stopped equals input.stop on 5/5.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "user.toolUseResult.url",
		agent: "claude_code",
		rule: "verified_duplicate",
		reason: "Echo of the call's url, which is stored (input_text).",
		verification:
			"Judge round 3 counted duplicate check: result url equals the matching tool_use input on 81/81 results (call joined by tool_use_id).; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "event_msg/exec_command_end.command[]",
		agent: "codex",
		rule: "verified_duplicate",
		reason: "Argv of the command; repeats the call's stored command.",
		verification:
			"Judge round 3 counted duplicate check: argvToCommand(command) equals the exec_command call's cmd on 65/65 end events.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "event_msg/exec_command_end.turn_id",
		agent: "codex",
		rule: "verified_duplicate",
		reason: "Turn id of the end event.",
		verification:
			"Judge round 3 counted duplicate check: equals the current turn id on 65/65 events.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "event_msg/item_completed:DynamicToolCall.arguments",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Tool arguments; stored as the call text (nested) or the function_call arguments.",
	},
	{
		path: "event_msg/item_completed:Extension.action.pattern",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Find-in-page pattern; part of the stored call query text.",
	},
	{
		path: "event_msg/item_completed:Extension.action.query",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Search query; equals the item query that the parser stores as the call text.",
	},
	{
		path: "event_msg/item_completed:Extension.action.url",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: URL of an open-page action; part of the stored call text.",
	},
	{
		path: "event_msg/item_completed:Extension.query",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Search query; stored as the call text (readWebSearch).",
	},
	{
		path: "event_msg/item_completed:Extension.results[].url",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Search result title/url/snippet; the parser joins them into the result text (readWebSearch).",
	},
	{
		path: "event_msg/item_completed:McpToolCall.arguments",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Tool arguments; stored as the call text.",
	},
	{
		path: "event_msg/item_completed:McpToolCall.error.message",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Tool error text; stored as the result text for nested calls.",
	},
	{
		path: "event_msg/item_completed:WebSearch.action.pattern",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Find-in-page pattern; part of the stored call query text.",
	},
	{
		path: "event_msg/item_completed:WebSearch.action.query",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Search query; equals the item query that the parser stores as the call text.",
	},
	{
		path: "event_msg/item_completed:WebSearch.action.url",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: URL of an open-page action; part of the stored call text.",
	},
	{
		path: "event_msg/item_completed:WebSearch.query",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Search query; stored as the call text (readWebSearch).",
	},
	{
		path: "event_msg/item_completed:WebSearch.results[].url",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Search result title/url/snippet; the parser joins them into the result text (readWebSearch).",
	},
	{
		path: "event_msg/patch_apply_end.turn_id",
		agent: "codex",
		rule: "verified_duplicate",
		reason: "Turn id of the event.",
		verification:
			"Judge round 3 counted duplicate check: equals the current turn id on 2/2 events.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "event_msg/web_search_end.query",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Search query (empty).",
	},
	{
		path: "response_item/custom_tool_call_output.name",
		agent: "codex",
		rule: "verified_duplicate",
		reason: "Tool name repeated on the output.",
		verification:
			"Judge round 3 counted duplicate check: equals the tool name of the call with the same call_id on 72/72 outputs; tool_name is stored from the call.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "response_item/custom_tool_call_output.output[input_text].text~failed",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Convention marker on stored output text (the text itself is stored and the failure convention already feeds is_error).",
	},
	{
		path: "response_item/custom_tool_call_output.output[input_text].text~unable to locate image at",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Convention marker on stored output text (the text itself is stored and the failure convention already feeds is_error).",
	},
	{
		path: "response_item/function_call_output.output[input_text].text~failed",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Convention marker on stored output text (the text itself is stored and the failure convention already feeds is_error).",
	},
	{
		path: "response_item/function_call:analyses.arguments.action",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:analyses.arguments.action: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 4/4; scan n=4; distinct=3.",
	},
	{
		path: "response_item/function_call:close_agent.arguments.target",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:close_agent.arguments.target: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:create_goal.arguments.token_budget",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:create_goal.arguments.token_budget: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 24/24; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:docs_search.arguments.query",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:docs_search.arguments.query: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:event_definitions_list.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:event_definitions_list.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 6/6; scan n=6; distinct=4.",
	},
	{
		path: "response_item/function_call:event_definitions_list.arguments.offset",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:event_definitions_list.arguments.offset: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 6/6; scan n=4; distinct=1.",
	},
	{
		path: "response_item/function_call:event_definitions_list.arguments.q",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:event_definitions_list.arguments.q: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 6/6; scan n=5; distinct=5.",
	},
	{
		path: "response_item/function_call:exec_command.arguments.env.{*}",
		agent: "codex",
		rule: "bookkeeping",
		reason: "may contain secrets; never stored",
	},
	{
		path: "response_item/function_call:exec.arguments.command",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:exec.arguments.command: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: n/a/n/a; scan n=7; distinct=7.",
	},
	{
		path: "response_item/function_call:exec.arguments.llm_model",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:exec.arguments.llm_model: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: n/a/n/a; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:fetch_openai_doc.arguments.anchor",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:fetch_openai_doc.arguments.anchor: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 23/23; scan n=4; distinct=4.",
	},
	{
		path: "response_item/function_call:fetch_openai_doc.arguments.url",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:fetch_openai_doc.arguments.url: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 23/23; scan n=23; distinct=14.",
	},
	{
		path: "response_item/function_call:find.arguments.from",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:find.arguments.from: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=2.",
	},
	{
		path: "response_item/function_call:find.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:find.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=2.",
	},
	{
		path: "response_item/function_call:find.arguments.sort",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:find.arguments.sort: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:find.arguments.source",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:find.arguments.source: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:followup_task.arguments.target",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:followup_task.arguments.target: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 635/635; scan n=635; distinct=231.",
	},
	{
		path: "response_item/function_call:get_app_state.arguments.app",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:get_app_state.arguments.app: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:get_issue.arguments.includeCustomerNeeds",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:get_issue.arguments.includeCustomerNeeds: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 21/21; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:get_issue.arguments.includeRelations",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:get_issue.arguments.includeRelations: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 21/21; scan n=21; distinct=1.",
	},
	{
		path: "response_item/function_call:get_issue.arguments.includeReleases",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:get_issue.arguments.includeReleases: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 21/21; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:get_openapi_spec.arguments.codeExamplesOnly",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:get_openapi_spec.arguments.codeExamplesOnly: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:get_openapi_spec.arguments.languages[]",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:get_openapi_spec.arguments.languages[]: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:get_openapi_spec.arguments.url",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:get_openapi_spec.arguments.url: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.branch",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.branch: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=4; distinct=1.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.commit_sha",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.commit_sha: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.feedback_guide[].type",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.feedback_guide[].type: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=45; distinct=4.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.override_version_id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.override_version_id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=5; distinct=3.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.project_id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.project_id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=7; distinct=1.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.project_name",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.project_name: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.remote_url",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.remote_url: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=4; distinct=1.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.staging_url",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.staging_url: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=9; distinct=4.",
	},
	{
		path: "response_item/function_call:inflight_create_version.arguments.starting_route",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_create_version.arguments.starting_route: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 9/9; scan n=7; distinct=2.",
	},
	{
		path: "response_item/function_call:inflight_list_recent_projects.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_list_recent_projects.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 6/6; scan n=6; distinct=3.",
	},
	{
		path: "response_item/function_call:inflight_list_versions.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:inflight_list_versions.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=2.",
	},
	{
		path: "response_item/function_call:interrupt_agent.arguments.target",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:interrupt_agent.arguments.target: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 36/36; scan n=36; distinct=36.",
	},
	{
		path: "response_item/function_call:js.arguments.timeout_ms",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:js.arguments.timeout_ms: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 10,385/10,385; scan n=1,938; distinct=16.",
	},
	{
		path: "response_item/function_call:list_comments.arguments.issueId",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_comments.arguments.issueId: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=3.",
	},
	{
		path: "response_item/function_call:list_comments.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_comments.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=2.",
	},
	{
		path: "response_item/function_call:list_comments.arguments.orderBy",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_comments.arguments.orderBy: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:list_issue_labels.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issue_labels.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 4/4; scan n=4; distinct=1.",
	},
	{
		path: "response_item/function_call:list_issue_labels.arguments.team",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issue_labels.arguments.team: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 4/4; scan n=4; distinct=1.",
	},
	{
		path: "response_item/function_call:list_issue_statuses.arguments.team",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issue_statuses.arguments.team: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:list_issues.arguments.includeArchived",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issues.arguments.includeArchived: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 43/43; scan n=38; distinct=1.",
	},
	{
		path: "response_item/function_call:list_issues.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issues.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 43/43; scan n=43; distinct=6.",
	},
	{
		path: "response_item/function_call:list_issues.arguments.orderBy",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issues.arguments.orderBy: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 43/43; scan n=32; distinct=2.",
	},
	{
		path: "response_item/function_call:list_issues.arguments.parentId",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issues.arguments.parentId: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 43/43; scan n=11; distinct=5.",
	},
	{
		path: "response_item/function_call:list_issues.arguments.query",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issues.arguments.query: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 43/43; scan n=27; distinct=26.",
	},
	{
		path: "response_item/function_call:list_issues.arguments.state",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issues.arguments.state: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 43/43; scan n=3; distinct=3.",
	},
	{
		path: "response_item/function_call:list_issues.arguments.team",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_issues.arguments.team: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 43/43; scan n=28; distinct=1.",
	},
	{
		path: "response_item/function_call:list_mcp_resource_templates.arguments.server",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_mcp_resource_templates.arguments.server: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 31/31; scan n=15; distinct=4.",
	},
	{
		path: "response_item/function_call:list_teams.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_teams.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:list_teams.arguments.query",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:list_teams.arguments.query: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:logs_sparkline_query.arguments.query.dateRange.date_from",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:logs_sparkline_query.arguments.query.dateRange.date_from: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:logs_sparkline_query.arguments.query.sparklineBreakdownBy",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:logs_sparkline_query.arguments.query.sparklineBreakdownBy: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:organizations_list.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:organizations_list.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:organizations_list.arguments.offset",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:organizations_list.arguments.offset: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:project_get.arguments.id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:project_get.arguments.id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:query_error_tracking_issues_list.arguments.dateRange.date_from",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:query_error_tracking_issues_list.arguments.dateRange.date_from: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=2.",
	},
	{
		path: "response_item/function_call:query_error_tracking_issues_list.arguments.filterTestAccounts",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:query_error_tracking_issues_list.arguments.filterTestAccounts: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:query_error_tracking_issues_list.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:query_error_tracking_issues_list.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=2.",
	},
	{
		path: "response_item/function_call:query_error_tracking_issues_list.arguments.orderBy",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:query_error_tracking_issues_list.arguments.orderBy: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:query_error_tracking_issues_list.arguments.status",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:query_error_tracking_issues_list.arguments.status: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:query_error_tracking_issues_list.arguments.url",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:query_error_tracking_issues_list.arguments.url: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3/3; scan n=2; distinct=2.",
	},
	{
		path: "response_item/function_call:query_run.arguments.query.kind",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:query_run.arguments.query.kind: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 28/28; scan n=22; distinct=1.",
	},
	{
		path: "response_item/function_call:read_mcp_resource.arguments.server",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:read_mcp_resource.arguments.server: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 496/496; scan n=496; distinct=3.",
	},
	{
		path: "response_item/function_call:read_mcp_resource.arguments.uri",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:read_mcp_resource.arguments.uri: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 496/496; scan n=496; distinct=54.",
	},
	{
		path: "response_item/function_call:read.arguments.depth",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:read.arguments.depth: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:read.arguments.maxChars",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:read.arguments.maxChars: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=2.",
	},
	{
		path: "response_item/function_call:request_plugin_install.arguments.tool_id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:request_plugin_install.arguments.tool_id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:request_user_input.arguments.autoResolutionMs",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:request_user_input.arguments.autoResolutionMs: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 379/379; scan n=2; distinct=2.",
	},
	{
		path: "response_item/function_call:resume_agent.arguments.id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:resume_agent.arguments.id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:run.arguments.click[].id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:run.arguments.click[].id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 325/325; scan n=30; distinct=26.",
	},
	{
		path: "response_item/function_call:run.arguments.click[].ref_id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:run.arguments.click[].ref_id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 325/325; scan n=30; distinct=12.",
	},
	{
		path: "response_item/function_call:run.arguments.find[].pattern",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:run.arguments.find[].pattern: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 325/325; scan n=53; distinct=49.",
	},
	{
		path: "response_item/function_call:run.arguments.find[].ref_id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:run.arguments.find[].ref_id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 325/325; scan n=53; distinct=19.",
	},
	{
		path: "response_item/function_call:run.arguments.image_query[].q",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:run.arguments.image_query[].q: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 325/325; scan n=2; distinct=2.",
	},
	{
		path: "response_item/function_call:run.arguments.open[].lineno",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:run.arguments.open[].lineno: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 325/325; scan n=29; distinct=26.",
	},
	{
		path: "response_item/function_call:run.arguments.response_length",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:run.arguments.response_length: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 325/325; scan n=325; distinct=3.",
	},
	{
		path: "response_item/function_call:run.arguments.search_query[].q",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:run.arguments.search_query[].q: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 325/325; scan n=620; distinct=608.",
	},
	{
		path: "response_item/function_call:save_comment.arguments.issueId",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_comment.arguments.issueId: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 26/26; scan n=26; distinct=20.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.assignee",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.assignee: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=5; distinct=2.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.dueDate",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.dueDate: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.id",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.id: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=31; distinct=22.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.labels[]",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.labels[]: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=19; distinct=3.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.links[].url",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.links[].url: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=9; distinct=3.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.milestone",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.milestone: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.parentId",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.parentId: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=17; distinct=5.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.priority",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.priority: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=21; distinct=3.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.project",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.project: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=3; distinct=1.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.relatedTo[]",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.relatedTo[]: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=47; distinct=18.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.removeRelatedTo[]",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.removeRelatedTo[]: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.state",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.state: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=15; distinct=2.",
	},
	{
		path: "response_item/function_call:save_issue.arguments.team",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:save_issue.arguments.team: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 49/49; scan n=18; distinct=1.",
	},
	{
		path: "response_item/function_call:search_openai_docs.arguments.query",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:search_openai_docs.arguments.query: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 27/27; scan n=27; distinct=26.",
	},
	{
		path: "response_item/function_call:search_screens.arguments.image_format",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:search_screens.arguments.image_format: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:search_screens.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:search_screens.arguments.limit: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=2.",
	},
	{
		path: "response_item/function_call:search_screens.arguments.mode",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:search_screens.arguments.mode: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=2.",
	},
	{
		path: "response_item/function_call:search_screens.arguments.platform",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:search_screens.arguments.platform: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2/2; scan n=2; distinct=1.",
	},
	{
		path: "response_item/function_call:send_message.arguments.target",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:send_message.arguments.target: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 5,573/5,573; scan n=5,573; distinct=411.",
	},
	{
		path: "response_item/function_call:sleep.arguments.duration_ms",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:sleep.arguments.duration_ms: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 374/374; scan n=374; distinct=17.",
	},
	{
		path: "response_item/function_call:switch_project.arguments.projectId",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:switch_project.arguments.projectId: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 1/1; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:uidotsh_fetch.arguments.uri",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:uidotsh_fetch.arguments.uri: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2,338/2,338; scan n=1,439; distinct=26.",
	},
	{
		path: "response_item/function_call:uidotsh_fetch.arguments.uris[]",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:uidotsh_fetch.arguments.uris[]: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2,338/2,338; scan n=3,179; distinct=82.",
	},
	{
		path: "response_item/function_call:update_goal.arguments.status",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:update_goal.arguments.status: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 39/39; scan n=39; distinct=2.",
	},
	{
		path: "response_item/function_call:update_plan.arguments.plan[].status",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:update_plan.arguments.plan[].status: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 2,058/2,058; scan n=8,598; distinct=3.",
	},
	{
		path: "response_item/function_call:wait_agent.arguments.targets[]",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:wait_agent.arguments.targets[]: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3,793/3,793; scan n=6; distinct=3.",
	},
	{
		path: "response_item/function_call:wait_agent.arguments.targets[].threadId",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:wait_agent.arguments.targets[].threadId: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3,793/3,793; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:wait_agent.arguments.timeout_ms",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:wait_agent.arguments.timeout_ms: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3,793/3,793; scan n=3,792; distinct=19.",
	},
	{
		path: "response_item/function_call:wait_agent.arguments.timeoutMs",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:wait_agent.arguments.timeoutMs: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 3,793/3,793; scan n=1; distinct=1.",
	},
	{
		path: "response_item/function_call:wait.arguments.max_tokens",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:wait.arguments.max_tokens: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 6,796/6,796; scan n=6,796; distinct=51.",
	},
	{
		path: "response_item/function_call:wait.arguments.terminate",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:wait.arguments.terminate: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 6,796/6,796; scan n=32; distinct=2.",
	},
	{
		path: "response_item/function_call:wait.arguments.yield_time_ms",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:wait.arguments.yield_time_ms: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 6,796/6,796; scan n=6,795; distinct=14.",
	},
	{
		path: "response_item/function_call:write_stdin.arguments.yield_time_ms",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/function_call:write_stdin.arguments.yield_time_ms: For every non-shell function/custom tool call (all tools except exec_command, exec, apply_patch and shell variants) the parser's call text equals the raw arguments string on 88,252/88,252 calls (readCodexLine over the full corpus); this tool: 45,818/45,818; scan n=45,818; distinct=49.",
	},
	{
		path: "response_item/tool_search_call.arguments.limit",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/tool_search_call.arguments.limit: scan n=1,895; distinct=11; 2,119 calls",
	},
	{
		path: "response_item/tool_search_call.arguments.query",
		agent: "codex",
		rule: "verified_duplicate",
		reason:
			"contained in the stored input text unless truncated (65,536 chars / session budget)",
		verification:
			"Judge round 3; judge3/sonnet/ignored.json#codex:response_item/tool_search_call.arguments.query: scan n=2,119; distinct=1356; 2,119 calls",
	},
	{
		path: "response_item/web_search_call.action.pattern",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Web action detail (query / URL / pattern) also held by the item_completed WebSearch whose query text the parser stores.",
	},
	{
		path: "response_item/web_search_call.action.query",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Web action detail (query / URL / pattern) also held by the item_completed WebSearch whose query text the parser stores.",
	},
	{
		path: "response_item/web_search_call.action.url",
		agent: "codex",
		rule: "text_copy",
		reason:
			"Judge round 3 text/definition/media exclusion: Web action detail (query / URL / pattern) also held by the item_completed WebSearch whose query text the parser stores.",
	},
	{
		path: "world_state/.state.model",
		agent: "codex",
		rule: "verified_duplicate",
		reason: "Model of the world-state snapshot.",
		verification:
			"Judge round 3 counted duplicate check: equals the neighbouring turn_context.model (stored as runs/model) on 2730/2730 snapshots.; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "world_state/.state.personality.model",
		agent: "codex",
		rule: "verified_duplicate",
		reason: "Model repeated inside the personality block.",
		verification:
			"Judge round 3 counted duplicate check: equals state.model on 2031/2031 snapshots (state.model == turn_context.model on 2,730/2,730).; any stored text remains subject to the 65,536-character/session-budget truncation caveat.",
	},
	{
		path: "event_msg/item_completed:FunctionCallOutput.output[input_image].detail",
		agent: "codex",
		rule: "bookkeeping",
		reason: "Judge exception: image detail hint, not image payload or outcome.",
	},
	{
		path: "retained_context/delivered_assistant_message.complete",
		agent: "codex",
		rule: "bookkeeping",
		reason: "Judge exception: delivery-completion bookkeeping.",
	},
	{
		path: "event_msg/thread_settings_applied.thread_settings.collaboration_mode.**",
		rule: "verified_duplicate",
		verification:
			"Judge: thread_settings collaboration_mode agrees with turn_context on all 10,722 settings snapshots; the configured model is identical in 10,722/10,722.",
		reason:
			"Judge: thread_settings collaboration_mode agrees with turn_context on all 10,722 settings snapshots; the configured model is identical in 10,722/10,722.",
		except: [
			"event_msg/thread_settings_applied.thread_settings.collaboration_mode.settings.developer_instructions",
			"event_msg/thread_settings_applied.thread_settings.collaboration_mode.settings.reasoning_effort",
		],
	},
	{
		path: "turn_context/.collaboration_mode.settings.model",
		rule: "verified_duplicate",
		verification:
			"Judge: 10,722/10,722 values match the configured model; runs/model stores it.",
		reason:
			"Judge: 10,722/10,722 values match the configured model; runs/model stores it.",
	},
	{
		path: "event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.type",
		rule: "constant_watch",
		observedConstant: "restricted",
		reason:
			'Judge round 2 corpus constant "restricted"; WATCH every future value.',
	},
	{
		path: "world_state/.state.orchestrator_skills",
		rule: "bookkeeping",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
	},
	{
		path: "system/model_refusal_fallback.apiRefusalExplanation",
		rule: "constant_watch",
		observedConstant: null,
		reason: "Judge round 2 corpus constant null; WATCH every future value.",
	},
	{
		path: "attachment/plan_mode.attachment.isSubAgent",
		rule: "constant_watch",
		observedConstant: false,
		reason: "Judge round 2 corpus constant false; WATCH every future value.",
	},
	{
		path: "event_msg/agent_message.memory_citation",
		agent: "codex",
		reason:
			"Independent residue agreement: Citation object/array container; retain useful reference leaves separately rather than storing schema shape.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_message.memory_citation.entries",
		agent: "codex",
		reason:
			"Independent residue agreement: Citation object/array container; retain useful reference leaves separately rather than storing schema shape.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_message.memory_citation.rolloutIds",
		agent: "codex",
		reason:
			"Independent residue agreement: Citation object/array container; retain useful reference leaves separately rather than storing schema shape.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_message.questions",
		agent: "codex",
		reason:
			"Independent residue agreement: Assistant-authored question titles/options and their containers are conversational text, not a permission verdict or structured run fact.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_message.questions[].options",
		agent: "codex",
		reason:
			"Independent residue agreement: Assistant-authored question titles/options and their containers are conversational text, not a permission verdict or structured run fact.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_message.questions[].options[]",
		agent: "codex",
		reason:
			"Independent residue agreement: Assistant-authored question titles/options and their containers are conversational text, not a permission verdict or structured run fact.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_message.questions[].title",
		agent: "codex",
		reason:
			"Independent residue agreement: Assistant-authored question titles/options and their containers are conversational text, not a permission verdict or structured run fact.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_reasoning_raw_content.text",
		agent: "codex",
		reason:
			"Independent residue agreement: Raw reasoning text is message content, not a separate literal analytic fact.",
		rule: "text_copy",
	},
	{
		path: "event_msg/entered_review_mode.item_id",
		agent: "codex",
		reason:
			"Independent residue agreement: Review item identity is message/item bookkeeping, not a tool request/result call ID.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/entered_review_mode.target.instructions",
		agent: "codex",
		reason:
			"Independent residue agreement: Custom review instructions, target title or display hint are free-form prompt/UI text.",
		rule: "text_copy",
	},
	{
		path: "event_msg/entered_review_mode.user_facing_hint",
		agent: "codex",
		reason:
			"Independent residue agreement: Custom review instructions, target title or display hint are free-form prompt/UI text.",
		rule: "text_copy",
	},
	{
		path: "event_msg/exited_review_mode.item_id",
		agent: "codex",
		reason:
			"Independent residue agreement: Review item identity is message/item bookkeeping, not a tool request/result call ID.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/exited_review_mode.review_output",
		agent: "codex",
		reason:
			"Independent residue agreement: Null optional review output or findings-array container; it carries no finding count/value by itself.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/exited_review_mode.review_output.findings",
		agent: "codex",
		reason:
			"Independent residue agreement: Null optional review output or findings-array container; it carries no finding count/value by itself.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/exited_review_mode.review_output.findings[].body",
		agent: "codex",
		reason:
			"Independent residue agreement: Review finding title/body or overall explanation is assistant-authored answer text.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/exited_review_mode.review_output.overall_explanation",
		agent: "codex",
		reason:
			"Independent residue agreement: Review finding title/body or overall explanation is assistant-authored answer text.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/image_generation_end.result",
		agent: "codex",
		reason:
			"Independent residue agreement: Image-generation result is encoded image data, not a separate fact; never retain the image bytes here.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/image_generation_end.revised_prompt",
		agent: "codex",
		reason:
			"Independent residue agreement: Revised image prompt is free-form generation text rather than an analytic fact.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:AgentMessage.content",
		agent: "codex",
		reason:
			"Independent residue agreement: AgentMessage.content is an answer-content container, not an additional fact or count.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:AgentMessage.memory_citation.entries",
		agent: "codex",
		reason:
			"Independent residue agreement: Citation object/array container; retain useful reference leaves separately rather than storing schema shape.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:AgentMessage.memory_citation.rolloutIds",
		agent: "codex",
		reason:
			"Independent residue agreement: Citation object/array container; retain useful reference leaves separately rather than storing schema shape.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:CollabAgentToolCall.prompt",
		agent: "codex",
		reason:
			"Independent residue agreement: The delegated prompt is free-form task message text, not a separate sub-agent metric.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:CommandExecution.command",
		agent: "codex",
		reason:
			"Independent residue agreement: command is the argv-array container; nonempty elements already source input_text, while an empty array has no command text.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:CommandExecution.parsed_cmd",
		agent: "codex",
		reason:
			"Independent residue agreement: parsed_cmd is an empty-array/container path; classifications and read/search leaves already have catalog mappings.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:EnteredReviewMode.target.instructions",
		agent: "codex",
		reason:
			"Independent residue agreement: Custom review instructions, target title or display hint are free-form prompt/UI text.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:EnteredReviewMode.user_facing_hint",
		agent: "codex",
		reason:
			"Independent residue agreement: Custom review instructions, target title or display hint are free-form prompt/UI text.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:ExitedReviewMode.review_output",
		agent: "codex",
		reason:
			"Independent residue agreement: Null optional review output or findings-array container; it carries no finding count/value by itself.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:ExitedReviewMode.review_output.findings",
		agent: "codex",
		reason:
			"Independent residue agreement: Null optional review output or findings-array container; it carries no finding count/value by itself.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:ExitedReviewMode.review_output.findings[].body",
		agent: "codex",
		reason:
			"Independent residue agreement: Review finding title/body or overall explanation is assistant-authored answer text.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:ExitedReviewMode.review_output.overall_explanation",
		agent: "codex",
		reason:
			"Independent residue agreement: Review finding title/body or overall explanation is assistant-authored answer text.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:FileChange.changes",
		agent: "codex",
		reason:
			"Independent residue agreement: Empty changes map/container does not name a changed file or prove an effect.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:FunctionCallOutput.output[encrypted_content].encrypted_content",
		agent: "codex",
		reason:
			"Independent residue agreement: Encrypted content, audio/image payload URLs or provider file IDs are content/transport payloads, not retained result-text facts.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:FunctionCallOutput.output[input_audio].audio_url",
		agent: "codex",
		reason:
			"Independent residue agreement: Encrypted content, audio/image payload URLs or provider file IDs are content/transport payloads, not retained result-text facts.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:FunctionCallOutput.output[input_image].file_id",
		agent: "codex",
		reason:
			"Independent residue agreement: Encrypted content, audio/image payload URLs or provider file IDs are content/transport payloads, not retained result-text facts.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:FunctionCallOutput.output[input_image].image_url",
		agent: "codex",
		reason:
			"Independent residue agreement: Encrypted content, audio/image payload URLs or provider file IDs are content/transport payloads, not retained result-text facts.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:HookPrompt.fragments",
		agent: "codex",
		reason:
			"Independent residue agreement: Hook prompt array or hook-run correlation ID is container/internal correlation bookkeeping.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:HookPrompt.fragments[].hookRunId",
		agent: "codex",
		reason:
			"Independent residue agreement: Hook prompt array or hook-run correlation ID is container/internal correlation bookkeeping.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:ImageGeneration.result",
		agent: "codex",
		reason:
			"Independent residue agreement: Image-generation result is encoded image data, not a separate fact; never retain the image bytes here.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:ImageGeneration.revised_prompt",
		agent: "codex",
		reason:
			"Independent residue agreement: Revised image prompt is free-form generation text rather than an analytic fact.",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:UserMessage.content",
		agent: "codex",
		reason:
			"Independent residue agreement: UserMessage.content is an empty-array/container path; prompt text and typed image/skill/audio elements must be handled separately.",
		rule: "text_copy",
	},
	{
		path: "event_msg/mcp_tool_call_end.link_id",
		agent: "codex",
		reason:
			"Independent residue agreement: MCP link_id is UI/link correlation bookkeeping, not the server, tool or permission outcome.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/mcp_tool_call_end.result.content[]",
		agent: "codex",
		reason:
			"Independent residue agreement: Generic untyped MCP content element is an opaque tool-defined payload; map identified text leaves rather than treating every element as text.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/mcp_tool_call_end.result.structuredContent",
		agent: "codex",
		reason:
			"Independent residue agreement: structuredContent is an arbitrary tool-defined document, already part of the tool result rather than a standalone agent fact.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/patch_apply_end.changes",
		agent: "codex",
		reason:
			"Independent residue agreement: Empty patch changes map/container carries no changed-file path or effect by itself.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/sub_agent_activity.event_id",
		agent: "codex",
		reason:
			"Independent residue agreement: Activity event_id is deduplication/record bookkeeping, not a tool call ID or an agent identity.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/task_started.trace_id",
		agent: "codex",
		reason:
			"Independent residue agreement: trace_id is tracing/telemetry correlation bookkeeping rather than a distinct run fact.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/user_message.client_id",
		agent: "codex",
		reason:
			"Independent residue agreement: User-message client_id is client-side message correlation bookkeeping.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/user_message.image_order",
		agent: "codex",
		reason:
			"Independent residue agreement: Image-order vectors are UI attachment ordering bookkeeping, not a new image-presence/type fact.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/user_message.image_order[]",
		agent: "codex",
		reason:
			"Independent residue agreement: Image-order vectors are UI attachment ordering bookkeeping, not a new image-presence/type fact.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/user_message.text_elements[].byte_range.end",
		agent: "codex",
		reason:
			"Independent residue agreement: Text-element byte offsets/placeholders are rich-input rendering bookkeeping, not prompt meaning or authorization facts.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/user_message.text_elements[].byte_range.start",
		agent: "codex",
		reason:
			"Independent residue agreement: Text-element byte offsets/placeholders are rich-input rendering bookkeeping, not prompt meaning or authorization facts.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/user_message.text_elements[].placeholder",
		agent: "codex",
		reason:
			"Independent residue agreement: Text-element byte offsets/placeholders are rich-input rendering bookkeeping, not prompt meaning or authorization facts.",
		rule: "bookkeeping",
	},
	{
		path: "inter_agent_communication/.encrypted_content",
		agent: "codex",
		reason:
			"Independent residue agreement: Encrypted inter-agent content is an opaque payload, not plaintext prompt text or an independent fact.",
		rule: "text_copy",
	},
	{
		path: "inter_agent_communication/.other_recipients",
		agent: "codex",
		reason:
			"Independent residue agreement: Empty additional-recipient array/container adds no recipient identity; retain concrete elements separately.",
		rule: "bookkeeping",
	},
	{
		path: "realtime_item/.item_id",
		agent: "codex",
		reason:
			"Independent residue agreement: Realtime item/session IDs and presentation type/index are interleaving/rendering bookkeeping, not tool-call or parent-session identities.",
		rule: "bookkeeping",
	},
	{
		path: "realtime_item/.presentation.index",
		agent: "codex",
		reason:
			"Independent residue agreement: Realtime item/session IDs and presentation type/index are interleaving/rendering bookkeeping, not tool-call or parent-session identities.",
		rule: "bookkeeping",
	},
	{
		path: "realtime_item/.presentation.type",
		agent: "codex",
		reason:
			"Independent residue agreement: Realtime item/session IDs and presentation type/index are interleaving/rendering bookkeeping, not tool-call or parent-session identities.",
		rule: "bookkeeping",
	},
	{
		path: "realtime_item/.realtime_session_id",
		agent: "codex",
		reason:
			"Independent residue agreement: Realtime item/session IDs and presentation type/index are interleaving/rendering bookkeeping, not tool-call or parent-session identities.",
		rule: "bookkeeping",
	},
	{
		path: "realtime_item/.text",
		agent: "codex",
		reason:
			"Independent residue agreement: Realtime transcript text is conversational message content.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/additional_tools.role",
		agent: "codex",
		reason:
			"Independent residue agreement: additional_tools.role is the role of a tool-schema context block, not a person/agent origin or a run property.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/additional_tools.tools",
		agent: "codex",
		reason:
			"Independent residue agreement: Additional tool declarations are opaque tool schemas/availability context, not evidence a tool was called.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/additional_tools.tools[]",
		agent: "codex",
		reason:
			"Independent residue agreement: Additional tool declarations are opaque tool schemas/availability context, not evidence a tool was called.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/additional_tools@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/agent_message.content",
		agent: "codex",
		reason:
			"Independent residue agreement: Empty agent-message content array/container does not add prompt text; identified textual content has its own mapping.",
		rule: "text_copy",
	},
	{
		path: "response_item/agent_message@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/compaction@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/configuration_update@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/context_compaction@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/custom_tool_call_output@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/custom_tool_call:*@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call_output@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:*.encrypted_function_args",
		agent: "codex",
		reason:
			"Independent residue agreement: Encrypted function arguments and their array container are opaque input payloads, not additional decrypted facts.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:*.encrypted_function_args[]",
		agent: "codex",
		reason:
			"Independent residue agreement: Encrypted function arguments and their array container are opaque input payloads, not additional decrypted facts.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:*@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:exec_command.arguments.additional_permissions",
		agent: "codex",
		reason:
			"Independent residue agreement: Optional additional-permission object/array container carries no concrete grant by itself; map its recorded permission leaves separately.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:exec_command.arguments.additional_permissions.file_system",
		agent: "codex",
		reason:
			"Independent residue agreement: Optional additional-permission object/array container carries no concrete grant by itself; map its recorded permission leaves separately.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries",
		agent: "codex",
		reason:
			"Independent residue agreement: Optional additional-permission object/array container carries no concrete grant by itself; map its recorded permission leaves separately.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:exec_command.arguments.additional_permissions.file_system.read",
		agent: "codex",
		reason:
			"Independent residue agreement: Optional additional-permission object/array container carries no concrete grant by itself; map its recorded permission leaves separately.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:exec_command.arguments.additional_permissions.file_system.write",
		agent: "codex",
		reason:
			"Independent residue agreement: Optional additional-permission object/array container carries no concrete grant by itself; map its recorded permission leaves separately.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:exec_command.arguments.additional_permissions.network",
		agent: "codex",
		reason:
			"Independent residue agreement: Optional additional-permission object/array container carries no concrete grant by itself; map its recorded permission leaves separately.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:exec_command.arguments.prefix_rule",
		agent: "codex",
		reason:
			"Independent residue agreement: Empty prefix_rule array is request shape/bookkeeping, not a permission decision or an approved prefix.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:spawn_agent.arguments.items[]",
		agent: "codex",
		reason:
			"Independent residue agreement: Generic spawn input element has no exposed schema here; it is opaque call content, not a separate derived agent fact.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/image_generation_call.result",
		agent: "codex",
		reason:
			"Independent residue agreement: Image-generation result is encoded image data, not a separate fact; never retain the image bytes here.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/image_generation_call.revised_prompt",
		agent: "codex",
		reason:
			"Independent residue agreement: Revised image prompt is free-form generation text rather than an analytic fact.",
		rule: "text_copy",
	},
	{
		path: "response_item/image_generation_call@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/local_shell_call.action.command",
		agent: "codex",
		reason:
			"Independent residue agreement: Local-shell command array container has no command tokens when empty; concrete argv elements supply input_text.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/local_shell_call.action.env",
		agent: "codex",
		reason:
			"Independent residue agreement: Environment-variable bindings are sensitive tool-input configuration; do not extract their values as separate analytic facts.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/local_shell_call.action.env.{*}",
		agent: "codex",
		reason:
			"Independent residue agreement: Environment-variable bindings are sensitive tool-input configuration; do not extract their values as separate analytic facts.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/local_shell_call.action.type",
		agent: "codex",
		reason:
			"Independent residue agreement: The sole local-shell action discriminator is schema/record-kind context, not the called tool’s name or evidence of an actual effect.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/local_shell_call@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/message:*.content",
		agent: "codex",
		reason:
			"Independent residue agreement: Wildcard message content container covers multiple roles and modalities; only role-specific text/media leaves are facts.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/message:*@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/reasoning@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/tool_search_call@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/tool_search_output@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "response_item/web_search_call@metadata",
		agent: "codex",
		reason:
			"Independent residue agreement: Response metadata container is harness bookkeeping; already cataloged attribution leaves should be handled separately rather than mapping an undifferentiated object.",
		rule: "bookkeeping",
	},
	{
		path: "retained_context/delivered_assistant_message.acceptance_order",
		agent: "codex",
		reason:
			"Independent residue agreement: Retained acceptance ordering/IDs or verified question-answer text are host evidence bookkeeping or conversational content, not evidence of a permission approval.",
		rule: "bookkeeping",
	},
	{
		path: "retained_context/delivered_assistant_message.message_id",
		agent: "codex",
		reason:
			"Independent residue agreement: Retained acceptance ordering/IDs or verified question-answer text are host evidence bookkeeping or conversational content, not evidence of a permission approval.",
		rule: "bookkeeping",
	},
	{
		path: "retained_context/delivered_assistant_message.text",
		agent: "codex",
		reason:
			"Independent residue agreement: Retained delivered assistant text is message content and never user authorization.",
		rule: "bookkeeping",
	},
	{
		path: "retained_context/verified_answer.acceptance_order",
		agent: "codex",
		reason:
			"Independent residue agreement: Retained acceptance ordering/IDs or verified question-answer text are host evidence bookkeeping or conversational content, not evidence of a permission approval.",
		rule: "bookkeeping",
	},
	{
		path: "retained_context/verified_answer.questions",
		agent: "codex",
		reason:
			"Independent residue agreement: Retained acceptance ordering/IDs or verified question-answer text are host evidence bookkeeping or conversational content, not evidence of a permission approval.",
		rule: "bookkeeping",
	},
	{
		path: "retained_context/verified_answer.questions[].answer",
		agent: "codex",
		reason:
			"Independent residue agreement: Retained acceptance ordering/IDs or verified question-answer text are host evidence bookkeeping or conversational content, not evidence of a permission approval.",
		rule: "bookkeeping",
	},
	{
		path: "retained_context/verified_answer.questions[].question",
		agent: "codex",
		reason:
			"Independent residue agreement: Retained acceptance ordering/IDs or verified question-answer text are host evidence bookkeeping or conversational content, not evidence of a permission approval.",
		rule: "bookkeeping",
	},
	{
		path: "security_risk_score/.action",
		agent: "codex",
		reason:
			"Independent residue agreement: SecurityRiskScore.action is an arbitrary bounded copy of reviewed tool input; avoid duplicating sensitive command/content values as facts.",
		rule: "bookkeeping",
	},
	{
		path: "security_risk_score/.scores",
		agent: "codex",
		reason:
			"Independent residue agreement: An empty security score map/container carries no classifier score; map the numeric keyed leaves separately.",
		rule: "bookkeeping",
	},
	{
		path: "session_meta/.base_instructions",
		agent: "codex",
		reason:
			"Independent residue agreement: Null base_instructions is absence of an optional instruction payload; actual text is separately mapped to instruction_text.",
		rule: "text_copy",
	},
	{
		path: "session_meta/.history_base.end_byte_offset",
		agent: "codex",
		reason:
			"Independent residue agreement: Fork ordinal and physical history byte/ordinal boundaries are replay bookkeeping, not the logical parent-session identity.",
		rule: "bookkeeping",
	},
	{
		path: "session_meta/.history_base.end_ordinal_exclusive",
		agent: "codex",
		reason:
			"Independent residue agreement: Fork ordinal and physical history byte/ordinal boundaries are replay bookkeeping, not the logical parent-session identity.",
		rule: "bookkeeping",
	},
	{
		path: "session_meta/.history_base.thread_id",
		agent: "codex",
		reason:
			"Independent residue agreement: history_base.thread_id names a physical rollout prefix and may differ from stable/logical parent identity; this is replay storage bookkeeping.",
		rule: "bookkeeping",
	},
	{
		path: "turn_context/.sandbox_policy.writable_roots",
		agent: "codex",
		reason:
			"Independent residue agreement: The snapshot incorrectly applies kebab-case variant renaming to SandboxPolicy fields; the writer emits snake_case field names, not this exact path.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/error.message",
		agent: "codex",
		reason:
			"synthetic parser-compatibility fixture, not a witnessed rollout field; 0.162.0 policy.rs:161 excludes standalone Error from persistence; provider errors are on task_complete",
		rule: "bookkeeping",
	},
	{
		path: "*.sessionId",
		reason:
			"Restates stream identity; census checks consistency against the stream baseline and filename where available.",
		rule: "stream_identity",
		identity: "sessionId",
	},
	{
		path: "*.userType",
		reason:
			'Judge round 2 corpus constant "external"; WATCH every future value.',
		rule: "constant_watch",
		observedConstant: "external",
	},
	{
		path: "*.slug",
		reason: "the session's display slug",
		rule: "bookkeeping",
		except: [
			"assistant.slug",
			"attachment/agent_listing_delta.slug",
			"attachment/date_change.slug",
			"attachment/deferred_tools_delta.slug",
			"attachment/skill_listing.slug",
			"attachment/task_reminder.slug",
			"system/stop_hook_summary.slug",
			"user.slug",
		],
	},
	{
		path: "*.promptId",
		agent: "codex",
		reason: "not written by Codex",
		rule: "bookkeeping",
	},
	{
		path: "*@ordinal",
		agent: "codex",
		reason:
			"Judge: ordinal follows physical line order in 2,672/2,673 files; retain the exception as a known duplicate-verification caveat, never as logical fork_point.",
		rule: "verified_duplicate",
		verification:
			"Judge: ordinal follows physical line order in 2,672/2,673 files; retain the exception as a known duplicate-verification caveat, never as logical fork_point.",
	},
	{
		path: "*.id",
		agent: "codex",
		reason: "item and message ids; calls join by call_id",
		except: [
			"event_msg/item_completed:CommandExecution.id",
			"event_msg/item_completed:McpToolCall.id",
			"event_msg/item_completed:DynamicToolCall.id",
			"event_msg/item_completed:FileChange.id",
			"event_msg/item_completed:WebSearch.id",
			"event_msg/item_completed:Extension.id",
			"event_msg/item_completed:ContextCompaction.id",
			"event_msg/item_completed:CollabAgentToolCall.id",
		],
		rule: "bookkeeping",
	},
	{
		path: "*.internal_chat_message_metadata_passthrough.**",
		agent: "codex",
		reason: "internal routing metadata (turn ids repeat turn_context)",
		except: [
			"response_item/*.internal_chat_message_metadata_passthrough.create_time",
			"response_item/agent_message.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/compaction.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/custom_tool_call_output.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/custom_tool_call:apply_patch.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/custom_tool_call:exec.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call_output.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:_{*}.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:analyses.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:create_goal.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:exec_command.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:exec.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:fetch_openai_doc.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:find.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:followup_task.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:get_goal.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:get_openapi_spec.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:imagegen.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:interrupt_agent.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:js_add_node_module_dir.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:js_reset.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:js.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:list_agents.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:load_workspace_dependencies.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:read.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:request_user_input_async.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:request_user_input.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:run.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:search_openai_docs.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:send_message.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:sleep.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:spawn_agent.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:uidotsh_fetch.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:untrusted_input.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:update_goal.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:update_plan.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:view_image.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:wait_agent.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:wait.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/function_call:write_stdin.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/message:assistant.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/message:developer.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/message:user.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/reasoning.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/tool_search_call.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/tool_search_output.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/web_search_call.internal_chat_message_metadata_passthrough.turn_id",
		],
		rule: "bookkeeping",
	},
	{
		path: "*@metadata.**",
		agent: "codex",
		reason:
			"client bookkeeping (input order, MCP attribution status, retained-context markers)",
		except: [
			"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].server_name",
			"response_item/function_call_output@metadata.mcp_attribution.sources[].server_name",
			"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].tool_name",
			"response_item/function_call_output@metadata.mcp_attribution.sources[].tool_name",
			"response_item/message:*@metadata.retained_source.id.turn_id",
			"response_item/message:user@metadata.inherited_user_message",
			"response_item/agent_message@metadata.mcp_attribution.error_reason",
			"response_item/agent_message@metadata.mcp_attribution.status",
			"response_item/custom_tool_call_output@metadata.fallback_token_limit_override",
			"response_item/custom_tool_call_output@metadata.mcp_attribution.error_reason",
			"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].first_turn_id",
			"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].plugin_id",
			"response_item/custom_tool_call_output@metadata.mcp_attribution.status",
			"response_item/custom_tool_call:exec@metadata.mcp_attribution.sources[].first_turn_id",
			"response_item/custom_tool_call:exec@metadata.mcp_attribution.sources[].plugin_id",
			"response_item/custom_tool_call:exec@metadata.mcp_attribution.sources[].server_name",
			"response_item/custom_tool_call:exec@metadata.mcp_attribution.sources[].tool_name",
			"response_item/custom_tool_call:exec@metadata.mcp_attribution.status",
			"response_item/function_call_output@metadata.fallback_token_limit_override",
			"response_item/function_call_output@metadata.mcp_attribution.error_reason",
			"response_item/function_call_output@metadata.mcp_attribution.sources[].first_turn_id",
			"response_item/function_call_output@metadata.mcp_attribution.sources[].plugin_id",
			"response_item/function_call_output@metadata.mcp_attribution.status",
			"response_item/function_call:untrusted_input@metadata.mcp_attribution.sources[].first_turn_id",
			"response_item/function_call:untrusted_input@metadata.mcp_attribution.sources[].plugin_id",
			"response_item/function_call:untrusted_input@metadata.mcp_attribution.sources[].server_name",
			"response_item/function_call:untrusted_input@metadata.mcp_attribution.sources[].tool_name",
			"response_item/function_call:untrusted_input@metadata.mcp_attribution.status",
			"response_item/message:assistant@metadata.inherited_user_message",
			"response_item/message:developer@metadata.mcp_attribution.error_reason",
			"response_item/message:developer@metadata.mcp_attribution.sources[].first_turn_id",
			"response_item/message:developer@metadata.mcp_attribution.sources[].plugin_id",
			"response_item/message:developer@metadata.mcp_attribution.sources[].server_name",
			"response_item/message:developer@metadata.mcp_attribution.sources[].tool_name",
			"response_item/message:developer@metadata.mcp_attribution.status",
			"response_item/message:user@metadata.mcp_attribution.error_reason",
			"response_item/message:user@metadata.mcp_attribution.sources[].first_turn_id",
			"response_item/message:user@metadata.mcp_attribution.sources[].plugin_id",
			"response_item/message:user@metadata.mcp_attribution.sources[].server_name",
			"response_item/message:user@metadata.mcp_attribution.sources[].tool_name",
			"response_item/message:user@metadata.mcp_attribution.status",
			"response_item/reasoning@metadata.mcp_attribution.sources[].first_turn_id",
			"response_item/reasoning@metadata.mcp_attribution.sources[].plugin_id",
			"response_item/reasoning@metadata.mcp_attribution.sources[].server_name",
			"response_item/reasoning@metadata.mcp_attribution.sources[].tool_name",
			"response_item/reasoning@metadata.mcp_attribution.status",
		],
		rule: "bookkeeping",
	},
	{
		path: "assistant.message.role",
		reason: "always `assistant`",
		rule: "constant_watch",
		observedConstant: "assistant",
	},
	{
		path: "assistant.message.type",
		reason: "always `message`",
		rule: "constant_watch",
		observedConstant: "message",
	},
	{
		path: "user.message.role",
		reason: "always `user`",
		rule: "constant_watch",
		observedConstant: "user",
	},
	{
		path: "assistant.message.container",
		reason: "always null",
		rule: "constant_watch",
		observedConstant: null,
	},
	{
		path: "assistant.message.context_management",
		reason: "always null",
		rule: "constant_watch",
		observedConstant: null,
	},
	{
		path: "assistant.message.stop_sequence",
		reason:
			"the matched stop sequence text; stop_reason says a sequence stopped it",
		rule: "bookkeeping",
	},
	{
		path: "assistant.message.diagnostics",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "assistant.message.stop_details",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "assistant.message.input_transformations**",
		reason:
			"thinking blocks the harness dropped from the request; harness bookkeeping",
		rule: "bookkeeping",
		except: [
			"assistant.message.input_transformations[].path",
			"assistant.message.input_transformations[].reason",
			"assistant.message.input_transformations[].type",
		],
	},
	{
		path: "assistant.message.usage.fallback_credit",
		reason: "null without a fallback credit",
		rule: "constant_watch",
		observedConstant: null,
	},
	{
		path: "assistant.message.usage.iterations",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "assistant.message.usage.output_tokens_details",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "user.origin.body",
		reason: "the message a peer sent, kept as the prompt's text",
		rule: "text_copy",
	},
	{
		path: "user.origin.verifiedPeerPid",
		reason: "process id of a peer",
		rule: "bookkeeping",
		except: ["user.origin.verifiedPeerPid"],
	},
	{
		path: "user.origin.{*}",
		reason: "keys that are data",
		rule: "bookkeeping",
		except: ["user.origin.{*}"],
	},
	{
		path: "assistant.apiBlockIndex",
		reason: "position of the block in the API response",
		rule: "bookkeeping",
	},
	{
		path: "assistant.message.content[text].text",
		reason: "assistant text, stored as record text",
		rule: "text_copy",
	},
	{
		path: "assistant.message.content[thinking].thinking",
		reason: "reasoning text, stored as record text",
		rule: "text_copy",
	},
	{
		path: "assistant.message.content[thinking].signature",
		reason: "opaque signature of the reasoning block",
		rule: "text_copy",
	},
	{
		path: "assistant.message.content[redacted_thinking].data",
		reason: "encrypted reasoning",
		rule: "text_copy",
	},
	{
		path: "assistant.message.content[tool_use:*].caller.type",
		reason: 'Judge round 2 corpus constant "direct"; WATCH every future value.',
		rule: "constant_watch",
		observedConstant: "direct",
	},
	{
		path: "assistant.message.content[tool_use:*].input.**",
		except: [
			"assistant.message.content[tool_use:Bash].input.**",
			"assistant.message.content[tool_use:Agent].input.**",
			"assistant.message.content[tool_use:Bash].input.command",
			"assistant.message.content[tool_use:Bash].input.timeout",
			"assistant.message.content[tool_use:Monitor].input.timeout_ms",
			"assistant.message.content[tool_use:Bash].input.run_in_background",
			"assistant.message.content[tool_use:Agent].input.run_in_background",
			"assistant.message.content[tool_use:Read].input.file_path",
			"assistant.message.content[tool_use:Write].input.file_path",
			"assistant.message.content[tool_use:Edit].input.file_path",
			"assistant.message.content[tool_use:NotebookEdit].input.notebook_path",
			"assistant.message.content[tool_use:Grep].input.pattern",
			"assistant.message.content[tool_use:Glob].input.pattern",
			"assistant.message.content[tool_use:Agent].input.subagent_type",
			"assistant.message.content[tool_use:Agent].input.model",
			"assistant.message.content[tool_use:Agent].input.isolation",
			"assistant.message.content[tool_use:Skill].input.skill",
			"assistant.message.content[tool_use:Bash].input.dangerouslyDisableSandbox",
			"assistant.message.content[tool_use:Bash].input.description",
		],
		reason:
			"tool arguments: the whole input is the call's text (input_text); facts read from it are catalogued",
		rule: "text_copy",
	},
	{
		path: "assistant.message.content[tool_use:Bash].input.description",
		reason: "the agent's description of the command",
		rule: "text_copy",
		except: ["assistant.message.content[tool_use:Bash].input.description"],
	},
	{
		path: "assistant.message.content[tool_use:Agent].input.description",
		reason: "the agent's short label for the task",
		rule: "bookkeeping",
	},
	{
		path: "assistant.message.content[tool_use:Agent].input.prompt",
		reason:
			"the delegated task; the sub-agent's first prompt (subtype delegation)",
		rule: "bookkeeping",
	},
	{
		path: "user.message.content[image].source.data",
		reason: "image bytes; slimming replaces them with a marker",
		rule: "bookkeeping",
	},
	{
		path: "user.message.content[tool_result].content[*].**",
		reason: "result text and images, stored as the result's text",
		except: ["user.message.content[tool_result].content[text].text"],
		rule: "text_copy",
	},
	{
		path: "user.mcpMeta.*",
		reason: "MCP structured content and metadata; the tool's own payload",
		rule: "bookkeeping",
		except: ["user.mcpMeta._meta", "user.mcpMeta.structuredContent"],
	},
	{
		path: "user.sourceToolUseID",
		reason: "the call id a meta line belongs to",
		rule: "bookkeeping",
		except: ["user.sourceToolUseID"],
	},
	{
		path: "user.isVisibleInTranscriptOnly",
		reason: "display flag",
		rule: "bookkeeping",
	},
	{
		path: "user.queueSkipAttachments",
		reason: "queue delivery flag",
		rule: "bookkeeping",
		except: ["user.queueSkipAttachments"],
	},
	{
		path: "user.queueTranscriptOnly",
		reason: "queue delivery flag",
		rule: "bookkeeping",
		except: ["user.queueTranscriptOnly"],
	},
	{
		path: "user.turnCompanion",
		reason: "display grouping",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult[].**",
		reason: "MCP result content blocks, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.file.**",
		reason: "the file a Read returned; its text is the result",
		except: [
			"user.toolUseResult.file.totalLines",
			"user.toolUseResult.file.numLines",
			"user.toolUseResult.file.startLine",
			"user.toolUseResult.file.dimensions.**",
			"user.toolUseResult.file.originalSize",
			"user.toolUseResult.file.truncatedByTokenCap",
		],
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.filePath",
		reason:
			"Judge: 858/858 toolUseResult.filePath values equal the call's stored file_path.",
		rule: "verified_duplicate",
		verification:
			"Judge: 858/858 toolUseResult.filePath values equal the call's stored file_path.",
	},
	{
		path: "user.toolUseResult.oldString",
		reason: "the edit itself, stored as the file change",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.newString",
		reason: "the edit itself, stored as the file change",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.originalFile",
		reason: "the file before the edit",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.replaceAll",
		reason: "repeats the call's input",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.content",
		reason: "the written file or result body",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.content[*].**",
		reason: "result content blocks, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.structuredPatch",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.bashEditDiff.files[].hunks**",
		reason: "the diff body of a shell edit; shell_edit_files keeps the files",
		rule: "bookkeeping",
		except: [
			"user.toolUseResult.bashEditDiff.files[].hunks[].newLines",
			"user.toolUseResult.bashEditDiff.files[].hunks[].newStart",
			"user.toolUseResult.bashEditDiff.files[].hunks[].oldLines",
			"user.toolUseResult.bashEditDiff.files[].hunks[].oldStart",
		],
	},
	{
		path: "user.toolUseResult.type",
		reason: "the Read/Write result kind (text, image, create, update)",
		rule: "text_copy",
		except: ["user.toolUseResult.type"],
	},
	{
		path: "user.toolUseResult.isImage",
		reason:
			"whether the result is an image; image results are labelled in text",
		rule: "text_copy",
		except: ["user.toolUseResult.isImage"],
	},
	{
		path: "user.toolUseResult.description",
		reason: "repeats the call's description",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.prompt",
		reason: "repeats the call's prompt",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.command",
		reason: "repeats the call's command",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.query",
		reason: "repeats the call's query",
		rule: "bookkeeping",
		except: ["user.toolUseResult.query"],
	},
	{
		path: "user.toolUseResult.url",
		reason: "repeats the call's URL",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.result",
		reason: "the fetched page's text, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.results**",
		reason: "web search results, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.code",
		reason: "HTTP status of a fetched page; the fetch result text says it",
		rule: "text_copy",
		except: ["user.toolUseResult.code"],
	},
	{
		path: "user.toolUseResult.codeText",
		reason: "HTTP status text of a fetched page",
		rule: "text_copy",
		except: ["user.toolUseResult.codeText"],
	},
	{
		path: "user.toolUseResult.bytes",
		reason: "size of a fetched page",
		rule: "text_copy",
		except: ["user.toolUseResult.bytes"],
	},
	{
		path: "user.toolUseResult.searchCount",
		reason: "searches a web search made",
		rule: "bookkeeping",
		except: ["user.toolUseResult.searchCount"],
	},
	{
		path: "user.toolUseResult.filenames**",
		reason: "files a search matched, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.matches**",
		reason: "tool search matches, stored as the result's text",
		except: ["user.toolUseResult.matches[]"],
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.mode",
		reason:
			"the Grep output mode; repeats the call's input (see search_matches)",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.numLines",
		reason: "Grep line count (see search_matches)",
		rule: "bookkeeping",
		except: ["user.toolUseResult.numLines"],
	},
	{
		path: "user.toolUseResult.totalLines",
		reason: "Grep line total (see search_matches)",
		rule: "bookkeeping",
		except: ["user.toolUseResult.totalLines"],
	},
	{
		path: "user.toolUseResult.outputFile",
		reason: "where a background task writes its output",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.canReadOutputFile",
		reason: "whether that output file is readable",
		rule: "bookkeeping",
		except: ["user.toolUseResult.canReadOutputFile"],
	},
	{
		path: "user.toolUseResult.persistent",
		reason: "Monitor tool flag",
		rule: "bookkeeping",
		except: ["user.toolUseResult.persistent"],
	},
	{
		path: "user.toolUseResult.taskId",
		reason: "task list ids (TaskCreate, TaskUpdate)",
		rule: "bookkeeping",
		except: ["user.toolUseResult.taskId"],
	},
	{
		path: "user.toolUseResult.task_id",
		reason: "background task id of a stop request",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.task_type",
		reason: "background task kind of a stop request",
		rule: "bookkeeping",
		except: ["user.toolUseResult.task_type"],
	},
	{
		path: "user.toolUseResult.task.*",
		reason: "the created task list item",
		rule: "bookkeeping",
		except: ["user.toolUseResult.task.id"],
	},
	{
		path: "user.toolUseResult.updatedFields[]",
		reason: "task list fields a TaskUpdate changed",
		rule: "bookkeeping",
		except: ["user.toolUseResult.updatedFields[]"],
	},
	{
		path: "user.toolUseResult.statusChange.*",
		reason: "task list status change",
		except: [
			"user.toolUseResult.statusChange.from",
			"user.toolUseResult.statusChange.to",
		],
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.success",
		reason: "the tool's own success flag; is_error is the outcome",
		rule: "bookkeeping",
		except: ["user.toolUseResult.success"],
	},
	{
		path: "user.toolUseResult.message",
		reason: "the tool's message, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.commandName",
		reason: "repeats the skill name",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.allowedTools[]",
		reason: "tools a skill allows",
		rule: "bookkeeping",
		except: ["user.toolUseResult.allowedTools[]"],
	},
	{
		path: "user.toolUseResult.questions**",
		reason: "questions the agent asked the user, stored as text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.answers.*",
		reason: "the user's answers, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.pin.*",
		reason: "a pinned item's identity",
		except: ["user.toolUseResult.pin.**"],
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.display",
		reason: "display text",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.listing",
		reason: "a listing, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "user.toolUseResult.total_deferred_tools",
		reason: "tool search bookkeeping",
		rule: "bookkeeping",
		except: ["user.toolUseResult.total_deferred_tools"],
	},
	{
		path: "user.toolUseResult.memdirStamped",
		reason: "memory directory bookkeeping",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.harness*",
		reason: "harness note bookkeeping",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.canContinueAgent",
		reason: "whether a sub-agent can be resumed",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.stopped",
		reason: "a scheduled wakeup was stopped",
		rule: "bookkeeping",
	},
	{
		path: "user.toolUseResult.scheduledFor",
		reason: "when a wakeup is scheduled",
		rule: "bookkeeping",
		except: ["user.toolUseResult.scheduledFor"],
	},
	{
		path: "user.toolUseResult.cancelledWakeups",
		reason: "wakeups a schedule cancelled",
		rule: "bookkeeping",
		except: ["user.toolUseResult.cancelledWakeups"],
	},
	{
		path: "user.toolUseResult.clampedDelaySeconds",
		reason: "the wakeup delay after clamping",
		rule: "bookkeeping",
		except: ["user.toolUseResult.clampedDelaySeconds"],
	},
	{
		path: "user.toolUseResult.wasClamped",
		reason: "whether the wakeup delay was clamped",
		rule: "bookkeeping",
		except: ["user.toolUseResult.wasClamped"],
	},
	{
		path: "user.toolUseResult.{*}",
		reason: "keys that are data (answers keyed by question)",
		rule: "bookkeeping",
	},
	{
		path: "ai-title.sessionId",
		reason:
			"Restates stream identity; census checks consistency against the stream baseline and filename where available.",
		rule: "stream_identity",
		identity: "sessionId",
	},
	{
		path: "last-prompt.*",
		reason: "the harness's copy of the latest prompt, for resuming",
		rule: "bookkeeping",
	},
	{ path: "atis-latch.*", reason: "harness state latch", rule: "bookkeeping" },
	{
		path: "file-history-snapshot.**",
		reason: "file backup bookkeeping for undo",
		rule: "bookkeeping",
	},
	{
		path: "mode.sessionId",
		reason:
			"Restates stream identity; census checks consistency against the stream baseline and filename where available.",
		rule: "stream_identity",
		identity: "sessionId",
	},
	{
		path: "queue-operation.timestamp",
		reason: "record time",
		rule: "bookkeeping",
	},
	{
		path: "attachment/*.rendered**",
		reason: "the attachment as rendered into the context; its fields are read",
		rule: "text_copy",
		except: ["attachment/*.renderedRole"],
	},
	{
		path: "attachment/*.renderedInHumanTurn**",
		reason: "the attachment as rendered into a human turn",
		rule: "text_copy",
	},
	{
		path: "attachment/*.renderedBesideToolResult",
		reason: "rendering flag",
		rule: "bookkeeping",
	},
	{
		path: "attachment/total_tokens_reminder.**",
		reason: "context-size reminder text the harness injects",
		rule: "text_copy",
	},
	{
		path: "attachment/silent_turn_reminder.**",
		reason: "reminder text the harness injects",
		rule: "text_copy",
	},
	{
		path: "attachment/batching_reminder_sent.**",
		reason: "reminder text the harness injects",
		rule: "text_copy",
		except: [
			"attachment/batching_reminder_sent.attachment.clearAt",
			"attachment/batching_reminder_sent.attachment.model",
		],
	},
	{
		path: "attachment/date.**",
		reason: "today's date for the model",
		rule: "bookkeeping",
		except: ["attachment/date.attachment.date"],
	},
	{
		path: "attachment/date_change.**",
		reason: "date change notice",
		rule: "bookkeeping",
		except: [
			"attachment/date_change.attachment.newDate",
			"attachment/date_change.slug",
		],
	},
	{
		path: "attachment/credential_org.**",
		reason: "the account's organization id",
		rule: "bookkeeping",
		except: ["attachment/credential_org.attachment.organizationUuid"],
	},
	{
		path: "attachment/deferred_tools_record.**",
		reason: "tool definitions offered on demand",
		except: [
			"attachment/deferred_tools_record.attachment.tools[].name",
			"attachment/deferred_tools_record.attachment.entries[].name",
			"attachment/deferred_tools_record.attachment.nameOnlyAnnouncements[]",
			"attachment/deferred_tools_record.attachment.entries[].defer_loading",
			"attachment/deferred_tools_record.attachment.entries[].eager_input_streaming",
		],
		rule: "text_copy",
	},
	{
		path: "attachment/deferred_tools_delta.**",
		reason: "tool definitions offered on demand",
		except: [
			"attachment/deferred_tools_delta.attachment.needsAuthMcpServers[]",
			"attachment/deferred_tools_delta.attachment.pendingMcpServers[]",
			"attachment/deferred_tools_delta.attachment.failedMcpServers",
			"attachment/deferred_tools_delta.attachment.surfacedDefinitions[].definition.name",
			"attachment/deferred_tools_delta.attachment.addedTools[]",
			"attachment/deferred_tools_delta.attachment.addedNames[]",
			"attachment/deferred_tools_delta.attachment.readdedNames[]",
			"attachment/deferred_tools_delta.attachment.removedNames[]",
			"attachment/deferred_tools_delta.attachment.surfacedDefinitions[].name",
			"attachment/deferred_tools_delta.attachment.surfacedNames[]",
			"attachment/deferred_tools_delta.attachment.removedByBlock[]",
			"attachment/deferred_tools_delta.attachment.toolSearchAbsent",
			"attachment/deferred_tools_delta.slug",
		],
		rule: "text_copy",
	},
	{
		path: "attachment/agent_listing_delta.**",
		reason: "sub-agent types offered to the model",
		rule: "bookkeeping",
		except: [
			"attachment/agent_listing_delta.attachment.addedTypes[]",
			"attachment/agent_listing_delta.attachment.builtInTypes[]",
			"attachment/agent_listing_delta.slug",
		],
	},
	{
		path: "attachment/task_reminder.**",
		reason: "the task list as reminded to the model",
		rule: "bookkeeping",
		except: ["attachment/task_reminder.slug"],
	},
	{
		path: "attachment/thinking_drop.**",
		reason: "reasoning blocks the harness dropped; harness bookkeeping",
		except: [
			"attachment/thinking_drop.attachment.newlyDropped.**",
			"attachment/thinking_drop.attachment.totalDropped.**",
			"attachment/thinking_drop.attachment.newlyDropped.blockCount",
			"attachment/thinking_drop.attachment.newlyDropped.turnCount",
			"attachment/thinking_drop.attachment.thinkingBlocksSent",
			"attachment/thinking_drop.attachment.thinkingTurnsSent",
			"attachment/thinking_drop.attachment.model",
			"attachment/thinking_drop.attachment.querySource",
			"attachment/thinking_drop.attachment.requestId",
		],
		rule: "text_copy",
	},
	{
		path: "attachment/read_truncation_notice.**",
		reason: "notice that a read was cut",
		rule: "bookkeeping",
		except: ["attachment/read_truncation_notice.attachment.toolUseID"],
	},
	{
		path: "attachment/session_context.**",
		reason: "git status and account shown to the model, kept as meta text",
		rule: "text_copy",
		except: [
			"attachment/session_context.attachment.context.gitStatus",
			"attachment/session_context.attachment.context.userEmail",
		],
	},
	{
		path: "attachment/remote_session_change.**",
		reason: "remote session state (managed commit or PR), kept as meta text",
		rule: "text_copy",
		except: ["attachment/remote_session_change.attachment.commit"],
	},
	{
		path: "attachment/environment.attachment.snapshot.platform",
		reason: "machine description",
		rule: "text_copy",
		except: ["attachment/environment.attachment.snapshot.platform"],
	},
	{
		path: "attachment/environment.attachment.snapshot.osVersion",
		reason: "machine description",
		rule: "text_copy",
		except: ["attachment/environment.attachment.snapshot.osVersion"],
	},
	{
		path: "attachment/environment.attachment.snapshot.shell",
		reason: "machine description",
		rule: "text_copy",
		except: ["attachment/environment.attachment.snapshot.shell"],
	},
	{
		path: "attachment/environment.attachment.snapshot.isGitRepo",
		reason: "machine description",
		rule: "text_copy",
		except: ["attachment/environment.attachment.snapshot.isGitRepo"],
	},
	{
		path: "attachment/environment.attachment.snapshot.isWorktree",
		reason: "machine description",
		rule: "text_copy",
		except: ["attachment/environment.attachment.snapshot.isWorktree"],
	},
	{
		path: "attachment/environment.attachment.snapshot.additionalWorkingDirectories**",
		reason: "machine description",
		rule: "text_copy",
		except: [
			"attachment/environment.attachment.snapshot.additionalWorkingDirectories[]",
		],
	},
	{
		path: "attachment/environment.attachment.changes[].{*}",
		reason: "changes to that description",
		rule: "text_copy",
		except: ["attachment/environment.attachment.changes[].{*}"],
	},
	{
		path: "attachment/model.attachment.identity.knowledgeCutoff",
		reason: "model description",
		rule: "text_copy",
		except: ["attachment/model.attachment.identity.knowledgeCutoff"],
	},
	{
		path: "attachment/model.attachment.identity.marketingName",
		reason: "model description",
		rule: "text_copy",
		except: ["attachment/model.attachment.identity.marketingName"],
	},
	{
		path: "attachment/model.attachment.text",
		reason: "model description text",
		rule: "text_copy",
	},
	{
		path: "attachment/prompt_snapshot.attachment.tools**",
		reason: "tool definitions sent with the request",
		except: [
			"attachment/prompt_snapshot.attachment.tools[].name",
			"attachment/prompt_snapshot.attachment.tools[].server",
		],
		rule: "text_copy",
	},
	{
		path: "attachment/prompt_snapshot.attachment.*",
		except: [
			"attachment/prompt_snapshot.attachment.systemPrompt**",
			"attachment/prompt_snapshot.attachment.inlineTools",
		],
		reason: "request snapshot bookkeeping",
		rule: "bookkeeping",
	},
	{
		path: "attachment/instructions.attachment.changed",
		reason: "whether the instructions changed since the last load",
		rule: "bookkeeping",
	},
	{
		path: "attachment/instructions.attachment.reason",
		reason: "why the instructions were loaded",
		rule: "bookkeeping",
	},
	{
		path: "attachment/nested_memory.attachment.displayPath",
		reason: "display form of the path",
		rule: "bookkeeping",
		except: ["attachment/nested_memory.attachment.displayPath"],
	},
	{
		path: "attachment/nested_memory.attachment.content.path",
		reason: "repeats the path",
		rule: "bookkeeping",
	},
	{
		path: "attachment/nested_memory.attachment.content.type",
		reason: "memory file kind",
		rule: "bookkeeping",
	},
	{
		path: "attachment/nested_memory.attachment.content.contentDiffersFromDisk",
		reason: "Judge round 2 corpus constant false; WATCH every future value.",
		rule: "constant_watch",
		observedConstant: false,
	},
	{
		path: "attachment/mcp_instructions_delta.attachment.*",
		reason: "MCP server instructions, kept as injected text",
		rule: "text_copy",
	},
	{
		path: "attachment/mcp_instructions_delta.attachment.*[]",
		reason: "MCP server instructions, kept as injected text",
		except: [
			"attachment/mcp_instructions_delta.attachment.removedNames[]",
			"attachment/mcp_instructions_delta.attachment.addedBlocks[]",
		],
		rule: "text_copy",
	},
	{
		path: "attachment/skill_listing.attachment.*",
		reason: "the skills offered to the model, kept as injected text",
		except: [
			"attachment/skill_listing.attachment.content",
			"attachment/skill_listing.attachment.isInitial",
			"attachment/skill_listing.attachment.skillCount",
		],
		rule: "text_copy",
	},
	{
		path: "attachment/skill_listing.attachment.*[]",
		reason: "the skills offered to the model, kept as injected text",
		rule: "text_copy",
		except: ["attachment/skill_listing.attachment.names[]"],
	},
	{
		path: "attachment/command_permissions.attachment.**",
		reason: "tools a slash command allows, kept as meta text",
		rule: "text_copy",
	},
	{
		path: "attachment/queued_command.attachment.*",
		except: [
			"attachment/queued_command.attachment.origin**",
			"attachment/queued_command.attachment.prompt",
			"attachment/queued_command.attachment.commandMode",
			"attachment/queued_command.attachment.delivery_id",
			"attachment/queued_command.attachment.runId",
			"attachment/queued_command.attachment.source_uuid",
			"attachment/queued_command.attachment.timestamp",
		],
		reason: "queue delivery bookkeeping",
		rule: "bookkeeping",
	},
	{
		path: "attachment/queued_command.attachment.prompt[]**",
		reason: "queued prompt text and images, stored as the prompt's text",
		rule: "text_copy",
		except: [
			"attachment/queued_command.attachment.prompt[].source.media_type",
			"attachment/queued_command.attachment.prompt[].source.type",
			"attachment/queued_command.attachment.prompt[].type",
		],
	},
	{
		path: "attachment/queued_command.attachment.usage.*",
		reason: "usage a background task reported in its notification text",
		rule: "bookkeeping",
		except: [
			"attachment/queued_command.attachment.usage.durationMs",
			"attachment/queued_command.attachment.usage.toolUses",
			"attachment/queued_command.attachment.usage.totalTokens",
		],
	},
	{
		path: "attachment/queued_command.attachment.origin.**",
		except: [
			"attachment/queued_command.attachment.origin.kind",
			"attachment/queued_command.attachment.origin.{*}",
			"attachment/queued_command.attachment.origin.from",
			"attachment/queued_command.attachment.origin.fromMode",
			"attachment/queued_command.attachment.origin.hopChain[]",
			"attachment/queued_command.attachment.origin.name",
			"attachment/queued_command.attachment.origin.producer",
			"attachment/queued_command.attachment.origin.senderTaskId",
			"attachment/queued_command.attachment.origin.verifiedPeerPid",
		],
		reason: "origin details (see prompt_origin's gap)",
		rule: "bookkeeping",
	},
	{
		path: "attachment/plan_mode.attachment.*",
		except: ["attachment/plan_mode.attachment.planFilePath"],
		reason: "plan mode reminder bookkeeping",
		rule: "text_copy",
	},
	{
		path: "system/*.content",
		reason: "system notice text, kept as meta text",
		except: ["system/compact_boundary.content"],
		rule: "text_copy",
	},
	{
		path: "system/*.level",
		reason: "notice level",
		rule: "bookkeeping",
		except: [
			"system/api_error.level",
			"system/informational.level",
			"system/model_refusal_fallback.level",
			"system/model_refusal_no_fallback.level",
			"system/stop_hook_summary.level",
		],
	},
	{
		path: "system/*.isMeta",
		reason: "marks harness-written lines",
		rule: "bookkeeping",
	},
	{
		path: "system/*.toolUseID",
		reason: "the call a hook summary belongs to",
		rule: "bookkeeping",
		except: ["system/stop_hook_summary.toolUseID"],
	},
	{
		path: "system/*.hasOutput",
		reason: "whether a hook printed output",
		rule: "bookkeeping",
	},
	{
		path: "system/*.hookAdditionalContext**",
		reason: "hook output added to the context, kept as meta text",
		rule: "text_copy",
	},
	{
		path: "system/*.requestId",
		reason: "API request id",
		rule: "bookkeeping",
		except: [
			"system/model_refusal_fallback.requestId",
			"system/model_refusal_no_fallback.requestId",
		],
	},
	{
		path: "system/*.apiRefusalExplanation",
		reason: "refusal explanation text, kept as meta text",
		rule: "text_copy",
	},
	{
		path: "system/*.direction",
		reason: "fallback direction",
		rule: "bookkeeping",
	},
	{
		path: "system/*.scope",
		reason: "fallback scope",
		rule: "bookkeeping",
		except: ["system/model_refusal_fallback.scope"],
	},
	{
		path: "system/*.trigger",
		reason: "always `refusal`",
		rule: "constant_watch",
		observedConstant: "refusal",
	},
	{
		path: "system/*.source",
		reason: "retry kind (connection or request)",
		rule: "bookkeeping",
		except: ["system/api_error.source"],
	},
	{
		path: "system/api_error.error.connection.isSSLError",
		reason: "connection flag; the error text says it",
		rule: "bookkeeping",
	},
	{
		path: "system/api_error.error.connection.message",
		reason: "connection error text, kept as meta text",
		rule: "text_copy",
		except: ["system/api_error.error.connection.message"],
	},
	{
		path: "system/api_error.error.connection",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "system/api_error.error.noResponse",
		reason: "always null",
		rule: "constant_watch",
		observedConstant: null,
	},
	{
		path: "system/api_error.error.rateLimits",
		reason: "always null",
		rule: "constant_watch",
		observedConstant: null,
	},
	{
		path: "session_meta/.id",
		reason: "the thread id; the upload names the session",
		rule: "bookkeeping",
	},
	{
		path: "session_meta/.session_id",
		reason: "the session id",
		rule: "bookkeeping",
		except: ["session_meta/.session_id"],
	},
	{
		path: "session_meta/.timestamp",
		reason: "session start time",
		rule: "bookkeeping",
		except: ["session_meta/.timestamp"],
	},
	{
		path: "session_meta/.history_mode",
		reason: "rollout format",
		rule: "bookkeeping",
		except: ["session_meta/.history_mode"],
	},
	{
		path: "session_meta/.multi_agent_version",
		reason: "rollout format",
		rule: "bookkeeping",
		except: ["session_meta/.multi_agent_version"],
	},
	{
		path: "session_meta/.subagent_history_start_ordinal",
		reason: "rollout format",
		rule: "bookkeeping",
		except: ["session_meta/.subagent_history_start_ordinal"],
	},
	{
		path: "session_meta/.context_window.window_id",
		reason: "context window id (see compacted)",
		rule: "bookkeeping",
	},
	{
		path: "session_meta/.dynamic_tools**",
		reason: "tool definitions offered to the model",
		except: [
			"session_meta/.dynamic_tools[].tools[].name",
			"session_meta/.dynamic_tools[].name",
			"session_meta/.dynamic_tools[].tools[].deferLoading",
			"session_meta/.dynamic_tools[].type",
		],
		rule: "text_copy",
	},
	{
		path: "session_meta/.runtime_workspace_roots[]",
		reason: "workspace roots (see cwd)",
		rule: "bookkeeping",
		except: ["session_meta/.runtime_workspace_roots[]"],
	},
	{
		path: "session_meta/.base_instructions.provenance.*",
		reason: "where the base instructions came from",
		rule: "bookkeeping",
		except: [
			"session_meta/.base_instructions.provenance.model",
			"session_meta/.base_instructions.provenance.type",
		],
	},
	{
		path: "session_meta/.git",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "turn_context/.summary",
		reason: "reasoning summary setting",
		rule: "text_copy",
		except: ["turn_context/.summary"],
	},
	{
		path: "turn_context/.personality",
		reason: "personality setting",
		rule: "bookkeeping",
		except: ["turn_context/.personality"],
	},
	{
		path: "turn_context/.current_date",
		reason: "today's date for the model",
		rule: "bookkeeping",
		except: ["turn_context/.current_date"],
	},
	{
		path: "turn_context/.timezone",
		reason: "the user's time zone",
		rule: "bookkeeping",
		except: ["turn_context/.timezone"],
	},
	{
		path: "turn_context/.comp_hash",
		reason: "internal hash",
		rule: "bookkeeping",
	},
	{
		path: "turn_context/.realtime_active",
		reason: "voice mode flag",
		rule: "bookkeeping",
		except: ["turn_context/.realtime_active"],
	},
	{
		path: "turn_context/.cyber_access_program",
		reason: "access program flag",
		rule: "bookkeeping",
		except: ["turn_context/.cyber_access_program"],
	},
	{
		path: "turn_context/.multi_agent_mode",
		reason: "multi-agent setting",
		rule: "bookkeeping",
		except: ["turn_context/.multi_agent_mode"],
	},
	{
		path: "turn_context/.multi_agent_version",
		reason: "rollout format",
		rule: "bookkeeping",
		except: ["turn_context/.multi_agent_version"],
	},
	{
		path: "turn_context/.disabled_plugin_ids",
		reason: "disabled plugins",
		rule: "bookkeeping",
	},
	{
		path: "turn_context/.workspace_roots[]",
		reason: "workspace roots (see cwd)",
		rule: "bookkeeping",
		except: ["turn_context/.workspace_roots[]"],
	},
	{
		path: "turn_context/.truncation_policy.*",
		reason: "output truncation setting",
		rule: "bookkeeping",
		except: [
			"turn_context/.truncation_policy.limit",
			"turn_context/.truncation_policy.mode",
		],
	},
	{
		path: "turn_context/.sandbox_policy.writable_roots[]",
		reason: "sandbox detail (see sandbox_policy)",
		rule: "bookkeeping",
		except: ["turn_context/.sandbox_policy.writable_roots[]"],
	},
	{
		path: "turn_context/.sandbox_policy.exclude_*",
		reason: "sandbox detail (see sandbox_policy)",
		rule: "bookkeeping",
		except: [
			"turn_context/.sandbox_policy.exclude_slash_tmp",
			"turn_context/.sandbox_policy.exclude_tmpdir_env_var",
		],
	},
	{
		path: "turn_context/.sandbox_policy",
		reason: "older string form; see sandbox_policy",
		rule: "bookkeeping",
	},
	{
		path: "turn_context/.permission_profile.file_system**",
		reason: "permission profile detail (see permission_profile)",
		rule: "bookkeeping",
		except: [
			"turn_context/.permission_profile.file_system.entries[].access",
			"turn_context/.permission_profile.file_system.entries[].missing_path_behavior",
			"turn_context/.permission_profile.file_system.entries[].path.path",
			"turn_context/.permission_profile.file_system.entries[].path.type",
			"turn_context/.permission_profile.file_system.entries[].path.value.kind",
			"turn_context/.permission_profile.file_system.entries[].path.value.subpath",
			"turn_context/.permission_profile.file_system.type",
		],
	},
	{
		path: "turn_context/.permission_profile.network",
		reason: "permission profile detail (see permission_profile)",
		rule: "bookkeeping",
		except: ["turn_context/.permission_profile.network"],
	},
	{
		path: "turn_context/.file_system_sandbox_policy**",
		reason: "sandbox detail (see sandbox_policy)",
		except: [
			"turn_context/.file_system_sandbox_policy.entries[].access",
			"turn_context/.file_system_sandbox_policy.entries[].missing_path_behavior",
			"turn_context/.file_system_sandbox_policy.entries[].path.path",
			"turn_context/.file_system_sandbox_policy.entries[].path.type",
			"turn_context/.file_system_sandbox_policy.entries[].path.value.kind",
			"turn_context/.file_system_sandbox_policy.entries[].path.value.subpath",
			"turn_context/.file_system_sandbox_policy.kind",
		],
		rule: "bookkeeping",
	},
	{
		path: "turn_context/.collaboration_mode.settings.developer_instructions",
		reason: "the mode's instructions; developer messages carry them",
		rule: "bookkeeping",
		except: [
			"turn_context/.collaboration_mode.settings.developer_instructions",
		],
	},
	{
		path: "event_msg/thread_settings_applied.thread_id",
		reason: "the thread id",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/thread_settings_applied.thread_settings.*",
		except: [
			"event_msg/thread_settings_applied.thread_settings.model",
			"event_msg/thread_settings_applied.thread_settings.reasoning_effort",
			"event_msg/thread_settings_applied.thread_settings.service_tier",
			"event_msg/thread_settings_applied.thread_settings.approval_policy",
			"event_msg/thread_settings_applied.thread_settings.approvals_reviewer",
			"event_msg/thread_settings_applied.thread_settings.cwd",
			"event_msg/thread_settings_applied.thread_settings.model_provider_id",
			"event_msg/thread_settings_applied.thread_settings.personality",
			"event_msg/thread_settings_applied.thread_settings.reasoning_summary",
		],
		reason: "thread settings detail (personality, summary, plugins, roots)",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/thread_settings_applied.thread_settings.*[]",
		reason: "thread settings detail (workspace roots, plugins)",
		except: [
			"event_msg/thread_settings_applied.thread_settings.disabled_plugin_ids[]",
			"event_msg/thread_settings_applied.thread_settings.runtime_workspace_roots[]",
		],
		rule: "bookkeeping",
	},
	{
		path: "event_msg/thread_settings_applied.thread_settings.*.**",
		except: [
			"event_msg/thread_settings_applied.thread_settings.permission_profile.type",
			"event_msg/thread_settings_applied.thread_settings.active_permission_profile.id",
			"event_msg/thread_settings_applied.thread_settings.collaboration_mode.settings.developer_instructions",
			"event_msg/thread_settings_applied.thread_settings.collaboration_mode.settings.reasoning_effort",
			"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].access",
			"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].missing_path_behavior",
			"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].path.path",
			"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].path.type",
			"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].path.value.kind",
			"event_msg/thread_settings_applied.thread_settings.permission_profile.network",
		],
		reason: "thread settings detail",
		rule: "bookkeeping",
	},
	{
		path: "world_state/.**",
		except: [
			"world_state/.state.agents_md.*",
			"world_state/.state.permissions.approved_command_prefixes[][]",
			"world_state/.state.environments.environments.local.cwd",
			"world_state/.state.agents_md.directory",
			"world_state/.state.agents_md.text",
			"world_state/.state.apps_instructions",
			"world_state/.state.collaboration_mode",
			"world_state/.state.collaboration_mode.mode",
			"world_state/.state.collaboration_mode.model",
			"world_state/.state.environments_instructions",
			"world_state/.state.environments.current_date",
			"world_state/.state.environments.environments.local.shell",
			"world_state/.state.environments.environments.local.status",
			"world_state/.state.environments.timezone",
			"world_state/.state.git_attribution",
			"world_state/.state.host_skills.includeInstructions",
			"world_state/.state.multi_agent_mode.mode",
			"world_state/.state.orchestrator_skills.enabled",
			"world_state/.state.orchestrator_skills.includeInstructions",
			"world_state/.state.personality.personality",
			"world_state/.state.plugins_instructions",
			"world_state/.state.realtime.active",
			"world_state/.state.skills.includeInstructions",
		],
		reason:
			"the harness's state snapshot (flags, hints, environment), injected as developer text",
		rule: "bookkeeping",
	},
	{
		path: "response_item/message:*.role",
		reason: "repeats the role in the path",
		rule: "bookkeeping",
	},
	{
		path: "response_item/message:assistant.content[output_text].text",
		reason: "assistant text, stored as record text",
		rule: "text_copy",
	},
	{
		path: "response_item/message:*.agent.agent_name",
		reason: "in-file sub-agent attribution; becomes the record's agent id",
		rule: "bookkeeping",
	},
	{
		path: "response_item/reasoning.**",
		reason: "reasoning summary text, stored as record text; encrypted content",
		rule: "text_copy",
		except: [
			"response_item/reasoning.internal_chat_message_metadata_passthrough.turn_id",
		],
	},
	{
		path: "response_item/agent_message.content[encrypted_content].encrypted_content",
		reason: "encrypted message",
		rule: "text_copy",
	},
	{
		path: "response_item/web_search_call.**",
		except: [
			"response_item/web_search_call.action.type",
			"response_item/web_search_call.action.queries[]",
			"response_item/web_search_call.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/web_search_call.status",
		],
		reason: "search query and page, stored as the call's text",
		rule: "text_copy",
	},
	{
		path: "response_item/tool_search_call.**",
		reason: "tool search query, stored as the call's text",
		rule: "text_copy",
		except: [
			"response_item/tool_search_call.call_id",
			"response_item/tool_search_call.execution",
			"response_item/tool_search_call.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/tool_search_call.status",
		],
	},
	{
		path: "response_item/tool_search_output.**",
		reason: "tools found, stored as the output's text",
		except: [
			"response_item/tool_search_output.tools[].name",
			"response_item/tool_search_output.call_id",
			"response_item/tool_search_output.execution",
			"response_item/tool_search_output.internal_chat_message_metadata_passthrough.turn_id",
			"response_item/tool_search_output.status",
			"response_item/tool_search_output.tools[].tools[].defer_loading",
			"response_item/tool_search_output.tools[].tools[].name",
			"response_item/tool_search_output.tools[].tools[].strict",
		],
		rule: "text_copy",
	},
	{
		path: "response_item/function_call:*.status",
		reason: "always `completed`",
		rule: "constant_watch",
		observedConstant: "completed",
	},
	{
		path: "response_item/custom_tool_call_output.name",
		reason: "repeats the call's tool name",
		rule: "bookkeeping",
	},
	{
		path: "response_item/custom_tool_call:*.status",
		reason: "always `completed`",
		rule: "constant_watch",
		observedConstant: "completed",
		except: [
			"response_item/custom_tool_call:apply_patch.status",
			"response_item/custom_tool_call:exec.status",
		],
	},
	{
		path: "response_item/function_call:*.arguments.**",
		except: [
			"response_item/function_call:exec_command.arguments.**",
			"response_item/function_call:spawn_agent.arguments.**",
			"response_item/function_call:write_stdin.arguments.**",
			"response_item/function_call:exec_command.arguments.cmd",
			"response_item/function_call:spawn_agent.arguments.items",
			"response_item/function_call:exec_command.arguments.timeout_ms",
			"response_item/function_call:write_stdin.arguments.session_id",
			"response_item/function_call:wait.arguments.cell_id",
			"response_item/function_call:list_mcp_resources.arguments.server",
			"response_item/function_call:view_image.arguments.path",
			"response_item/function_call:spawn_agent.arguments.agent_type",
			"response_item/function_call:spawn_agent.arguments.model",
			"response_item/function_call:spawn_agent.arguments.reasoning_effort",
			"response_item/function_call:exec_command.arguments.sandbox_permissions",
			"response_item/function_call:exec_command.arguments.justification",
			"response_item/function_call:exec_command.arguments.prefix_rule[]",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].access",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].missing_path_behavior",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.path",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.pattern",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.type",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.value.kind",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.value.path",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.value.subpath",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.glob_scan_max_depth",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.read[]",
			"response_item/function_call:exec_command.arguments.additional_permissions.file_system.write[]",
			"response_item/function_call:exec_command.arguments.additional_permissions.network.enabled",
			"response_item/function_call:exec_command.arguments.environment_id",
			"response_item/function_call:exec_command.arguments.{*}",
			"response_item/function_call:exec_command.arguments.chars",
			"response_item/function_call:exec_command.arguments.login",
			"response_item/function_call:exec_command.arguments.max_output_tokens",
			"response_item/function_call:exec_command.arguments.session_id",
			"response_item/function_call:exec_command.arguments.shell",
			"response_item/function_call:exec_command.arguments.tty",
			"response_item/function_call:exec_command.arguments.yield_time_ms",
		],
		reason:
			"tool arguments: the whole input is the call's text (input_text); facts read from it are catalogued",
		rule: "text_copy",
	},
	{
		path: "response_item/function_call:exec_command.arguments.max_output_tokens",
		reason: "output limit the agent asked for",
		rule: "bookkeeping",
		except: [
			"response_item/function_call:exec_command.arguments.max_output_tokens",
		],
	},
	{
		path: "response_item/function_call:exec_command.arguments.yield_time_ms",
		reason: "how long to wait before returning a running command",
		rule: "bookkeeping",
		except: [
			"response_item/function_call:exec_command.arguments.yield_time_ms",
		],
	},
	{
		path: "response_item/function_call:exec_command.arguments.tty",
		reason: "terminal flag",
		rule: "bookkeeping",
		except: ["response_item/function_call:exec_command.arguments.tty"],
	},
	{
		path: "response_item/function_call:exec_command.arguments.login",
		reason: "login-shell flag",
		rule: "bookkeeping",
		except: ["response_item/function_call:exec_command.arguments.login"],
	},
	{
		path: "response_item/function_call:exec_command.arguments.shell",
		reason: "the shell the agent asked for",
		rule: "bookkeeping",
		except: ["response_item/function_call:exec_command.arguments.shell"],
	},
	{
		path: "response_item/function_call:exec_command.arguments.env.{*}",
		reason: "environment variables passed to the command",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:exec_command.arguments.{*}",
		reason: "malformed argument keys",
		rule: "bookkeeping",
		except: ["response_item/function_call:exec_command.arguments.{*}"],
	},
	{
		path: "response_item/function_call:exec_command.arguments.session_id",
		reason: "a write to a running session (older form)",
		rule: "bookkeeping",
		except: ["response_item/function_call:exec_command.arguments.session_id"],
	},
	{
		path: "response_item/function_call:exec_command.arguments.chars",
		reason: "input written to a running session (older form)",
		rule: "bookkeeping",
		except: ["response_item/function_call:exec_command.arguments.chars"],
	},
	{
		path: "response_item/function_call:write_stdin.arguments.chars",
		reason: "input written to a running command",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:write_stdin.arguments.max_output_tokens",
		reason: "output limit",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:write_stdin.arguments.yield_time_ms",
		reason: "how long to wait",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call:spawn_agent.arguments.message",
		reason: "the delegated task; the sub-agent's first prompt",
		rule: "bookkeeping",
	},
	{
		path: "response_item/function_call_output.output[*].**",
		reason: "output text and images, stored as the result's text",
		except: [
			"response_item/function_call_output.output[input_text].text~Process exited with code",
			"response_item/function_call_output.output[input_text].text~Wall time",
			"response_item/function_call_output.output[input_text].text",
			"response_item/function_call_output.output[input_image].detail",
			"response_item/function_call_output.output[input_text].text~Script running with cell ID",
		],
		rule: "text_copy",
	},
	{
		path: "response_item/custom_tool_call_output.output[*].**",
		reason: "output text and images, stored as the result's text",
		except: [
			"response_item/custom_tool_call_output.output[input_text].text~Exit code",
			"response_item/custom_tool_call_output.output[input_text].text~Rejected",
			"response_item/custom_tool_call_output.output[input_text].text~Wall time",
			"response_item/custom_tool_call_output.output[input_text].text~Script running with cell ID",
			"response_item/custom_tool_call_output.output[input_text].text",
			"response_item/custom_tool_call_output.output[input_image].detail",
		],
		rule: "text_copy",
	},
	{
		path: "response_item/custom_tool_call_output.output.output",
		reason: "output text inside the transport envelope",
		rule: "text_copy",
	},
	{
		path: "response_item/function_call_output.output.output",
		reason: "output text inside the transport envelope",
		rule: "text_copy",
	},
	{
		path: "response_item/*_output.output~Chunk ID",
		reason: "output framing: the chunk id of a long output",
		rule: "bookkeeping",
	},
	{
		path: "response_item/*_output.output~Original token count",
		reason: "output framing: the output's size before truncation",
		rule: "bookkeeping",
		except: ["response_item/function_call_output.output~Original token count"],
	},
	{
		path: "response_item/*_output.output[input_text].text~*",
		reason:
			"framing inside output blocks; the same conventions as plain output",
		except: [
			"response_item/function_call_output.output[input_text].text~Process exited with code",
			"response_item/custom_tool_call_output.output[input_text].text~Exit code",
			"response_item/custom_tool_call_output.output[input_text].text~Rejected",
			"response_item/function_call_output.output[input_text].text~Wall time",
			"response_item/custom_tool_call_output.output[input_text].text~Wall time",
			"response_item/custom_tool_call_output.output[input_text].text~Script running with cell ID",
			"response_item/function_call_output.output[input_text].text~Script running with cell ID",
		],
		rule: "bookkeeping",
	},
	{
		path: "response_item/*_output.output~unable to locate image at",
		reason:
			"an image a tool could not load, inside a script's error output; a view_image call's own output is is_error",
		except: [
			"response_item/function_call_output.output~unable to locate image at",
		],
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:CommandExecution.aggregated_output",
		reason: "command output, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:CommandExecution.formatted_output",
		reason: "command output, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:CommandExecution.process_id",
		reason: "process id",
		rule: "bookkeeping",
		except: ["event_msg/item_completed:CommandExecution.process_id"],
	},
	{
		path: "event_msg/item_completed:CommandExecution.script_path",
		reason: "rare script path",
		rule: "bookkeeping",
		except: ["event_msg/item_completed:CommandExecution.script_path"],
	},
	{
		path: "event_msg/exec_command_end.aggregated_output",
		reason: "command output, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/exec_command_end.formatted_output",
		reason: "command output, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/exec_command_end.command[]",
		reason: "repeats the call's command",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/exec_command_end.process_id",
		reason: "process id",
		rule: "bookkeeping",
		except: ["event_msg/exec_command_end.process_id"],
	},
	{
		path: "event_msg/exec_command_end.status",
		reason: "repeats the exit code's outcome",
		rule: "bookkeeping",
		except: ["event_msg/exec_command_end.status"],
	},
	{
		path: "event_msg/exec_command_end.turn_id",
		reason: "turn id (see turn_id)",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/patch_apply_end.changes.{*}.content",
		reason: "file content of an added file",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/patch_apply_end.stdout",
		reason: "patch output, stored as text",
		rule: "text_copy",
	},
	{
		path: "event_msg/patch_apply_end.stderr",
		reason: "patch output, stored as text",
		rule: "text_copy",
	},
	{
		path: "event_msg/patch_apply_end.status",
		reason: "repeats success",
		rule: "bookkeeping",
		except: ["event_msg/patch_apply_end.status"],
	},
	{
		path: "event_msg/patch_apply_end.turn_id",
		reason: "turn id (see turn_id)",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:FileChange.changes.{*}.content",
		reason: "file content of an added file, stored as the file change's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:FileChange.stdout",
		reason: "patch output, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:FileChange.stderr",
		reason: "patch output, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:McpToolCall.arguments",
		reason: "tool arguments, stored as the call's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:McpToolCall.result.**",
		except: [
			"event_msg/item_completed:McpToolCall.result.isError",
			"event_msg/item_completed:McpToolCall.result._meta",
			"event_msg/item_completed:McpToolCall.result.content[image]._meta",
			"event_msg/item_completed:McpToolCall.result.content[image].mimeType",
			"event_msg/item_completed:McpToolCall.result.content[resource_link]._meta",
			"event_msg/item_completed:McpToolCall.result.content[resource_link].mimeType",
			"event_msg/item_completed:McpToolCall.result.content[resource_link].name",
			"event_msg/item_completed:McpToolCall.result.content[resource_link].uri",
			"event_msg/item_completed:McpToolCall.result.structuredContent",
		],
		reason: "tool result, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:McpToolCall.error.message",
		reason: "tool error, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:McpToolCall.linkId",
		reason: "connector link id",
		rule: "bookkeeping",
		except: ["event_msg/item_completed:McpToolCall.linkId"],
	},
	{
		path: "event_msg/item_completed:DynamicToolCall.arguments",
		reason: "tool arguments, stored as the call's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:DynamicToolCall.content_items**",
		reason: "tool result, stored as the result's text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:DynamicToolCall.success",
		reason: "used for the call's outcome (is_error)",
		rule: "bookkeeping",
		except: ["event_msg/item_completed:DynamicToolCall.success"],
	},
	{
		path: "event_msg/item_completed:WebSearch.**",
		reason: "search query and results, stored as the call's and result's text",
		except: [
			"event_msg/item_completed:WebSearch.id",
			"event_msg/item_completed:WebSearch.action.queries[]",
			"event_msg/item_completed:WebSearch.action.type",
			"event_msg/item_completed:WebSearch.results[].domain",
			"event_msg/item_completed:WebSearch.results[].ref_id",
			"event_msg/item_completed:WebSearch.results[].thumbnail_url",
		],
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:Extension.**",
		except: [
			"event_msg/item_completed:Extension.durationMs",
			"event_msg/item_completed:Extension.savedPath",
			"event_msg/item_completed:Extension.kind",
			"event_msg/item_completed:Extension.id",
			"event_msg/item_completed:Extension.action.queries[]",
			"event_msg/item_completed:Extension.action.type",
			"event_msg/item_completed:Extension.failure",
			"event_msg/item_completed:Extension.results[].domain",
			"event_msg/item_completed:Extension.results[].ref_id",
			"event_msg/item_completed:Extension.results[].thumbnail_url",
			"event_msg/item_completed:Extension.revisedPrompt",
			"event_msg/item_completed:Extension.transparentBackground",
		],
		reason: "web search query and results, stored as text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:AgentMessage.content[*].**",
		reason: "assistant text, stored as record text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:AgentMessage.questions**",
		reason: "questions asked of the user, stored as text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:UserMessage.content[text].**",
		reason: "prompt text; mirrors the response item",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:UserMessage.content[mention].*",
		reason: "a plugin the user mentioned (`plugin://…`), in the prompt text",
		rule: "text_copy",
		except: [
			"event_msg/item_completed:UserMessage.content[mention].name",
			"event_msg/item_completed:UserMessage.content[mention].path",
		],
	},
	{
		path: "event_msg/item_completed:UserMessage.client_id",
		reason: "client message id",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/item_completed:Reasoning.**",
		reason: "reasoning, mirrors the response item",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:Plan.*",
		reason: "the agent's plan text (update_plan), kept as text",
		rule: "text_copy",
	},
	{
		path: "event_msg/item_completed:CollabAgentToolCall.agents_states",
		reason:
			"Count-only corpus check: 3,278 empty objects, not arrays; WATCH if a populated object or another type appears. Named state descendants are pending subagent_states.",
		rule: "constant_watch",
		observedConstant: {},
		except: ["event_msg/item_completed:CollabAgentToolCall.agents_states"],
	},
	{
		path: "event_msg/item_completed:CollabAgentToolCall.receiver_agents",
		reason: "receiver agents (see subagent_activity)",
		rule: "bookkeeping",
		except: ["event_msg/item_completed:CollabAgentToolCall.receiver_agents"],
	},
	{
		path: "event_msg/*",
		reason:
			"an event with no fields; the parser keeps its type as the meta row's subtype",
		rule: "bookkeeping",
		except: ["event_msg/context_compacted"],
	},
	{
		path: "event_msg/user_message.text_elements",
		reason: "text element ranges of the prompt",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_message.message",
		reason: "assistant text, mirrors the response item",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/agent_reasoning.text",
		reason: "reasoning text, mirrors the response item",
		rule: "text_copy",
	},
	{
		path: "event_msg/token_count.info",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/token_count.rate_limits",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/token_count.info.model_context_window",
		reason: "read by usage extraction (see context_window)",
		rule: "bookkeeping",
		except: ["event_msg/token_count.info.model_context_window"],
	},
	{
		path: "event_msg/thread_goal_updated.goal.createdAt",
		reason: "goal bookkeeping",
		rule: "bookkeeping",
		except: ["event_msg/thread_goal_updated.goal.createdAt"],
	},
	{
		path: "event_msg/thread_goal_updated.goal.updatedAt",
		reason: "goal bookkeeping",
		rule: "bookkeeping",
		except: ["event_msg/thread_goal_updated.goal.updatedAt"],
	},
	{
		path: "event_msg/thread_goal_updated.goal.threadId",
		reason: "the thread id",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/thread_goal_updated.threadId",
		reason: "the thread id",
		rule: "bookkeeping",
	},
	{
		path: "event_msg/web_search_end.**",
		reason: "search query, stored as the call's text",
		rule: "text_copy",
		except: [
			"event_msg/web_search_end.action.type",
			"event_msg/web_search_end.call_id",
		],
	},
	{
		path: "token_usage_record/.session_id",
		reason:
			"Restates stream identity; census checks consistency against the stream baseline and filename where available.",
		rule: "stream_identity",
		identity: "sessionId",
		except: ["token_usage_record/.session_id"],
	},
	{
		path: "token_usage_record/.thread_id",
		reason:
			"Restates stream identity; census checks consistency against the stream baseline and filename where available.",
		rule: "stream_identity",
		identity: "sessionId",
	},
	{
		path: "compacted/.replacement_history_metadata**",
		reason: "bookkeeping of the replacement history",
		rule: "bookkeeping",
	},
	{
		path: "compacted/.guardian_history**",
		reason: "the reviewer's history carried over a compaction",
		rule: "bookkeeping",
	},
	{
		path: "compacted/.retained_context**",
		reason: "messages carried over a compaction, kept in the summary text",
		rule: "text_copy",
	},
	{
		path: "compacted/.resume_metadata**",
		reason: "resume bookkeeping",
		rule: "bookkeeping",
	},
	{
		path: "compacted/.mcp_resource_origins**",
		reason: "MCP resource bookkeeping",
		rule: "bookkeeping",
	},
	{
		path: "compacted/.compaction_response_id",
		reason: "the response that compacted",
		rule: "bookkeeping",
	},
	{
		path: "compacted/.latest_token_usage_record",
		reason:
			"Empty/null container marker; non-empty payload has separately enumerated descendant paths. Not a corpus-wide constant.",
		rule: "bookkeeping",
	},
];

export const FACT_CENSUS_CATALOG: CensusCatalog = {
	sources: catalogSources,
	ignored: CENSUS_IGNORED_PATHS,
};
