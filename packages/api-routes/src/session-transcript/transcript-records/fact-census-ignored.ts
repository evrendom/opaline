import { catalogSources } from "./fact-catalog.js";
import type { CensusCatalog, IgnoredPath } from "./fact-census.js";

/**
 * Transcript paths that are deliberately not facts, each with its reason.
 * The census reports every path that is neither a catalog source nor
 * listed here, so a new field becomes a work item instead of a silent loss.
 * Keep reasons short and true; when a path turns out to carry a fact, move
 * it to the catalog instead.
 */
export const CENSUS_IGNORED_PATHS: readonly IgnoredPath[] = [
	// Both agents: identity and bookkeeping of the record itself.
	{
		path: "*.sessionId",
		reason: "the session id; the upload names the session",
	},
	{ path: "*.uuid", reason: "record id; records are identified by their line" },
	{
		path: "*.parentUuid",
		reason: "record chain; records are ordered by their line",
	},
	{ path: "*.logicalParentUuid", reason: "record chain across compaction" },
	{ path: "*.userType", reason: "always `external`" },
	{ path: "*.slug", reason: "the session's display slug" },
	{ path: "*.promptId", agent: "codex", reason: "not written by Codex" },
	{
		path: "*@ordinal",
		agent: "codex",
		reason: "record order; records are ordered by their line",
	},
	{
		path: "*.id",
		agent: "codex",
		reason: "item and message ids; calls join by call_id",
	},
	{
		path: "*.internal_chat_message_metadata_passthrough.**",
		agent: "codex",
		reason: "internal routing metadata (turn ids repeat turn_context)",
	},
	{
		path: "*@metadata.**",
		agent: "codex",
		reason:
			"client bookkeeping (input order, MCP attribution status, retained-context markers)",
	},

	// Claude Code: message envelopes and text kept as record text.
	{ path: "assistant.message.role", reason: "always `assistant`" },
	{ path: "assistant.message.type", reason: "always `message`" },
	{ path: "user.message.role", reason: "always `user`" },
	{ path: "assistant.message.container", reason: "always null" },
	{ path: "assistant.message.context_management", reason: "always null" },
	{
		path: "assistant.message.stop_sequence",
		reason:
			"the matched stop sequence text; stop_reason says a sequence stopped it",
	},
	{
		path: "assistant.message.diagnostics",
		reason: "null when there are no diagnostics",
	},
	{
		path: "assistant.message.stop_details",
		reason: "null when the model did not refuse",
	},
	{
		path: "assistant.message.input_transformations**",
		reason:
			"thinking blocks the harness dropped from the request; harness bookkeeping",
	},
	{
		path: "assistant.message.usage.fallback_credit",
		reason: "null without a fallback credit",
	},
	{
		path: "assistant.message.usage.iterations",
		reason: "null without iterations",
	},
	{
		path: "assistant.message.usage.output_tokens_details",
		reason: "null without details",
	},
	{
		path: "user.origin.body",
		reason: "the message a peer sent, kept as the prompt's text",
	},
	{ path: "user.origin.verifiedPeerPid", reason: "process id of a peer" },
	{ path: "user.origin.{*}", reason: "keys that are data" },
	{
		path: "assistant.apiBlockIndex",
		reason: "position of the block in the API response",
	},
	{
		path: "assistant.message.content[text].text",
		reason: "assistant text, stored as record text",
	},
	{
		path: "assistant.message.content[thinking].thinking",
		reason: "reasoning text, stored as record text",
	},
	{
		path: "assistant.message.content[thinking].signature",
		reason: "opaque signature of the reasoning block",
	},
	{
		path: "assistant.message.content[redacted_thinking].data",
		reason: "encrypted reasoning",
	},
	{
		path: "assistant.message.content[tool_use:*].caller.type",
		reason: "always `direct`",
	},
	{
		path: "assistant.message.content[tool_use:*].input.**",
		except: [
			"assistant.message.content[tool_use:Bash].input.**",
			"assistant.message.content[tool_use:Agent].input.**",
		],
		reason:
			"tool arguments: the whole input is the call's text (input_text); facts read from it are catalogued",
	},
	{
		path: "assistant.message.content[tool_use:Bash].input.description",
		reason: "the agent's description of the command",
	},
	{
		path: "assistant.message.content[tool_use:Agent].input.description",
		reason: "the agent's short label for the task",
	},
	{
		path: "assistant.message.content[tool_use:Agent].input.prompt",
		reason:
			"the delegated task; the sub-agent's first prompt (subtype delegation)",
	},
	{
		path: "user.message.content[text].text",
		reason: "prompt text, stored as record text",
	},
	{
		path: "user.message.content",
		reason: "prompt text, stored as record text",
	},
	{
		path: "user.message.content[image].source.data",
		reason: "image bytes; slimming replaces them with a marker",
	},
	{
		path: "user.message.content[tool_result].content[*].**",
		reason: "result text and images, stored as the result's text",
	},
	{
		path: "user.message.content[tool_result].content",
		reason: "result text, stored as the result's text",
	},
	{
		path: "user.mcpMeta.*",
		reason: "MCP structured content and metadata; the tool's own payload",
	},
	{
		path: "user.sourceToolAssistantUUID",
		reason: "record chain to the call's line; calls join by call id",
	},
	{
		path: "user.sourceToolUseID",
		reason: "the call id a meta line belongs to",
	},
	{
		path: "user.isMeta",
		reason: "marks harness-written user lines; the parser classifies them",
	},
	{ path: "user.isVisibleInTranscriptOnly", reason: "display flag" },
	{ path: "user.queueSkipAttachments", reason: "queue delivery flag" },
	{ path: "user.queueTranscriptOnly", reason: "queue delivery flag" },
	{ path: "user.turnCompanion", reason: "display grouping" },
	{
		path: "user.toolUseResult[].**",
		reason: "MCP result content blocks, stored as the result's text",
	},
	{
		path: "user.toolUseResult.file.**",
		reason: "the file a Read returned; its text is the result",
	},
	{
		path: "user.toolUseResult.filePath",
		reason: "repeats the call's file_path",
	},
	{
		path: "user.toolUseResult.oldString",
		reason: "the edit itself, stored as the file change",
	},
	{
		path: "user.toolUseResult.newString",
		reason: "the edit itself, stored as the file change",
	},
	{
		path: "user.toolUseResult.originalFile",
		reason: "the file before the edit",
	},
	{ path: "user.toolUseResult.replaceAll", reason: "repeats the call's input" },
	{
		path: "user.toolUseResult.content",
		reason: "the written file or result body",
	},
	{
		path: "user.toolUseResult.content[*].**",
		reason: "result content blocks, stored as the result's text",
	},
	{ path: "user.toolUseResult.structuredPatch", reason: "empty patch" },
	{
		path: "user.toolUseResult.structuredPatch[].oldStart",
		reason: "hunk position; line counts are patch_lines_*",
	},
	{
		path: "user.toolUseResult.structuredPatch[].oldLines",
		reason: "hunk position; line counts are patch_lines_*",
	},
	{
		path: "user.toolUseResult.structuredPatch[].newStart",
		reason: "hunk position; line counts are patch_lines_*",
	},
	{
		path: "user.toolUseResult.structuredPatch[].newLines",
		reason: "hunk position; line counts are patch_lines_*",
	},
	{
		path: "user.toolUseResult.bashEditDiff.files[].hunks**",
		reason: "the diff body of a shell edit; shell_edit_files keeps the files",
	},
	{
		path: "user.toolUseResult.type",
		reason: "the Read/Write result kind (text, image, create, update)",
	},
	{
		path: "user.toolUseResult.isImage",
		reason:
			"whether the result is an image; image results are labelled in text",
	},
	{
		path: "user.toolUseResult.description",
		reason: "repeats the call's description",
	},
	{ path: "user.toolUseResult.prompt", reason: "repeats the call's prompt" },
	{ path: "user.toolUseResult.command", reason: "repeats the call's command" },
	{ path: "user.toolUseResult.query", reason: "repeats the call's query" },
	{ path: "user.toolUseResult.url", reason: "repeats the call's URL" },
	{
		path: "user.toolUseResult.result",
		reason: "the fetched page's text, stored as the result's text",
	},
	{
		path: "user.toolUseResult.results**",
		reason: "web search results, stored as the result's text",
	},
	{
		path: "user.toolUseResult.code",
		reason: "HTTP status of a fetched page; the fetch result text says it",
	},
	{
		path: "user.toolUseResult.codeText",
		reason: "HTTP status text of a fetched page",
	},
	{ path: "user.toolUseResult.bytes", reason: "size of a fetched page" },
	{
		path: "user.toolUseResult.searchCount",
		reason: "searches a web search made",
	},
	{
		path: "user.toolUseResult.filenames**",
		reason: "files a search matched, stored as the result's text",
	},
	{
		path: "user.toolUseResult.matches**",
		reason: "tool search matches, stored as the result's text",
	},
	{
		path: "user.toolUseResult.mode",
		reason:
			"the Grep output mode; repeats the call's input (see search_matches)",
	},
	{
		path: "user.toolUseResult.numLines",
		reason: "Grep line count (see search_matches)",
	},
	{
		path: "user.toolUseResult.totalLines",
		reason: "Grep line total (see search_matches)",
	},
	{
		path: "user.toolUseResult.outputFile",
		reason: "where a background task writes its output",
	},
	{
		path: "user.toolUseResult.canReadOutputFile",
		reason: "whether that output file is readable",
	},
	{ path: "user.toolUseResult.persistent", reason: "Monitor tool flag" },
	{
		path: "user.toolUseResult.taskId",
		reason: "task list ids (TaskCreate, TaskUpdate)",
	},
	{
		path: "user.toolUseResult.task_id",
		reason: "background task id of a stop request",
	},
	{
		path: "user.toolUseResult.task_type",
		reason: "background task kind of a stop request",
	},
	{ path: "user.toolUseResult.task.*", reason: "the created task list item" },
	{
		path: "user.toolUseResult.updatedFields[]",
		reason: "task list fields a TaskUpdate changed",
	},
	{
		path: "user.toolUseResult.statusChange.*",
		reason: "task list status change",
	},
	{
		path: "user.toolUseResult.success",
		reason: "the tool's own success flag; is_error is the outcome",
	},
	{
		path: "user.toolUseResult.message",
		reason: "the tool's message, stored as the result's text",
	},
	{ path: "user.toolUseResult.commandName", reason: "repeats the skill name" },
	{ path: "user.toolUseResult.allowedTools[]", reason: "tools a skill allows" },
	{
		path: "user.toolUseResult.questions**",
		reason: "questions the agent asked the user, stored as text",
	},
	{
		path: "user.toolUseResult.answers.*",
		reason: "the user's answers, stored as the result's text",
	},
	{ path: "user.toolUseResult.pin.*", reason: "a pinned item's identity" },
	{ path: "user.toolUseResult.display", reason: "display text" },
	{
		path: "user.toolUseResult.listing",
		reason: "a listing, stored as the result's text",
	},
	{
		path: "user.toolUseResult.total_deferred_tools",
		reason: "tool search bookkeeping",
	},
	{
		path: "user.toolUseResult.memdirStamped",
		reason: "memory directory bookkeeping",
	},
	{ path: "user.toolUseResult.harness*", reason: "harness note bookkeeping" },
	{
		path: "user.toolUseResult.staleRecovered",
		reason: "harness bookkeeping after a stale read",
	},
	{
		path: "user.toolUseResult.canContinueAgent",
		reason: "whether a sub-agent can be resumed",
	},
	{
		path: "user.toolUseResult.stopped",
		reason: "a scheduled wakeup was stopped",
	},
	{
		path: "user.toolUseResult.scheduledFor",
		reason: "when a wakeup is scheduled",
	},
	{
		path: "user.toolUseResult.cancelledWakeups",
		reason: "wakeups a schedule cancelled",
	},
	{
		path: "user.toolUseResult.clampedDelaySeconds",
		reason: "the wakeup delay after clamping",
	},
	{
		path: "user.toolUseResult.wasClamped",
		reason: "whether the wakeup delay was clamped",
	},
	{
		path: "user.toolUseResult.{*}",
		reason: "keys that are data (answers keyed by question)",
	},

	// Claude Code: records and attachments the parser keeps as meta or text.
	{ path: "ai-title.sessionId", reason: "session id" },
	{
		path: "last-prompt.*",
		reason: "the harness's copy of the latest prompt, for resuming",
	},
	{ path: "atis-latch.*", reason: "harness state latch" },
	{
		path: "file-history-snapshot.**",
		reason: "file backup bookkeeping for undo",
	},
	{ path: "mode.sessionId", reason: "session id" },
	{ path: "queue-operation.timestamp", reason: "record time" },
	{
		path: "attachment/*.rendered**",
		reason: "the attachment as rendered into the context; its fields are read",
	},
	{
		path: "attachment/*.renderedRole",
		reason: "the role the attachment is rendered as",
	},
	{
		path: "attachment/*.renderedInHumanTurn**",
		reason: "the attachment as rendered into a human turn",
	},
	{ path: "attachment/*.renderedBesideToolResult", reason: "rendering flag" },
	{
		path: "attachment/total_tokens_reminder.**",
		reason: "context-size reminder text the harness injects",
	},
	{
		path: "attachment/silent_turn_reminder.**",
		reason: "reminder text the harness injects",
	},
	{
		path: "attachment/batching_reminder_sent.**",
		reason: "reminder text the harness injects",
	},
	{ path: "attachment/date.**", reason: "today's date for the model" },
	{ path: "attachment/date_change.**", reason: "date change notice" },
	{
		path: "attachment/credential_org.**",
		reason: "the account's organization id",
	},
	{
		path: "attachment/deferred_tools_record.**",
		reason: "tool definitions offered on demand",
	},
	{
		path: "attachment/deferred_tools_delta.**",
		reason: "tool definitions offered on demand",
	},
	{
		path: "attachment/agent_listing_delta.**",
		reason: "sub-agent types offered to the model",
	},
	{
		path: "attachment/task_reminder.**",
		reason: "the task list as reminded to the model",
	},
	{
		path: "attachment/thinking_drop.**",
		reason: "reasoning blocks the harness dropped; harness bookkeeping",
	},
	{
		path: "attachment/read_truncation_notice.**",
		reason: "notice that a read was cut",
	},
	{
		path: "attachment/session_context.**",
		reason: "git status and account shown to the model, kept as meta text",
	},
	{
		path: "attachment/remote_session_change.**",
		reason: "remote session state (managed commit or PR), kept as meta text",
	},
	{
		path: "attachment/environment.attachment.snapshot.platform",
		reason: "machine description",
	},
	{
		path: "attachment/environment.attachment.snapshot.osVersion",
		reason: "machine description",
	},
	{
		path: "attachment/environment.attachment.snapshot.shell",
		reason: "machine description",
	},
	{
		path: "attachment/environment.attachment.snapshot.isGitRepo",
		reason: "machine description",
	},
	{
		path: "attachment/environment.attachment.snapshot.isWorktree",
		reason: "machine description",
	},
	{
		path: "attachment/environment.attachment.snapshot.additionalWorkingDirectories**",
		reason: "machine description",
	},
	{
		path: "attachment/environment.attachment.changes[].{*}",
		reason: "changes to that description",
	},
	{
		path: "attachment/model.attachment.identity.knowledgeCutoff",
		reason: "model description",
	},
	{
		path: "attachment/model.attachment.identity.marketingName",
		reason: "model description",
	},
	{
		path: "attachment/model.attachment.text",
		reason: "model description text",
	},
	{
		path: "attachment/prompt_snapshot.attachment.tools**",
		reason: "tool definitions sent with the request",
	},
	{
		path: "attachment/prompt_snapshot.attachment.*",
		except: ["attachment/prompt_snapshot.attachment.systemPrompt**"],
		reason: "request snapshot bookkeeping",
	},
	{
		path: "attachment/instructions.attachment.changed",
		reason: "whether the instructions changed since the last load",
	},
	{
		path: "attachment/instructions.attachment.reason",
		reason: "why the instructions were loaded",
	},
	{
		path: "attachment/nested_memory.attachment.displayPath",
		reason: "display form of the path",
	},
	{
		path: "attachment/nested_memory.attachment.content.path",
		reason: "repeats the path",
	},
	{
		path: "attachment/nested_memory.attachment.content.type",
		reason: "memory file kind",
	},
	{
		path: "attachment/nested_memory.attachment.content.contentDiffersFromDisk",
		reason: "whether the loaded text differs from the file",
	},
	{
		path: "attachment/mcp_instructions_delta.attachment.*",
		reason: "MCP server instructions, kept as injected text",
	},
	{
		path: "attachment/mcp_instructions_delta.attachment.*[]",
		reason: "MCP server instructions, kept as injected text",
	},
	{
		path: "attachment/skill_listing.attachment.*",
		reason: "the skills offered to the model, kept as injected text",
	},
	{
		path: "attachment/skill_listing.attachment.*[]",
		reason: "the skills offered to the model, kept as injected text",
	},
	{
		path: "attachment/command_permissions.attachment.**",
		reason: "tools a slash command allows, kept as meta text",
	},
	{
		path: "attachment/queued_command.attachment.*",
		except: [
			"attachment/queued_command.attachment.origin**",
			"attachment/queued_command.attachment.prompt",
			"attachment/queued_command.attachment.commandMode",
		],
		reason: "queue delivery bookkeeping",
	},
	{
		path: "attachment/queued_command.attachment.prompt[]**",
		reason: "queued prompt text and images, stored as the prompt's text",
	},
	{
		path: "attachment/queued_command.attachment.usage.*",
		reason: "usage a background task reported in its notification text",
	},
	{
		path: "attachment/queued_command.attachment.origin.**",
		except: ["attachment/queued_command.attachment.origin.kind"],
		reason: "origin details (see prompt_origin's gap)",
	},
	{
		path: "attachment/plan_mode.attachment.*",
		except: ["attachment/plan_mode.attachment.planFilePath"],
		reason: "plan mode reminder bookkeeping",
	},
	{ path: "system/*.content", reason: "system notice text, kept as meta text" },
	{ path: "system/*.level", reason: "notice level" },
	{ path: "system/*.isMeta", reason: "marks harness-written lines" },
	{ path: "system/*.toolUseID", reason: "the call a hook summary belongs to" },
	{ path: "system/*.hasOutput", reason: "whether a hook printed output" },
	{
		path: "system/*.hookAdditionalContext**",
		reason: "hook output added to the context, kept as meta text",
	},
	{ path: "system/*.requestId", reason: "API request id" },
	{ path: "system/*.refusedUserMessageUuid", reason: "record chain" },
	{
		path: "system/*.apiRefusalExplanation",
		reason: "refusal explanation text, kept as meta text",
	},
	{ path: "system/*.direction", reason: "fallback direction" },
	{ path: "system/*.scope", reason: "fallback scope" },
	{ path: "system/*.trigger", reason: "always `refusal`" },
	{ path: "system/*.source", reason: "retry kind (connection or request)" },
	{
		path: "system/api_error.error.isNetworkDown",
		reason: "network flag; the error text says it",
	},
	{
		path: "system/api_error.error.connection.isSSLError",
		reason: "connection flag; the error text says it",
	},
	{
		path: "system/api_error.error.connection.message",
		reason: "connection error text, kept as meta text",
	},
	{
		path: "system/api_error.error.connection",
		reason: "null without a connection error",
	},
	{ path: "system/api_error.error.noResponse", reason: "always null" },
	{ path: "system/api_error.error.rateLimits", reason: "always null" },

	// Codex: envelopes, text and bookkeeping.
	{
		path: "session_meta/.id",
		reason: "the thread id; the upload names the session",
	},
	{ path: "session_meta/.session_id", reason: "the session id" },
	{ path: "session_meta/.timestamp", reason: "session start time" },
	{ path: "session_meta/.model_provider", reason: "model provider (openai)" },
	{ path: "session_meta/.history_mode", reason: "rollout format" },
	{ path: "session_meta/.multi_agent_version", reason: "rollout format" },
	{
		path: "session_meta/.subagent_history_start_ordinal",
		reason: "rollout format",
	},
	{
		path: "session_meta/.context_window.window_id",
		reason: "context window id (see compacted)",
	},
	{
		path: "session_meta/.dynamic_tools**",
		reason: "tool definitions offered to the model",
	},
	{
		path: "session_meta/.runtime_workspace_roots[]",
		reason: "workspace roots (see cwd)",
	},
	{
		path: "session_meta/.base_instructions.provenance.*",
		reason: "where the base instructions came from",
	},
	{ path: "session_meta/.git", reason: "empty git metadata" },
	{
		path: "session_meta/.source.subagent.thread_spawn.agent_nickname",
		reason: "see attribution_agent",
	},
	{ path: "turn_context/.summary", reason: "reasoning summary setting" },
	{ path: "turn_context/.personality", reason: "personality setting" },
	{ path: "turn_context/.current_date", reason: "today's date for the model" },
	{ path: "turn_context/.timezone", reason: "the user's time zone" },
	{ path: "turn_context/.comp_hash", reason: "internal hash" },
	{ path: "turn_context/.realtime_active", reason: "voice mode flag" },
	{ path: "turn_context/.cyber_access_program", reason: "access program flag" },
	{ path: "turn_context/.multi_agent_mode", reason: "multi-agent setting" },
	{ path: "turn_context/.multi_agent_version", reason: "rollout format" },
	{ path: "turn_context/.disabled_plugin_ids", reason: "disabled plugins" },
	{
		path: "turn_context/.workspace_roots[]",
		reason: "workspace roots (see cwd)",
	},
	{
		path: "turn_context/.truncation_policy.*",
		reason: "output truncation setting",
	},
	{
		path: "turn_context/.sandbox_policy.writable_roots[]",
		reason: "sandbox detail (see sandbox_policy)",
	},
	{
		path: "turn_context/.sandbox_policy.exclude_*",
		reason: "sandbox detail (see sandbox_policy)",
	},
	{
		path: "turn_context/.sandbox_policy",
		reason: "older string form; see sandbox_policy",
	},
	{
		path: "turn_context/.permission_profile.file_system**",
		reason: "permission profile detail (see permission_profile)",
	},
	{
		path: "turn_context/.permission_profile.network",
		reason: "permission profile detail (see permission_profile)",
	},
	{
		path: "turn_context/.file_system_sandbox_policy**",
		reason: "sandbox detail (see sandbox_policy)",
	},
	{
		path: "turn_context/.collaboration_mode.settings.developer_instructions",
		reason: "the mode's instructions; developer messages carry them",
	},
	{
		path: "event_msg/thread_settings_applied.thread_id",
		reason: "the thread id",
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
		],
		reason: "thread settings detail (personality, summary, plugins, roots)",
	},
	{
		path: "event_msg/thread_settings_applied.thread_settings.*[]",
		reason: "thread settings detail (workspace roots, plugins)",
	},
	{
		path: "event_msg/thread_settings_applied.thread_settings.*.**",
		except: [
			"event_msg/thread_settings_applied.thread_settings.permission_profile.type",
		],
		reason: "thread settings detail",
	},
	{
		path: "world_state/.**",
		except: [
			"world_state/.state.agents_md.*",
			"world_state/.state.permissions.approved_command_prefixes[][]",
			"world_state/.state.environments.environments.local.cwd",
		],
		reason:
			"the harness's state snapshot (flags, hints, environment), injected as developer text",
	},
	{
		path: "response_item/message:*.role",
		reason: "repeats the role in the path",
	},
	{
		path: "response_item/message:assistant.content[output_text].text",
		reason: "assistant text, stored as record text",
	},
	{
		path: "response_item/message:user.content[input_text].text",
		reason: "prompt text, stored as record text",
	},
	{
		path: "response_item/message:developer.content[input_text].text",
		reason: "developer instructions, stored as injected text",
	},
	{
		path: "response_item/message:*.agent.agent_name",
		reason: "in-file sub-agent attribution; becomes the record's agent id",
	},
	{
		path: "response_item/reasoning.**",
		reason: "reasoning summary text, stored as record text; encrypted content",
	},
	{
		path: "response_item/agent_message.content[encrypted_content].encrypted_content",
		reason: "encrypted message",
	},
	{
		path: "response_item/web_search_call.**",
		except: ["response_item/web_search_call.action.type"],
		reason: "search query and page, stored as the call's text",
	},
	{
		path: "response_item/tool_search_call.**",
		reason: "tool search query, stored as the call's text",
	},
	{
		path: "response_item/tool_search_output.**",
		reason: "tools found, stored as the output's text",
	},
	{
		path: "response_item/function_call:*.status",
		reason: "always `completed`",
	},
	{
		path: "response_item/custom_tool_call_output.name",
		reason: "repeats the call's tool name",
	},
	{
		path: "response_item/custom_tool_call:*.status",
		reason: "always `completed`",
	},
	{
		path: "response_item/function_call:*.arguments.**",
		except: [
			"response_item/function_call:exec_command.arguments.**",
			"response_item/function_call:spawn_agent.arguments.**",
			"response_item/function_call:write_stdin.arguments.**",
		],
		reason:
			"tool arguments: the whole input is the call's text (input_text); facts read from it are catalogued",
	},
	{
		path: "response_item/function_call:exec_command.arguments.max_output_tokens",
		reason: "output limit the agent asked for",
	},
	{
		path: "response_item/function_call:exec_command.arguments.yield_time_ms",
		reason: "how long to wait before returning a running command",
	},
	{
		path: "response_item/function_call:exec_command.arguments.tty",
		reason: "terminal flag",
	},
	{
		path: "response_item/function_call:exec_command.arguments.login",
		reason: "login-shell flag",
	},
	{
		path: "response_item/function_call:exec_command.arguments.shell",
		reason: "the shell the agent asked for",
	},
	{
		path: "response_item/function_call:exec_command.arguments.env.{*}",
		reason: "environment variables passed to the command",
	},
	{
		path: "response_item/function_call:exec_command.arguments.{*}",
		reason: "malformed argument keys",
	},
	{
		path: "response_item/function_call:exec_command.arguments.session_id",
		reason: "a write to a running session (older form)",
	},
	{
		path: "response_item/function_call:exec_command.arguments.chars",
		reason: "input written to a running session (older form)",
	},
	{
		path: "response_item/function_call:write_stdin.arguments.chars",
		reason: "input written to a running command",
	},
	{
		path: "response_item/function_call:write_stdin.arguments.max_output_tokens",
		reason: "output limit",
	},
	{
		path: "response_item/function_call:write_stdin.arguments.yield_time_ms",
		reason: "how long to wait",
	},
	{
		path: "response_item/function_call:spawn_agent.arguments.message",
		reason: "the delegated task; the sub-agent's first prompt",
	},
	{
		path: "response_item/function_call_output.output[*].**",
		reason: "output text and images, stored as the result's text",
	},
	{
		path: "response_item/custom_tool_call_output.output[*].**",
		reason: "output text and images, stored as the result's text",
	},
	{
		path: "response_item/custom_tool_call_output.output.output",
		reason: "output text inside the transport envelope",
	},
	{
		path: "response_item/function_call_output.output.output",
		reason: "output text inside the transport envelope",
	},
	{
		path: "response_item/*_output.output~Chunk ID",
		reason: "output framing: the chunk id of a long output",
	},
	{
		path: "response_item/*_output.output~Original token count",
		reason: "output framing: the output's size before truncation",
	},
	{
		path: "response_item/*_output.output[input_text].text~*",
		reason:
			"framing inside output blocks; the same conventions as plain output",
	},
	{
		path: "response_item/*_output.output~unable to locate image at",
		reason:
			"an image a tool could not load, inside a script's error output; a view_image call's own output is is_error",
	},
	{
		path: "event_msg/item_completed:*.status",
		reason: "item status; used for the call's outcome (is_error)",
	},
	{
		path: "event_msg/item_completed:CommandExecution.aggregated_output",
		reason: "command output, stored as the result's text",
	},
	{
		path: "event_msg/item_completed:CommandExecution.formatted_output",
		reason: "command output, stored as the result's text",
	},
	{
		path: "event_msg/item_completed:CommandExecution.process_id",
		reason: "process id",
	},
	{
		path: "event_msg/item_completed:CommandExecution.source",
		reason: "always `unified_exec_startup`",
	},
	{
		path: "event_msg/item_completed:CommandExecution.plugin_id",
		reason: "rare plugin attribution of a script",
	},
	{
		path: "event_msg/item_completed:CommandExecution.script_path",
		reason: "rare script path",
	},
	{
		path: "event_msg/exec_command_end.aggregated_output",
		reason: "command output, stored as the result's text",
	},
	{
		path: "event_msg/exec_command_end.formatted_output",
		reason: "command output, stored as the result's text",
	},
	{
		path: "event_msg/exec_command_end.command[]",
		reason: "repeats the call's command",
	},
	{ path: "event_msg/exec_command_end.process_id", reason: "process id" },
	{ path: "event_msg/exec_command_end.source", reason: "command source" },
	{
		path: "event_msg/exec_command_end.status",
		reason: "repeats the exit code's outcome",
	},
	{
		path: "event_msg/exec_command_end.turn_id",
		reason: "turn id (see turn_id)",
	},
	{
		path: "event_msg/patch_apply_end.changes.{*}.content",
		reason: "file content of an added file",
	},
	{
		path: "event_msg/patch_apply_end.stdout",
		reason: "patch output, stored as text",
	},
	{
		path: "event_msg/patch_apply_end.stderr",
		reason: "patch output, stored as text",
	},
	{ path: "event_msg/patch_apply_end.status", reason: "repeats success" },
	{
		path: "event_msg/patch_apply_end.turn_id",
		reason: "turn id (see turn_id)",
	},
	{
		path: "event_msg/item_completed:FileChange.changes.{*}.content",
		reason: "file content of an added file, stored as the file change's text",
	},
	{
		path: "event_msg/item_completed:FileChange.stdout",
		reason: "patch output, stored as the result's text",
	},
	{
		path: "event_msg/item_completed:FileChange.stderr",
		reason: "patch output, stored as the result's text",
	},
	{
		path: "event_msg/item_completed:McpToolCall.arguments",
		reason: "tool arguments, stored as the call's text",
	},
	{
		path: "event_msg/item_completed:McpToolCall.result.**",
		except: ["event_msg/item_completed:McpToolCall.result.isError"],
		reason: "tool result, stored as the result's text",
	},
	{
		path: "event_msg/item_completed:McpToolCall.error.message",
		reason: "tool error, stored as the result's text",
	},
	{
		path: "event_msg/item_completed:McpToolCall.linkId",
		reason: "connector link id",
	},
	{
		path: "event_msg/item_completed:McpToolCall.mcpAppResourceUri",
		reason: "app resource URI",
	},
	{
		path: "event_msg/item_completed:DynamicToolCall.arguments",
		reason: "tool arguments, stored as the call's text",
	},
	{
		path: "event_msg/item_completed:DynamicToolCall.content_items**",
		reason: "tool result, stored as the result's text",
	},
	{
		path: "event_msg/item_completed:DynamicToolCall.success",
		reason: "used for the call's outcome (is_error)",
	},
	{
		path: "event_msg/item_completed:WebSearch.**",
		reason: "search query and results, stored as the call's and result's text",
	},
	{
		path: "event_msg/item_completed:Extension.**",
		except: [
			"event_msg/item_completed:Extension.durationMs",
			"event_msg/item_completed:Extension.savedPath",
			"event_msg/item_completed:Extension.kind",
		],
		reason: "web search query and results, stored as text",
	},
	{
		path: "event_msg/item_completed:AgentMessage.content[*].**",
		reason: "assistant text, stored as record text",
	},
	{
		path: "event_msg/item_completed:AgentMessage.delivery",
		reason: "delivery mode of a message",
	},
	{
		path: "event_msg/item_completed:AgentMessage.questions**",
		reason: "questions asked of the user, stored as text",
	},
	{
		path: "event_msg/item_completed:UserMessage.content[text].**",
		reason: "prompt text; mirrors the response item",
	},
	{
		path: "event_msg/item_completed:UserMessage.content[mention].*",
		reason: "a plugin the user mentioned (`plugin://…`), in the prompt text",
	},
	{
		path: "event_msg/item_completed:UserMessage.client_id",
		reason: "client message id",
	},
	{
		path: "event_msg/item_completed:Reasoning.**",
		reason: "reasoning, mirrors the response item",
	},
	{
		path: "event_msg/item_completed:Plan.*",
		reason: "the agent's plan text (update_plan), kept as text",
	},
	{
		path: "event_msg/item_completed:CollabAgentToolCall.agents_states",
		reason: "always empty",
	},
	{
		path: "event_msg/item_completed:CollabAgentToolCall.receiver_agents",
		reason: "receiver agents (see subagent_activity)",
	},
	{
		path: "event_msg/*",
		reason:
			"an event with no fields; the parser keeps its type as the meta row's subtype",
	},
	{
		path: "event_msg/user_message.text_elements",
		reason: "text element ranges of the prompt",
	},
	{
		path: "event_msg/agent_message.message",
		reason: "assistant text, mirrors the response item",
	},
	{
		path: "event_msg/agent_reasoning.text",
		reason: "reasoning text, mirrors the response item",
	},
	{ path: "event_msg/token_count.info", reason: "null before the first usage" },
	{
		path: "event_msg/token_count.rate_limits",
		reason: "null without a rate-limit snapshot",
	},
	{
		path: "event_msg/token_count.info.model_context_window",
		reason: "read by usage extraction (see context_window)",
	},
	{
		path: "event_msg/thread_goal_updated.goal.createdAt",
		reason: "goal bookkeeping",
	},
	{
		path: "event_msg/thread_goal_updated.goal.updatedAt",
		reason: "goal bookkeeping",
	},
	{
		path: "event_msg/thread_goal_updated.goal.threadId",
		reason: "the thread id",
	},
	{ path: "event_msg/thread_goal_updated.threadId", reason: "the thread id" },
	{
		path: "event_msg/web_search_end.**",
		reason: "search query, stored as the call's text",
	},
	{ path: "token_usage_record/.session_id", reason: "the session id" },
	{ path: "token_usage_record/.thread_id", reason: "the thread id" },
	{
		path: "compacted/.replacement_history_metadata**",
		reason: "bookkeeping of the replacement history",
	},
	{
		path: "compacted/.guardian_history**",
		reason: "the reviewer's history carried over a compaction",
	},
	{
		path: "compacted/.retained_context**",
		reason: "messages carried over a compaction, kept in the summary text",
	},
	{ path: "compacted/.resume_metadata**", reason: "resume bookkeeping" },
	{
		path: "compacted/.mcp_resource_origins**",
		reason: "MCP resource bookkeeping",
	},
	{
		path: "compacted/.compaction_response_id",
		reason: "the response that compacted",
	},
	{
		path: "compacted/.latest_token_usage_record",
		reason: "null without a usage record",
	},
];

/** The catalog sources and ignored paths the census compares with. */
export const FACT_CENSUS_CATALOG: CensusCatalog = {
	sources: catalogSources,
	ignored: CENSUS_IGNORED_PATHS,
};
