import type {
	TRANSCRIPT_RECORD_FACT_KEYS,
	TranscriptRecordDraft,
	TranscriptRecordFacts,
	TranscriptSource,
} from "./types.js";

/**
 * The L1 fact catalog: every literal fact of docs/l1-literal-schema.md, and
 * every fact the agents record that it does not list yet, with what Claude
 * Code and Codex each record, where, and what Opaline stores. It is the single
 * source of truth for the generated matrix (docs/l1-fact-matrix.md, written
 * by `bun run --cwd packages/api-routes facts:matrix`) and for the drift
 * census (`facts:census`), which reports the transcript paths no entry maps.
 *
 * Statuses, per agent:
 * - `stored`: Opaline stores it (`stores` says where, and from which parser
 *   version); `gap` lists recorded sources not read yet.
 * - `pending`: the agent records it, Opaline does not store it yet; `plan`
 *   names the change that will.
 * - `not_recorded`: the agent does not record it; `searched` says how that
 *   was established.
 * - `wrong`: stored, but known to be incorrect; `plan` names the fix.
 *
 * Sources are census paths (see fact-census.ts): `<record type>[/<payload
 * type>][:<item type>].<json path>`, `*` matching inside one step, and an
 * `~<convention>` suffix for a fact carried by an output or text convention.
 */

export type FactAgent = TranscriptSource;
export const FACT_AGENTS: readonly FactAgent[] = ["claude_code", "codex"];
export type FactView = "calls" | "runs" | "prompts" | "session";
export const FACT_VIEWS: readonly FactView[] = [
	"calls",
	"runs",
	"prompts",
	"session",
];
export type FactStatus = "stored" | "pending" | "not_recorded" | "wrong";

type TypedFact = Exclude<keyof TranscriptRecordFacts, "extra">;
/** A typed fact column or a `facts` key (`TRANSCRIPT_RECORD_FACT_KEYS`). */
export type CatalogFactField =
	| TypedFact
	| keyof typeof TRANSCRIPT_RECORD_FACT_KEYS;
/** A column of the transcript record itself (not one of its facts). */
export type CatalogRecordColumn = Exclude<
	keyof TranscriptRecordDraft,
	"facts" | "head" | "tail" | "byteStart" | "byteLen" | "blockIdx"
>;

export interface FactStores {
	/** First transcript-records parser version that stores it for this agent. */
	readonly since?: number;
	/** Typed fact columns and `facts` keys it lands in. */
	readonly facts?: readonly CatalogFactField[];
	/** Record columns it lands in. */
	readonly record?: readonly CatalogRecordColumn[];
	/** Where it is stored outside transcript records, in plain words. */
	readonly elsewhere?: string;
}

interface AgentFactBase {
	/** Census paths the agent records it at; empty when it records nothing. */
	readonly sources: readonly string[];
	/** Provenance caveats: requested vs executed, configured vs actual, not comparable. */
	readonly notes?: string;
}

export interface StoredAgentFact extends AgentFactBase {
	readonly status: "stored";
	readonly stores: FactStores;
	/** Recorded sources not read yet, and the change that will read them. */
	readonly gap?: { readonly sources: readonly string[]; readonly plan: string };
	/** Repo path of the test that covers a fact stored outside transcript records. */
	readonly testedIn?: string;
}

export interface WrongAgentFact extends AgentFactBase {
	readonly status: "wrong";
	readonly stores: FactStores;
	/** What is wrong and the change that fixes it. */
	readonly plan: string;
	readonly testedIn?: string;
}

export interface PendingAgentFact extends AgentFactBase {
	readonly status: "pending";
	/** The change (parser version, extractor, PR) that will store it. */
	readonly plan: string;
}

export interface NotRecordedAgentFact extends AgentFactBase {
	readonly status: "not_recorded";
	/** How absence was established: fields and strings searched, corpus, date. */
	readonly searched: string;
}

export type AgentFact =
	| StoredAgentFact
	| WrongAgentFact
	| PendingAgentFact
	| NotRecordedAgentFact;

export interface FactEntry {
	/** The spec column name (or the new fact's name). */
	readonly id: string;
	/** Other spec column names this entry stands for (one row in the spec). */
	readonly also?: readonly string[];
	readonly view: FactView;
	/** Views whose spec table also lists it. */
	readonly alsoIn?: readonly FactView[];
	/** One plain sentence. */
	readonly meaning: string;
	readonly agents: Readonly<Record<FactAgent, AgentFact>>;
	/** `run_index` fact columns read from it (apps/api run-index-columns.ts). */
	readonly runIndex?: readonly string[];
	/** A question only the product owner can answer. */
	readonly decision?: string;
}

/** The census that established the `not_recorded` entries below. */
export const LOCAL_CENSUS =
	"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records)";

function searched(what: string): string {
	return `${LOCAL_CENSUS}: ${what}.`;
}

function stored(
	sources: readonly string[],
	stores: FactStores,
	options: Omit<StoredAgentFact, "status" | "sources" | "stores"> = {},
): StoredAgentFact {
	return { status: "stored", sources, stores, ...options };
}

function wrong(
	sources: readonly string[],
	stores: FactStores,
	plan: string,
	options: Omit<WrongAgentFact, "status" | "sources" | "stores" | "plan"> = {},
): WrongAgentFact {
	return { status: "wrong", sources, stores, plan, ...options };
}

function pending(
	sources: readonly string[],
	plan: string,
	options: { readonly notes?: string } = {},
): PendingAgentFact {
	return { status: "pending", sources, plan, ...options };
}

function notRecorded(
	what: string,
	options: {
		readonly notes?: string;
		readonly sources?: readonly string[];
	} = {},
): NotRecordedAgentFact {
	return {
		status: "not_recorded",
		sources: options.sources ?? [],
		searched: searched(what),
		...(options.notes === undefined ? {} : { notes: options.notes }),
	};
}

const PARSER_9 = "parser 9";
const RUN_INDEX = "run_index, counted from the stored records";
const RUN_INDEX_TEST = "apps/api/src/__tests__/run-index.integration.ts";
const USAGE =
	"usage_events (packages/usage-events), priced per run in run_index";
const USAGE_TEST = "packages/usage-events/src/extract.test.ts";
const GIT = "session_git_observations (git extractor, from call outputs)";
const GIT_TEST = "apps/api/src/services/git-observation-parser.test.ts";
const SPLIT_TEST =
	"packages/api-routes/src/session-transcript/transcript-records/split-transcript.test.ts";

const CLAUDE_NO_LOCAL_COMPACTION =
	"No compaction record occurs in the local transcripts (2.1.220–2.1.293), so the census cannot confirm this source; the parser fixtures cover it.";

const CLAUDE_TOOL_NAME = "assistant.message.content[tool_use:*].name";
const CODEX_CALL_NAMES = [
	"response_item/function_call:*.name",
	"response_item/custom_tool_call:*.name",
];
const CODEX_OUTPUTS = [
	"response_item/function_call_output.output",
	"response_item/custom_tool_call_output.output",
];

export const FACT_CATALOG: readonly FactEntry[] = [
	// --- calls -----------------------------------------------------------------
	{
		id: "tool_name",
		view: "calls",
		meaning: "The tool the agent called.",
		agents: {
			claude_code: stored([CLAUDE_TOOL_NAME], {
				since: 1,
				record: ["toolName"],
			}),
			codex: stored(
				[
					...CODEX_CALL_NAMES,
					"response_item/web_search_call.action.type",
					"event_msg/item_completed:McpToolCall.tool",
					"event_msg/item_completed:DynamicToolCall.tool",
				],
				{ since: 1, record: ["toolName"] },
				{
					notes:
						"A connector tool's name (`_create_pull_request`) does not say which app it belongs to; see tool_namespace.",
				},
			),
		},
	},
	{
		id: "call_id",
		view: "calls",
		meaning: "The id that joins a call to its result.",
		agents: {
			claude_code: stored(
				[
					"assistant.message.content[tool_use:*].id",
					"user.message.content[tool_result].tool_use_id",
				],
				{ since: 1, record: ["callId"] },
			),
			codex: stored(
				[
					"response_item/function_call:*.call_id",
					"response_item/custom_tool_call:*.call_id",
					"response_item/function_call_output.call_id",
					"response_item/custom_tool_call_output.call_id",
					"event_msg/item_completed:*.id",
					"event_msg/exec_command_end.call_id",
					"event_msg/patch_apply_end.call_id",
				],
				{ since: 1, record: ["callId"] },
			),
		},
	},
	{
		id: "input_text",
		view: "calls",
		meaning:
			"What the agent asked the tool to do: the shell command, or the tool input as JSON.",
		agents: {
			claude_code: stored(
				[
					"assistant.message.content[tool_use:Bash].input.command",
					"assistant.message.content[tool_use:*].input",
				],
				{ since: 1, record: ["text"] },
			),
			codex: stored(
				[
					"response_item/function_call:exec_command.arguments.cmd",
					"response_item/function_call:shell.arguments.command[]",
					"response_item/function_call:*.arguments",
					"response_item/custom_tool_call:*.input",
					"event_msg/item_completed:CommandExecution.command[]",
				],
				{ since: 1, record: ["text"] },
			),
		},
	},
	{
		id: "command_argv0",
		also: ["command_prefix"],
		view: "calls",
		meaning: "The program a shell command ran and its first words.",
		agents: {
			claude_code: pending(
				["assistant.message.content[tool_use:Bash].input.command"],
				"find over calls (order of work step 10) derives it from the stored command text; no parser change",
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.cmd",
					"event_msg/item_completed:CommandExecution.parsed_cmd[].cmd",
				],
				"find over calls (order of work step 10) derives it from the stored command text; no parser change",
			),
		},
	},
	{
		id: "command_fingerprint",
		also: ["command_simhash"],
		view: "calls",
		meaning:
			"A normalized form of a command or written script, to find the same command across sessions.",
		agents: {
			claude_code: pending(
				["assistant.message.content[tool_use:Bash].input.command"],
				"find over calls (order of work step 10) derives it from the stored command text; no parser change",
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.cmd",
					"response_item/custom_tool_call:exec.input",
				],
				"find over calls (order of work step 10) derives it from the stored command text; no parser change",
			),
		},
	},
	{
		id: "is_error",
		view: "calls",
		meaning: "Whether the call failed.",
		agents: {
			claude_code: stored(
				["user.message.content[tool_result].is_error"],
				{ since: 1, record: ["isError"] },
				{
					notes:
						"Stored as not failed when the result has no `is_error`, which is an inference: 5,519 results locally (19%, mostly Read, Edit, Write and WebFetch) have none, and only 4 of them read like an error.",
				},
			),
			codex: wrong(
				[
					"event_msg/item_completed:CommandExecution.exit_code",
					"event_msg/item_completed:*.status",
					"event_msg/exec_command_end.exit_code",
					"event_msg/patch_apply_end.success",
					"event_msg/item_completed:McpToolCall.result.isError",
					"response_item/function_call_output.output~Process exited with code",
					"response_item/function_call_output.output~failed",
					"response_item/custom_tool_call_output.output~failed",
					"response_item/function_call_output.output~failed to parse function arguments",
					"response_item/function_call_output.output~unable to locate image at",
				],
				{ since: 1, record: ["isError"] },
				`${PARSER_9}: a call Codex refused or could not run (\`exec_command failed …\`, \`write_stdin failed …\`, \`failed to parse function arguments\`, a view_image call's \`unable to locate image at …\`) is stored as not failed today; record that transport failure as a failure (locally: 108 refusals, 634 other \`… failed\` outputs, 50 \`failed to parse function arguments\`, 38 \`unable to locate image at\`).`,
				{
					notes:
						"Not comparable across agents: Codex marks every nonzero exit a failure (grep or diff finding nothing included); Claude Code marks a nonzero exit not failed only when it gives a return_code_interpretation (170 results locally: 168 `No matches found`, 2 `Files differ`), and every other one failed (`Exit code N`).",
				},
			),
		},
	},
	{
		id: "exit_code",
		view: "calls",
		meaning: "The process exit code of a shell call.",
		agents: {
			claude_code: stored(
				["user.message.content[tool_result].content~Exit code"],
				{ since: 1, record: ["exitCode"] },
				{
					testedIn: SPLIT_TEST,
					notes:
						"Claude Code writes an exit code only into the text of a failed result (`Exit code 1`); successful calls have none.",
				},
			),
			codex: wrong(
				[
					"event_msg/item_completed:CommandExecution.exit_code",
					"event_msg/exec_command_end.exit_code",
					"response_item/function_call_output.output~Process exited with code",
					"response_item/function_call_output.output[input_text].text~Process exited with code",
					"response_item/custom_tool_call_output.output~Exit code",
					"response_item/custom_tool_call_output.output[input_text].text~Exit code",
					"response_item/custom_tool_call_output.output.metadata.exit_code",
					"response_item/function_call_output.output.metadata.exit_code",
				],
				{ since: 1, record: ["exitCode"] },
				`${PARSER_9}: when a command's completion arrives after its output said it was still running, the call stays \`running\` with no exit code and the completion row keeps neither; keep the completion's exit code and status on its row (locally 19,520 late completions, 4,324 of them nonzero).`,
			),
		},
	},
	{
		id: "denial_kind",
		view: "calls",
		meaning:
			"Why a call was refused, as the agent names it (permission rule, user rejection, sandbox).",
		runIndex: ["denied_calls"],
		agents: {
			claude_code: stored(
				["user.toolDenialKind"],
				{ since: 6, facts: ["denialKind"] },
				{
					notes:
						"`permission-rule` also covers calls a hook denied; permission_decision's `source` tells them apart.",
				},
			),
			codex: stored(
				[
					"response_item/function_call_output.output~Sandbox(Denied)",
					"response_item/function_call_output.output~Rejected",
					"response_item/custom_tool_call_output.output[input_text].text~Rejected",
				],
				{ since: 8, facts: ["denialKind"] },
				{
					notes:
						"Codex writes no denial field; the refusal is the call's output (`exec_command failed …: CreateProcess { message: \"Rejected(…` or `Codex(Sandbox(Denied …`).",
				},
			),
		},
	},
	{
		id: "denial_reason",
		view: "calls",
		meaning: "The recorded reason a call was refused or blocked.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult",
					"user.message.content[tool_result].content~hook error",
				],
				`${PARSER_9}: keep the string \`toolUseResult\` of a refused or blocked result (worktree isolation, \`Blocked: sleep\`), and the phase, tool and message of a \`PreToolUse:<tool> hook error\` result.`,
			),
			codex: wrong(
				[
					"response_item/function_call_output.output~Rejected",
					"response_item/custom_tool_call_output.output[input_text].text~Rejected",
				],
				{ since: 8, facts: ["denial_reason"] },
				`${PARSER_9}: a reason over 512 characters is cut without \`facts_clipped\`, and the cut can drop the policy explanation that follows the command (7 refusals locally); cap it with the clipping-aware setter so the cut is marked.`,
			),
		},
	},
	{
		id: "return_code_interpretation",
		view: "calls",
		meaning:
			"The agent's own reading of a nonzero exit code (for example `No matches found`).",
		agents: {
			claude_code: stored(["user.toolUseResult.returnCodeInterpretation"], {
				since: 6,
				facts: ["return_code_interpretation"],
			}),
			codex: notRecorded(
				"no field or output convention interprets an exit code (searched CommandExecution, exec_command_end and every call output prefix)",
			),
		},
	},
	{
		id: "duration_ms",
		view: "calls",
		meaning: "How long the tool call took.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.durationMs", "user.toolUseResult.durationSeconds"],
				{ since: 6, facts: ["durationMs"] },
				{
					notes:
						"Only some tools record it (web fetch and search, a few others); shell results record none.",
				},
			),
			codex: stored(
				[
					"event_msg/item_completed:CommandExecution.duration.*",
					"event_msg/item_completed:McpToolCall.duration.*",
					"event_msg/exec_command_end.duration.*",
				],
				{ since: 6, facts: ["durationMs"] },
				{
					gap: {
						sources: ["event_msg/item_completed:DynamicToolCall.duration.*"],
						plan: `${PARSER_9}: the dynamic tool handler keeps its recorded duration.`,
					},
					notes:
						"Versions without CommandExecution items (0.100, 0.105, 0.108–0.118 and 0.130–0.145 locally) record no command duration; see wall_time_ms.",
				},
			),
		},
	},
	{
		id: "wall_time_ms",
		view: "calls",
		meaning:
			"How long a call's output says the agent waited for it: a poll's wait, not the command's whole run.",
		agents: {
			claude_code: notRecorded(
				"no wait time is written into Claude Code results",
			),
			codex: pending(
				[
					"response_item/function_call_output.output~Wall time",
					"response_item/function_call_output.output[input_text].text~Wall time",
					"response_item/custom_tool_call_output.output~Wall time",
					"response_item/custom_tool_call_output.output[input_text].text~Wall time",
					"response_item/custom_tool_call_output.output.metadata.duration_seconds",
					"response_item/function_call_output.output.metadata.duration_seconds",
				],
				`${PARSER_9}: keep the output framing's \`Wall time\` and the envelope's \`duration_seconds\` as transport time, apart from duration_ms.`,
				{
					notes: "A poll of a background command reports only its own wait.",
				},
			),
		},
	},
	{
		id: "call_started_at",
		also: ["call_completed_at"],
		view: "calls",
		meaning: "When a tool call started and finished, as the agent recorded it.",
		agents: {
			claude_code: notRecorded(
				"tool results carry no start or end time of their own; only the record timestamps",
			),
			codex: pending(
				[
					"event_msg/item_completed.started_at_ms",
					"event_msg/item_completed.completed_at_ms",
				],
				`${PARSER_9}: keep the completion's recorded start and end on its row.`,
			),
		},
	},
	{
		id: "timed_out_after_ms",
		view: "calls",
		meaning: "The limit after which a call was stopped for running too long.",
		runIndex: ["timed_out_calls"],
		agents: {
			claude_code: stored(["user.toolUseResult.timedOutAfterMs"], {
				since: 6,
				facts: ["timedOutAfterMs"],
			}),
			codex: notRecorded(
				"no timed-out marker in any call's framing or completion; the 186 outputs that say `timed out` say it inside the command's own output, or are MCP startup failures (`… MCP startup failed: timed out handshaking …`, 4); a wait tool's `timed_out` result is not a command timeout",
			),
		},
	},
	{
		id: "timeout_ms",
		view: "calls",
		meaning: "The time limit set for a call.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.timeoutMs"],
				{ since: 6, facts: ["timeout_ms"] },
				{
					gap: {
						sources: ["assistant.message.content[tool_use:Bash].input.timeout"],
						plan: `${PARSER_9}: copy a shell call's requested \`timeout\` (about 4,000 calls locally; results repeat it for only 43 calls).`,
					},
				},
			),
			codex: stored(
				["response_item/function_call:exec_command.arguments.timeout_ms"],
				{ since: 8, facts: ["timeout_ms"] },
				{ notes: "The requested limit, from the call's arguments." },
			),
		},
	},
	{
		id: "is_async",
		view: "calls",
		meaning:
			"Whether the call was still running in the background when its result was recorded.",
		agents: {
			claude_code: stored(["user.toolUseResult.isAsync"], {
				since: 6,
				facts: ["is_async"],
			}),
			codex: stored(
				[
					"response_item/function_call_output.output~Process running with session ID",
					"response_item/custom_tool_call_output.output~Script running with cell ID",
					"response_item/function_call_output.output~Script running with cell ID",
					"response_item/custom_tool_call_output.output[input_text].text~Script running with cell ID",
				],
				{ since: 5, record: ["subtype"] },
				{ notes: "As the result subtype `running`." },
			),
		},
	},
	{
		id: "background_task_id",
		view: "calls",
		meaning:
			"The id of the background task or process a call started or polls.",
		agents: {
			claude_code: stored(["user.toolUseResult.backgroundTaskId"], {
				since: 6,
				facts: ["background_task_id"],
			}),
			codex: pending(
				[
					"response_item/function_call_output.output~Process running with session ID",
					"response_item/custom_tool_call_output.output~Script running with cell ID",
					"response_item/function_call:write_stdin.arguments.session_id",
					"response_item/function_call:wait.arguments.cell_id",
				],
				`${PARSER_9}: keep the session or cell id of a running output and of the calls that poll it.`,
			),
		},
	},
	{
		id: "run_in_background",
		view: "calls",
		meaning: "The agent asked for the call to run in the background.",
		agents: {
			claude_code: pending(
				[
					"assistant.message.content[tool_use:Bash].input.run_in_background",
					"assistant.message.content[tool_use:Agent].input.run_in_background",
				],
				`${PARSER_9}: keep the requested background flag, apart from is_async (what happened).`,
			),
			codex: notRecorded(
				"exec_command arguments have no background flag (cmd, workdir, timeout_ms, yield_time_ms, max_output_tokens, tty, login, shell, sandbox_permissions, justification, prefix_rule); any command may keep running past its `yield_time_ms`",
			),
		},
	},
	{
		id: "interrupted",
		view: "calls",
		meaning: "The user stopped the call while it ran.",
		runIndex: ["interrupted_calls"],
		agents: {
			claude_code: stored(["user.toolUseResult.interrupted"], {
				since: 6,
				facts: ["interrupted"],
			}),
			codex: stored(
				[
					"response_item/function_call_output.output~aborted by user",
					"response_item/custom_tool_call_output.output~aborted by user",
				],
				{ since: 8, facts: ["interrupted", "durationMs"] },
				{
					notes:
						"Codex writes the call's output as `aborted by user after <s>s`.",
				},
			),
		},
	},
	{
		id: "no_output_expected",
		view: "calls",
		meaning: "The tool said the command was not expected to print anything.",
		agents: {
			claude_code: stored(["user.toolUseResult.noOutputExpected"], {
				since: 6,
				facts: ["no_output_expected"],
			}),
			codex: notRecorded("no such flag on calls, outputs or completions"),
		},
	},
	{
		id: "stdout_chars",
		also: ["stderr_chars"],
		view: "calls",
		meaning:
			"Characters the command wrote to standard output and to standard error.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.stdout", "user.toolUseResult.stderr"],
				{ since: 6, facts: ["stdout_chars", "stderr_chars"] },
			),
			codex: pending(
				[
					"event_msg/item_completed:CommandExecution.stdout",
					"event_msg/item_completed:CommandExecution.stderr",
					"event_msg/exec_command_end.stdout",
					"event_msg/exec_command_end.stderr",
				],
				`${PARSER_9}: count each stream where it is recorded separately (about 70,000 completions locally); never split merged output.`,
				{ notes: "Other Codex outputs merge both streams into one text." },
			),
		},
	},
	{
		id: "persisted_output_bytes",
		view: "calls",
		meaning:
			"Size of a large output the agent saved to a file instead of showing it.",
		agents: {
			claude_code: stored(["user.toolUseResult.persistedOutputSize"], {
				since: 6,
				facts: ["persisted_output_bytes"],
			}),
			codex: notRecorded(
				"Codex truncates long output in place and writes `Original token count: N`, a token count, not a saved file",
			),
		},
	},
	{
		id: "persisted_output_path",
		view: "calls",
		meaning: "Where the agent saved a large output.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.persistedOutputPath"],
				`${PARSER_9}: keep the recorded path beside its size.`,
			),
			codex: notRecorded("no saved-output path on any call output"),
		},
	},
	{
		id: "content_not_in_model_context",
		view: "calls",
		meaning:
			"The tool said its result content was not put into the model's context.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.contentNotInModelContext"],
				`${PARSER_9}: keep the flag as recorded.`,
				{
					notes:
						"It does not mean the agent never read the file or saw nothing.",
				},
			),
			codex: notRecorded("no such flag on outputs or completions"),
		},
	},
	{
		id: "result_chars",
		view: "calls",
		meaning: "Length of the call's result text.",
		agents: {
			claude_code: stored(["user.message.content[tool_result].content"], {
				since: 1,
				record: ["textChars"],
			}),
			codex: stored(CODEX_OUTPUTS, { since: 1, record: ["textChars"] }),
		},
	},
	{
		id: "shell_edit_files",
		view: "calls",
		meaning: "Files a shell command changed, as the agent recorded them.",
		agents: {
			claude_code: stored(
				[
					"user.toolUseResult.bashEditDiff.files",
					"user.toolUseResult.bashEditDiff.files[].filePath",
					"user.toolUseResult.bashEditDiff.files[].created",
					"user.toolUseResult.bashEditDiff.files[].deleted",
					"user.toolUseResult.bashEditDiff.moreFiles",
					"user.toolUseResult.bashEditDiff.changedFiles[]",
					"user.toolUseResult.bashEditDiff.unavailable",
					"user.toolUseResult.bashEditDiff.shared",
				],
				{
					since: 6,
					facts: [
						"shell_edit_files",
						"shell_edit_files_more",
						"shell_edit_changed_files",
						"shell_edit_changed_files_more",
						"shell_edit_unavailable",
						"shell_edit_shared",
					],
				},
			),
			codex: notRecorded(
				"no record of the files a shell command changed; the parser infers them from the command (see file_op)",
			),
		},
	},
	{
		id: "git_operation",
		view: "calls",
		meaning:
			"The git operation a call performed (push, commit, branch, pull request), as the agent recorded it.",
		runIndex: ["git_operations", "pushed_branches", "commit_shas"],
		agents: {
			claude_code: stored(
				[
					"user.toolUseResult.gitOperation.push.branch",
					"user.toolUseResult.gitOperation.commit.sha",
					"user.toolUseResult.gitOperation.commit.kind",
					"user.toolUseResult.gitOperation.branch.ref",
					"user.toolUseResult.gitOperation.branch.action",
					"user.toolUseResult.gitOperation.pr.number",
					"user.toolUseResult.gitOperation.pr.action",
					"user.toolUseResult.gitOperation.pr.url",
				],
				{
					since: 6,
					facts: [
						"gitOperation",
						"git.push.branch",
						"git.commit.sha",
						"git.commit.kind",
						"git.branch.ref",
						"git.branch.action",
						"git.pr.number",
						"git.pr.action",
						"git.pr.url",
					],
				},
			),
			codex: notRecorded(
				"no git operation field; the git extractor reads push and commit output instead",
			),
		},
	},
	{
		id: "mcp_server",
		view: "calls",
		meaning: "The MCP server a call went to.",
		runIndex: ["mcp_calls", "mcp_servers"],
		agents: {
			claude_code: stored(["assistant.attributionMcpServer"], {
				since: 6,
				facts: ["mcpServer"],
			}),
			codex: stored(
				["event_msg/item_completed:McpToolCall.server"],
				{ since: 6, facts: ["mcpServer"] },
				{
					gap: {
						sources: [
							"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].server_name",
							"response_item/function_call_output@metadata.mcp_attribution.sources[].server_name",
						],
						plan: `${PARSER_9}: keep the MCP server an output's \`mcp_attribution\` names; an \`exec\` script that calls MCP tools has no McpToolCall item (151 such outputs locally).`,
					},
				},
			),
		},
	},
	{
		id: "mcp_tool",
		view: "calls",
		meaning: "The MCP tool a call used.",
		agents: {
			claude_code: stored(["assistant.attributionMcpTool"], {
				since: 6,
				facts: ["mcpTool"],
			}),
			codex: stored(
				["event_msg/item_completed:McpToolCall.tool"],
				{ since: 6, facts: ["mcpTool"] },
				{
					gap: {
						sources: [
							"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].tool_name",
							"response_item/function_call_output@metadata.mcp_attribution.sources[].tool_name",
						],
						plan: `${PARSER_9}: keep the MCP tool an output's \`mcp_attribution\` names (see mcp_server).`,
					},
				},
			),
		},
	},
	{
		id: "mcp_read_only",
		view: "calls",
		meaning: "The MCP tool declared that it only reads.",
		agents: {
			claude_code: notRecorded(
				"`mcpMeta` holds only `structuredContent` and `_meta`; no read-only hint",
				{ sources: [] },
			),
			codex: stored(["event_msg/item_completed:McpToolCall.readOnlyHint"], {
				since: 6,
				facts: ["mcp_read_only"],
			}),
		},
	},
	{
		id: "attribution_plugin",
		view: "calls",
		meaning: "The plugin the call came from.",
		agents: {
			claude_code: pending(
				["assistant.attributionPlugin"],
				`${PARSER_9}: keep \`attributionPlugin\` like \`attributionSkill\`.`,
			),
			codex: stored(
				["event_msg/item_completed:McpToolCall.pluginId"],
				{ since: 6, facts: ["attribution_plugin"] },
				{
					gap: {
						sources: [
							"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].plugin_id",
							"response_item/function_call_output@metadata.mcp_attribution.sources[].plugin_id",
						],
						plan: `${PARSER_9}: keep the plugin an output's \`mcp_attribution\` names (see mcp_server).`,
					},
				},
			),
		},
	},
	{
		id: "attribution_skill",
		view: "calls",
		meaning:
			"The skill whose instructions the agent was following on this line.",
		runIndex: ["skills"],
		agents: {
			claude_code: stored(["assistant.attributionSkill"], {
				since: 6,
				facts: ["attributionSkill"],
			}),
			codex: notRecorded(
				"no skill attribution on any record; Codex uses a skill by reading its SKILL.md (see skill)",
			),
		},
	},
	{
		id: "attribution_agent",
		view: "calls",
		meaning:
			"The kind of agent (main or a named sub-agent type) that wrote the line.",
		agents: {
			claude_code: pending(
				["assistant.attributionAgent"],
				`${PARSER_9}: keep \`attributionAgent\` (about 19,000 lines locally).`,
			),
			codex: pending(
				[
					"session_meta/.agent_role",
					"session_meta/.agent_nickname",
					"session_meta/.source.subagent.thread_spawn.agent_role",
					"session_meta/.source.subagent.thread_spawn.agent_nickname",
				],
				`${PARSER_9}: keep the sub-agent's role and nickname from its session_meta on its stream.`,
				{ notes: "Codex records it once per sub-agent thread, not per line." },
			),
		},
	},
	{
		id: "file_path",
		view: "calls",
		meaning: "The file a call read or changed.",
		agents: {
			claude_code: stored(
				[
					"assistant.message.content[tool_use:Read].input.file_path",
					"assistant.message.content[tool_use:Write].input.file_path",
					"assistant.message.content[tool_use:Edit].input.file_path",
					"assistant.message.content[tool_use:NotebookEdit].input.notebook_path",
				],
				{ since: 1, record: ["filePath"] },
			),
			codex: stored(
				[
					"response_item/custom_tool_call:apply_patch.input",
					"event_msg/item_completed:FileChange.changes.{*}.type",
					"event_msg/item_completed:FileChange.changes.{*}.move_path",
					"event_msg/patch_apply_end.changes.{*}.type",
					"event_msg/patch_apply_end.changes.{*}.move_path",
				],
				{ since: 1, record: ["filePath"] },
				{
					gap: {
						sources: [
							"event_msg/item_completed:ImageView.path",
							"response_item/function_call:view_image.arguments.path",
						],
						plan: `${PARSER_9}: keep the path of an image the agent viewed (about 1,800 ImageView completions locally have no handler).`,
					},
				},
			),
		},
	},
	{
		id: "file_op",
		view: "calls",
		meaning: "What a call did to a file: read, write, edit or delete.",
		decision:
			"Should a file change the agent asked for but no result confirms (a refused or failed edit, a shell `rm` that may have found nothing) count as an edit, or only changes a result confirms?",
		agents: {
			claude_code: wrong(
				[
					"assistant.message.content[tool_use:Write].input.file_path",
					"assistant.message.content[tool_use:Edit].input.file_path",
					"assistant.message.content[tool_use:Bash].input.command",
				],
				{ since: 1, record: ["fileOp"] },
				`${PARSER_9}: a refused \`rm\` or Edit still becomes a \`delete\` or \`edit\` row; store what the command asked for as requested operations and count a change only when a result confirms it (\`structuredPatch\`, \`bashEditDiff\`).`,
			),
			codex: wrong(
				[
					"response_item/custom_tool_call:apply_patch.input",
					"response_item/function_call:exec_command.arguments.cmd",
				],
				{ since: 1, record: ["fileOp"] },
				`${PARSER_9}: 70 of 108 refused calls locally still emit counted \`write\`, \`edit\` or \`delete\` rows; store shell and patch syntax as requested operations and count a change only from applied-change evidence (FileChange or patch_apply_end success).`,
				{
					notes:
						"Codex reads (`parsed_cmd` parts of type `read`) are not file_op `read` yet; see reads.",
				},
			),
		},
	},
	{
		id: "patch_lines_added",
		also: ["patch_lines_removed"],
		view: "calls",
		meaning: "Lines an edit added and removed.",
		agents: {
			claude_code: stored(["user.toolUseResult.structuredPatch[].lines[]"], {
				since: 6,
				facts: ["patch_lines_added", "patch_lines_removed"],
			}),
			codex: pending(
				[
					"event_msg/item_completed:FileChange.changes.{*}.unified_diff",
					"event_msg/patch_apply_end.changes.{*}.unified_diff",
				],
				`${PARSER_9}: count the lines of an applied change's unified diff (about 49,000 changes locally); a proposed patch is not an applied one.`,
			),
		},
	},
	{
		id: "user_modified",
		view: "calls",
		meaning: "The user changed the agent's proposed edit before accepting it.",
		agents: {
			claude_code: stored(["user.toolUseResult.userModified"], {
				since: 6,
				facts: ["user_modified"],
			}),
			codex: notRecorded("no such field on FileChange or patch events"),
		},
	},
	{
		id: "stale_read",
		view: "calls",
		meaning:
			"The tool warned that files changed since the agent last read them.",
		agents: {
			claude_code: stored(["user.toolUseResult.staleReadFileStateHint"], {
				since: 6,
				facts: ["stale_read"],
			}),
			codex: notRecorded("no stale-read notice on any output or completion"),
		},
	},
	{
		id: "search_matches",
		view: "calls",
		meaning: "How many matches a search found.",
		agents: {
			claude_code: wrong(
				["user.toolUseResult.numFiles"],
				{ since: 6, facts: ["search_matches"] },
				`${PARSER_9}: \`numFiles\` is stored as the match count, but in content mode it is 0 while \`numLines\` counts the matches; keep the search \`mode\` and each counter under its own name.`,
			),
			codex: notRecorded(
				"no match count; `parsed_cmd` search parts record the query and path only",
			),
		},
	},
	{
		id: "search_query",
		view: "calls",
		meaning: "What a search looked for, and where.",
		agents: {
			claude_code: stored(
				[
					"assistant.message.content[tool_use:Grep].input.pattern",
					"assistant.message.content[tool_use:Grep].input.path",
					"assistant.message.content[tool_use:Glob].input.pattern",
				],
				{ since: 1, record: ["text"] },
				{ notes: "Inside the call's input text." },
			),
			codex: pending(
				[
					"event_msg/item_completed:CommandExecution.parsed_cmd[].query",
					"event_msg/item_completed:CommandExecution.parsed_cmd[].path",
					"event_msg/exec_command_end.parsed_cmd[].query",
				],
				`${PARSER_9}: keep the query and path of \`parsed_cmd\` search parts as recorded (about 29,000 locally); relative paths stay relative.`,
			),
		},
	},
	{
		id: "spawned_agent_id",
		view: "calls",
		meaning: "The sub-agent a call started.",
		agents: {
			claude_code: stored(["user.toolUseResult.agentId"], {
				since: 1,
				record: ["spawnedAgentId"],
			}),
			codex: wrong(
				[
					"event_msg/item_completed:SubAgentActivity.agent_thread_id",
					"event_msg/item_completed:CollabAgentToolCall.receiver_thread_ids",
					"event_msg/item_completed:CollabAgentToolCall.receiver_thread_ids[]",
					"response_item/function_call_output.output",
				],
				{ since: 7, facts: ["spawned_thread_ids", "spawned_thread_ids_more"] },
				`${PARSER_9}: every sub-agent activity and every wait is stored as a spawn (7,536 activities, of which 519 starts, and 3,272 waits locally); keep the activity kind and related thread ids (subagent_activity) and name a spawn only from spawn evidence.`,
			),
		},
	},
	{
		id: "subagent_activity",
		view: "calls",
		meaning:
			"What happened with a sub-agent: started, messaged, interrupted or completed.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.status", "user.toolUseResult.resumedAgentId"],
				`${PARSER_9}: keep the Agent result's status (\`async_launched\`, \`completed\`) and a resumed agent's id.`,
			),
			codex: pending(
				[
					"event_msg/item_completed:SubAgentActivity.kind",
					"event_msg/item_completed:SubAgentActivity.agent_path",
					"event_msg/item_completed:CollabAgentToolCall.tool",
					"event_msg/item_completed:CollabAgentToolCall.sender_thread_id",
				],
				`${PARSER_9}: keep the activity kind and agent path, and a collaboration call's tool and threads.`,
			),
		},
	},
	{
		id: "subagent_type",
		view: "calls",
		meaning:
			"The type of sub-agent the agent asked for, and the model and effort it asked for.",
		runIndex: ["subagent_types"],
		agents: {
			claude_code: stored(
				["assistant.message.content[tool_use:Agent].input.subagent_type"],
				{ since: 1, record: ["text"] },
				{
					gap: {
						sources: [
							"assistant.message.content[tool_use:Agent].input.model",
							"assistant.message.content[tool_use:Agent].input.isolation",
							"user.toolUseResult.resolvedModel",
							"user.toolUseResult.agentType",
						],
						plan: `${PARSER_9}: keep the requested model and isolation and the model the sub-agent resolved to.`,
					},
					notes: "run_index reads the type from the Agent call's input text.",
				},
			),
			codex: pending(
				[
					"response_item/function_call:spawn_agent.arguments.agent_type",
					"response_item/function_call:spawn_agent.arguments.model",
					"response_item/function_call:spawn_agent.arguments.reasoning_effort",
					"response_item/function_call:spawn_agent.arguments.task_name",
					"response_item/function_call:spawn_agent.arguments.fork_turns",
					"response_item/function_call:spawn_agent.arguments.fork_context",
				],
				`${PARSER_9}: keep the spawn request's agent type, model, effort, task name and forked turns.`,
			),
		},
	},
	{
		id: "subagent_totals",
		view: "calls",
		meaning: "Totals a finished sub-agent reported: time, tokens, tool calls.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.totalDurationMs",
					"user.toolUseResult.totalTokens",
					"user.toolUseResult.totalToolUseCount",
					"user.toolUseResult.toolStats.*",
					"user.toolUseResult.usage.**",
				],
				`${PARSER_9}: keep the child's reported totals apart from the parent call's duration; never add them to usage already counted from the child's stream.`,
			),
			codex: notRecorded(
				"a completed SubAgentActivity carries no totals; the child's own rollout has its usage",
			),
		},
	},
	{
		id: "skill",
		view: "calls",
		meaning: "A skill the agent used.",
		agents: {
			claude_code: stored(
				["assistant.message.content[tool_use:Skill].input.skill"],
				{ since: 8, facts: ["skill"] },
			),
			codex: stored(
				["event_msg/item_completed:CommandExecution.parsed_cmd[].path"],
				{ since: 8, facts: ["parsed_cmd_read_paths"] },
				{
					gap: {
						sources: [
							"event_msg/item_completed:UserMessage.content[skill].name",
							"event_msg/item_completed:UserMessage.content[skill].path",
							"response_item/message:user.content[input_text].text~<skill>",
						],
						plan: `${PARSER_9}: keep a skill the user invoked, from the prompt's \`skill\` items (name and SKILL.md path; 6 locally) and the \`<skill>\` wrapper of the injected skill text (15 locally), apart from the agent's own reads.`,
					},
					notes:
						"Codex has no skill tool: the agent uses a skill by reading its SKILL.md, which `parsed_cmd` records as a read; a user invokes one in the prompt. Versions without CommandExecution items (0.100, 0.105, 0.108–0.118 and 0.130–0.145 locally) record no such read.",
				},
			),
		},
	},
	{
		id: "parsed_cmd_types",
		view: "calls",
		meaning:
			"How the agent itself classified the parts of a shell command (read, search, list files).",
		agents: {
			claude_code: notRecorded(
				"Claude Code records no classification of shell commands",
			),
			codex: stored(
				[
					"event_msg/item_completed:CommandExecution.parsed_cmd[].type",
					"event_msg/item_completed:CommandExecution.parsed_cmd[].cmd",
					"event_msg/item_completed:CommandExecution.parsed_cmd[].name",
				],
				{ since: 8, facts: ["parsed_cmd_types"] },
				{
					gap: {
						sources: [
							"event_msg/exec_command_end.parsed_cmd[].type",
							"event_msg/exec_command_end.parsed_cmd[].cmd",
							"event_msg/exec_command_end.parsed_cmd[].name",
						],
						plan: `${PARSER_9}: read the same parts from \`exec_command_end\` events of older versions.`,
					},
				},
			),
		},
	},
	{
		id: "parsed_cmd_read_paths",
		view: "calls",
		meaning:
			"The files a shell command read, as the agent itself recorded them.",
		agents: {
			claude_code: notRecorded(
				"Claude Code records no parse of shell commands; its Read tool's path is file_path",
			),
			codex: stored(
				["event_msg/item_completed:CommandExecution.parsed_cmd[].path"],
				{
					since: 8,
					facts: ["parsed_cmd_read_paths", "parsed_cmd_read_paths_more"],
				},
				{
					gap: {
						sources: ["event_msg/exec_command_end.parsed_cmd[].path"],
						plan: `${PARSER_9}: read \`exec_command_end\` events of older versions too.`,
					},
				},
			),
		},
	},
	{
		id: "cwd",
		view: "calls",
		meaning: "The directory a call ran in.",
		agents: {
			claude_code: pending(
				[
					"*.cwd",
					"user.toolUseResult.backgroundCwdHint",
					"attachment/environment.attachment.snapshot.workingDirectory",
					"assistant.wireIngestContext.{*}.cwd",
				],
				`${PARSER_9}: keep each record's \`cwd\` (it changes within 55 local sessions).`,
				{ notes: "Stored per session only today." },
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.workdir",
					"event_msg/item_completed:CommandExecution.cwd",
					"event_msg/exec_command_end.cwd",
					"turn_context/.cwd",
					"session_meta/.cwd",
					"event_msg/thread_settings_applied.thread_settings.cwd",
					"world_state/.state.environments.environments.local.cwd",
				],
				`${PARSER_9}: keep the requested \`workdir\` and the completion's \`cwd\` apart (requested vs where it ran).`,
				{ notes: "Stored per session only today." },
			),
		},
	},
	{
		id: "git_branch",
		view: "calls",
		meaning: "The git branch checked out when the call ran.",
		agents: {
			claude_code: pending(
				["*.gitBranch"],
				`${PARSER_9}: keep each record's \`gitBranch\` (it changes within 53 local sessions).`,
				{ notes: "Stored per session only today." },
			),
			codex: notRecorded(
				"no branch per turn or call; session_meta records it once per session",
				{ sources: ["session_meta/.git.branch"] },
			),
		},
	},
	{
		id: "wire_input",
		view: "calls",
		meaning:
			"The tool input as the harness actually sent it, when it differs from what the model asked for (for example with a `cd` prepended).",
		agents: {
			claude_code: pending(
				["assistant.wireToolInputs.{*}"],
				`${PARSER_9}: keep the wire input by call id beside the requested input (6,051 of 27,313 calls differ locally).`,
			),
			codex: notRecorded("Codex records only one input per call"),
		},
	},
	{
		id: "sandbox_escalation",
		view: "calls",
		meaning: "The agent asked to run the call outside the sandbox, and why.",
		agents: {
			claude_code: pending(
				[
					"assistant.message.content[tool_use:Bash].input.dangerouslyDisableSandbox",
				],
				`${PARSER_9}: keep the requested sandbox bypass.`,
				{
					notes:
						"`dangerouslyDisableSandbox` appears on 2 local shell calls, both `false`; no call asked to bypass the sandbox.",
				},
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.sandbox_permissions",
					"response_item/function_call:exec_command.arguments.justification",
				],
				`${PARSER_9}: keep the requested escalation and its justification (about 550 calls locally).`,
			),
		},
	},
	{
		id: "permission_decision",
		view: "calls",
		meaning:
			"The recorded permission decision for a call (accept or reject) and who made it (configuration, a hook, the user).",
		decision:
			"Does a permission accepted by configuration (Claude `source: config`, `reasonType: mode`; Codex approved command prefixes) count as an approval, or only a decision a person made at the time (`user_temporary`, a Codex approval prompt)?",
		agents: {
			claude_code: pending(
				[
					"user.permissionDecision.decision",
					"user.permissionDecision.source",
					"user.permissionDecision.reasonType",
				],
				`${PARSER_9}: keep the decision, its source and reason on the call's result (about 4,700 records locally).`,
				{
					notes:
						"A recorded decision; it does not say a dialog was shown. Locally almost all are automatic: about 4,700 `accept` by `config` (`reasonType: mode`, sessions in `bypassPermissions` mode), 17 `reject` by a hook, and 5 `accept` by the user (`user_temporary`); a person's refusal is denial_kind `user-rejected` (3) or `cancelled` (5).",
				},
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.prefix_rule[]",
					"world_state/.state.permissions.approved_command_prefixes[][]",
				],
				`${PARSER_9}: keep the requested prefix rule of a call and the approved prefixes in force.`,
			),
		},
	},
	{
		id: "auto_review_decision",
		view: "calls",
		meaning:
			"The verdict of the agent's automatic approval reviewer on a requested action.",
		agents: {
			claude_code: notRecorded(
				"no reviewer verdict on any record; permission decisions are permission_decision",
			),
			codex: pending(
				[
					"response_item/message:assistant.content[output_text].text~auto-review decision",
					"session_meta/.thread_source",
					"session_meta/.source.subagent.other",
				],
				`${PARSER_9}: in a reviewer thread, keep the final verdict's \`outcome\`, \`risk_level\` and \`user_authorization\` as recorded (about 3,900 locally: 3,907 \`allow\`, 41 \`deny\`).`,
				{
					notes:
						"A reviewer thread is its own rollout: `source.subagent.other: guardian` marks all 372 locally, `thread_source: guardian_review` only the 303 newer ones. The reviewed session is named only in the reviewer's prompt text (`Reviewed Codex session id`, 307 of 372 locally); the parent thread's outputs carry no verdict.",
				},
			),
		},
	},
	{
		id: "tool_namespace",
		view: "calls",
		meaning:
			"The app or namespace a tool belongs to (for example the GitHub connector).",
		agents: {
			claude_code: notRecorded(
				"no namespace field; the MCP server is part of the tool name (`mcp__<server>__<tool>`) and of mcp_server",
			),
			codex: pending(
				[
					"response_item/function_call:*.namespace",
					"event_msg/item_completed:DynamicToolCall.namespace",
					"event_msg/item_completed:McpToolCall.connectorId",
					"event_msg/item_completed:McpToolCall.appName",
					"event_msg/item_completed:McpToolCall.actionName",
				],
				`${PARSER_9}: keep the namespace beside the tool name (about 26,000 calls locally); the git extractor then matches connector pull-request tools by namespace and name.`,
			),
		},
	},
	{
		id: "extension_item",
		view: "calls",
		meaning:
			"A built-in action that is not a tool call: a requested sleep and its length, a generated image and where it was saved.",
		agents: {
			claude_code: notRecorded(
				"no such items; waiting and image generation are ordinary tool calls",
			),
			codex: pending(
				[
					"event_msg/item_completed:Extension.kind",
					"event_msg/item_completed:Extension.durationMs",
					"event_msg/item_completed:Extension.savedPath",
				],
				`${PARSER_9}: keep the kind, a sleep's requested duration and a generated image's saved path (374 sleeps, 4 images locally); web searches are already calls.`,
				{
					notes: "A sleep's duration is what was asked for, not measured time.",
				},
			),
		},
	},
	{
		id: "image_input",
		view: "prompts",
		meaning:
			"An image attached to a prompt (its presence and type, never its bytes).",
		agents: {
			claude_code: stored(
				[
					"user.message.content[image].source.media_type",
					"user.message.content[image].source.type",
				],
				{ since: 5, record: ["text"] },
				{
					gap: {
						sources: ["user.imagePasteIds[]"],
						plan: `${PARSER_9}: a prompt with text and images keeps the image labels it drops today.`,
					},
					testedIn: SPLIT_TEST,
					notes:
						"An image-only prompt is stored as `[image attachment]` or its screenshot marker.",
				},
			),
			codex: pending(
				[
					"response_item/message:user.content[input_image].image_url",
					"response_item/message:user.content[input_image].detail",
					"event_msg/item_completed:UserMessage.content[image].image_url",
					"event_msg/item_completed:UserMessage.content[local_image].path",
					"event_msg/user_message.images",
					"event_msg/user_message.images[]",
					"event_msg/user_message.local_images",
				],
				`${PARSER_9}: keep image presence and source on the prompt; image-only messages are stored as empty today.`,
				{
					notes:
						"Tools also put images into user-role messages; not every one is a person's.",
				},
			),
		},
	},

	// --- runs ------------------------------------------------------------------
	{
		id: "started_at",
		also: ["ended_at", "minutes", "active_minutes"],
		view: "runs",
		meaning: "When a run started and ended, and how long it took.",
		agents: {
			claude_code: stored(
				["*.timestamp"],
				{ elsewhere: RUN_INDEX },
				{ testedIn: RUN_INDEX_TEST },
			),
			codex: stored(
				["*@timestamp"],
				{ elsewhere: RUN_INDEX },
				{
					testedIn: RUN_INDEX_TEST,
					gap: {
						sources: [
							"event_msg/task_started.started_at",
							"event_msg/task_complete.started_at",
							"event_msg/task_complete.completed_at",
							"event_msg/turn_aborted.started_at",
							"event_msg/turn_aborted.completed_at",
						],
						plan: `${PARSER_9}: keep the task's recorded start and end.`,
					},
				},
			),
		},
	},
	{
		id: "duration_ms",
		view: "runs",
		meaning: "How long the agent says the run took.",
		runIndex: ["duration_ms"],
		agents: {
			claude_code: notRecorded(
				"no turn duration record (no `turn_duration` system record in 2.1.220–2.1.293)",
			),
			codex: stored(
				[
					"event_msg/task_complete.duration_ms",
					"event_msg/turn_aborted.duration_ms",
				],
				{ since: 7, facts: ["durationMs"] },
			),
		},
	},
	{
		id: "time_to_first_token_ms",
		view: "runs",
		meaning: "How long the model took to start answering.",
		runIndex: ["time_to_first_token_ms"],
		agents: {
			claude_code: notRecorded("no first-token time on any record"),
			codex: stored(["event_msg/task_complete.time_to_first_token_ms"], {
				since: 7,
				facts: ["time_to_first_token_ms"],
			}),
		},
	},
	{
		id: "permission_mode",
		view: "runs",
		meaning:
			"The permission mode the run used (default, plan, accept edits, bypass).",
		runIndex: ["permission_mode", "permission_modes"],
		agents: {
			claude_code: stored(
				["user.permissionMode"],
				{ since: 7, facts: ["permission_mode"] },
				{
					gap: {
						sources: ["permission-mode.permissionMode"],
						plan: `${PARSER_9}: keep mid-session \`permission-mode\` records too.`,
					},
				},
			),
			codex: notRecorded(
				"no permission mode; Codex records approval_policy and sandbox_policy instead",
			),
		},
	},
	{
		id: "auto_mode_*",
		view: "runs",
		meaning: "The settings of Claude Code's auto mode for the run.",
		runIndex: [
			"auto_mode_bash_first",
			"auto_mode_bash_first_steer",
			"auto_mode_bypass",
			"auto_mode_steer_only",
			"auto_mode_consent_flow",
		],
		agents: {
			claude_code: stored(
				[
					"attachment/auto_mode.attachment.bashFirst",
					"attachment/auto_mode.attachment.bashFirstSteer",
					"attachment/auto_mode.attachment.bypass",
					"attachment/auto_mode.attachment.steerOnly",
					"attachment/auto_mode.attachment.autoModeConsentFlow",
				],
				{
					since: 7,
					facts: [
						"auto_mode_bash_first",
						"auto_mode_bash_first_steer",
						"auto_mode_bypass",
						"auto_mode_steer_only",
						"auto_mode_consent_flow",
					],
				},
			),
			codex: notRecorded("no auto mode"),
		},
	},
	{
		id: "mode",
		view: "runs",
		meaning:
			"A mode label Claude Code records separately from the permission mode.",
		agents: {
			claude_code: pending(
				["mode.mode", "attachment/plan_mode.attachment.planFilePath"],
				`${PARSER_9}: keep the mode label and a plan-mode attachment's plan file as recorded; no equivalence with Codex modes.`,
				{ notes: "Always `normal` in the local transcripts." },
			),
			codex: notRecorded("no such label; see collaboration_mode"),
		},
	},
	{
		id: "approval_policy",
		view: "runs",
		meaning:
			"When the agent must ask before acting (never, on request, untrusted).",
		runIndex: ["approval_policy"],
		agents: {
			claude_code: notRecorded("no approval policy; see permission_mode"),
			codex: stored(
				["turn_context/.approval_policy"],
				{ since: 7, facts: ["approval_policy"] },
				{
					gap: {
						sources: [
							"event_msg/thread_settings_applied.thread_settings.approval_policy",
						],
						plan: `${PARSER_9}: keep thread settings changes with their time.`,
					},
				},
			),
		},
	},
	{
		id: "approvals_reviewer",
		view: "runs",
		meaning:
			"Who reviews approval requests (the user or an automatic reviewer).",
		runIndex: ["approvals_reviewer"],
		agents: {
			claude_code: notRecorded("no approvals reviewer"),
			codex: stored(
				["turn_context/.approvals_reviewer"],
				{ since: 7, facts: ["approvals_reviewer"] },
				{
					gap: {
						sources: [
							"event_msg/thread_settings_applied.thread_settings.approvals_reviewer",
						],
						plan: `${PARSER_9}: keep thread settings changes with their time.`,
					},
				},
			),
		},
	},
	{
		id: "sandbox_policy",
		view: "runs",
		meaning:
			"The sandbox the run's commands ran in, and whether it allowed network access.",
		runIndex: ["sandbox_policy", "sandbox_network_access"],
		agents: {
			claude_code: notRecorded(
				"no sandbox policy; a shell call can only ask to bypass it (see sandbox_escalation)",
			),
			codex: stored(
				[
					"turn_context/.sandbox_policy.type",
					"turn_context/.sandbox_policy.network_access",
				],
				{ since: 7, facts: ["sandbox_policy", "sandbox_network_access"] },
			),
		},
	},
	{
		id: "permission_profile",
		view: "runs",
		meaning: "The named permission profile the run used.",
		runIndex: ["permission_profile"],
		agents: {
			claude_code: notRecorded("no permission profile"),
			codex: stored(
				["turn_context/.permission_profile.type"],
				{ since: 7, facts: ["permission_profile"] },
				{
					gap: {
						sources: [
							"turn_context/.active_permission_profile.id",
							"event_msg/thread_settings_applied.thread_settings.permission_profile.type",
						],
						plan: `${PARSER_9}: keep the active profile id and thread settings changes.`,
					},
				},
			),
		},
	},
	{
		id: "collaboration_mode",
		view: "runs",
		meaning: "Codex's collaboration mode for the run (default or plan).",
		runIndex: ["collaboration_mode"],
		agents: {
			claude_code: notRecorded(
				"no collaboration mode; see permission_mode (`plan`) and mode",
			),
			codex: stored(
				[
					"turn_context/.collaboration_mode.mode",
					"event_msg/task_started.collaboration_mode_kind",
				],
				{ since: 7, facts: ["collaboration_mode"] },
			),
		},
	},
	{
		id: "model",
		view: "runs",
		meaning: "The model the run used.",
		runIndex: ["model", "models"],
		agents: {
			claude_code: stored(
				["assistant.message.model"],
				{ since: 7, facts: ["model"] },
				{
					gap: {
						sources: ["attachment/model.attachment.identity.modelId"],
						plan: `${PARSER_9}: keep the configured model identity apart from the model that answered.`,
					},
					notes:
						"The model that answered each response; lines the harness wrote itself say `<synthetic>`. Not comparable with Codex, which records the configured model.",
				},
			),
			codex: stored(
				["turn_context/.model"],
				{ since: 7, facts: ["model"] },
				{
					gap: {
						sources: [
							"event_msg/thread_settings_applied.thread_settings.model",
							"turn_context/.collaboration_mode.settings.model",
							"response_item/message:developer.content[input_text].text~<model_switch>",
						],
						plan: `${PARSER_9}: keep thread settings changes with their time, and a \`<model_switch>\` notice (295 locally) as the moment the model changed.`,
					},
					notes:
						"The model the turn was configured with. A `<model_switch>` notice says the model changed but names neither model.",
				},
			),
		},
	},
	{
		id: "effort",
		view: "runs",
		meaning: "The reasoning effort the run used.",
		runIndex: ["effort", "per_turn_effort"],
		agents: {
			claude_code: stored(["assistant.effort", "assistant.perTurnEffort"], {
				since: 7,
				facts: ["effort", "per_turn_effort"],
			}),
			codex: stored(
				["turn_context/.effort"],
				{ since: 7, facts: ["effort"] },
				{
					gap: {
						sources: [
							"event_msg/thread_settings_applied.thread_settings.reasoning_effort",
							"turn_context/.collaboration_mode.settings.reasoning_effort",
						],
						plan: `${PARSER_9}: keep thread settings changes with their time.`,
					},
				},
			),
		},
	},
	{
		id: "advisor_model",
		view: "runs",
		meaning: "The advisor model the agent recorded on a response.",
		agents: {
			claude_code: pending(
				["assistant.advisorModel"],
				`${PARSER_9}: keep the recorded advisor model (about 51,000 responses locally, \`claude-opus-5-5\` or \`claude-fable-5-1\`) apart from the model that answered.`,
			),
			codex: notRecorded(
				"no advisor model; no key containing `advisor` on any record",
			),
		},
	},
	{
		id: "service_tier",
		view: "runs",
		meaning:
			"The service tier requests ran at (standard, priority), which changes their price.",
		decision:
			"Codex responses record no service tier, only the thread's configured one (`thread_settings_applied`). Should Codex usage be priced at the configured tier?",
		agents: {
			claude_code: stored(
				[
					"assistant.message.usage.service_tier",
					"assistant.message.usage.speed",
				],
				{ elsewhere: USAGE },
				{ testedIn: USAGE_TEST },
			),
			codex: pending(
				["event_msg/thread_settings_applied.thread_settings.service_tier"],
				"usage extraction (packages/usage-events): it reads `token_count.info.service_tier`, which no local record has; read the configured tier instead, marked as configured",
				{ notes: "Configured for the thread, not recorded per response." },
			),
		},
	},
	{
		id: "entrypoint",
		view: "runs",
		meaning: "How the agent was started (CLI, IDE, SDK, exec).",
		runIndex: ["entrypoint"],
		agents: {
			claude_code: stored(["*.entrypoint"], {
				since: 6,
				facts: ["entrypoint"],
			}),
			codex: stored(
				["session_meta/.originator"],
				{ since: 6, facts: ["entrypoint"] },
				{
					gap: {
						sources: ["session_meta/.source"],
						plan: `${PARSER_9}: keep the session's \`source\` (cli, vscode, exec) too.`,
					},
				},
			),
		},
	},
	{
		id: "agent_version",
		view: "runs",
		meaning: "The agent's version.",
		runIndex: ["agent_version"],
		agents: {
			claude_code: stored(["*.version"], { since: 6, facts: ["agentVersion"] }),
			codex: stored(["session_meta/.cli_version"], {
				since: 6,
				facts: ["agentVersion"],
			}),
		},
	},
	{
		id: "cost_usd",
		view: "runs",
		meaning: "What the run's model requests cost, and their tokens by kind.",
		agents: {
			claude_code: stored(
				[
					"assistant.message.id",
					"assistant.message.usage.input_tokens",
					"assistant.message.usage.output_tokens",
					"assistant.message.usage.cache_read_input_tokens",
					"assistant.message.usage.cache_creation_input_tokens",
					"assistant.message.usage.cache_creation.*",
					"assistant.message.usage.inference_geo",
				],
				{ elsewhere: USAGE },
				{ testedIn: USAGE_TEST },
			),
			codex: stored(
				[
					"event_msg/token_count.info.last_token_usage.*",
					"event_msg/token_count.info.total_token_usage.*",
				],
				{ elsewhere: USAGE },
				{ testedIn: USAGE_TEST },
			),
		},
	},
	{
		id: "request_usage",
		view: "runs",
		meaning: "Token usage of each model request, with the request's id.",
		agents: {
			claude_code: stored(
				[
					"assistant.message.id",
					"assistant.requestId",
					"assistant.message.usage.iterations[].*",
					"assistant.message.usage.iterations[].cache_creation.*",
				],
				{ elsewhere: USAGE },
				{ testedIn: USAGE_TEST },
			),
			codex: pending(
				[
					"token_usage_record/.response_id",
					"token_usage_record/.turn_id",
					"token_usage_record/.root_turn_id",
					"token_usage_record/.usage.*",
					"token_usage_record/.turn_token_usage.*",
					"token_usage_record/.thread_token_usage.*",
				],
				"usage extraction (packages/usage-events): read `token_usage_record` (about 80,000 locally) with its response id; keep request, turn and thread usage apart and never add them to the `token_count` witnesses",
			),
		},
	},
	{
		id: "reasoning_output_tokens",
		view: "runs",
		meaning: "Output tokens the model spent reasoning.",
		agents: {
			claude_code: pending(
				["assistant.message.usage.output_tokens_details.thinking_tokens"],
				"usage extraction (packages/usage-events): read `thinking_tokens` (about 50,000 responses locally); it writes 0 today",
			),
			codex: stored(
				["event_msg/token_count.info.last_token_usage.reasoning_output_tokens"],
				{ elsewhere: USAGE },
				{ testedIn: USAGE_TEST },
			),
		},
	},
	{
		id: "server_tool_requests",
		view: "runs",
		meaning:
			"Web searches and fetches the provider ran for a request, which are billed apart from tokens.",
		agents: {
			claude_code: pending(
				[
					"assistant.message.usage.server_tool_use.web_search_requests",
					"assistant.message.usage.server_tool_use.web_fetch_requests",
				],
				"usage extraction (packages/usage-events): read the request counts (about 52,000 responses locally); they are not priced today",
			),
			codex: notRecorded(
				"no request counts in token counts or usage records; Codex web searches are calls of their own",
			),
		},
	},
	{
		id: "thinking_duration_ms",
		view: "runs",
		meaning: "How long the model spent reasoning before a response.",
		agents: {
			claude_code: pending(
				["assistant.thinkingDurationMs"],
				`${PARSER_9}: keep the recorded reasoning time (2.1.292 and later).`,
			),
			codex: pending(
				[
					"event_msg/item_completed.started_at_ms",
					"event_msg/item_completed.completed_at_ms",
				],
				`${PARSER_9}: keep the recorded start and end of a completed Reasoning item (about 96,000 of 103,000 locally carry both); the duration is their difference.`,
				{
					notes:
						"The span of the reasoning item, not a duration the agent wrote; versions without completed items record none.",
				},
			),
		},
	},
	{
		id: "cache_miss_reason",
		view: "runs",
		meaning: "Why the provider says a request missed its prompt cache.",
		agents: {
			claude_code: pending(
				[
					"assistant.message.diagnostics.cache_miss_reason.type",
					"assistant.message.diagnostics.cache_miss_reason.cache_missed_input_tokens",
				],
				`${PARSER_9}: keep the recorded reason and missed tokens (162 responses locally).`,
			),
			codex: notRecorded(
				"no cache diagnostics on token counts or usage records",
			),
		},
	},
	{
		id: "rate_limits",
		view: "runs",
		meaning: "The rate-limit and quota state the provider reported.",
		agents: {
			claude_code: pending(
				[
					"assistant.quotaLimits.status",
					"assistant.quotaLimits.rateLimitType",
					"assistant.quotaLimits.resetsAt",
					"assistant.quotaLimits.*",
				],
				`${PARSER_9}: keep the recorded quota state (7 responses locally).`,
			),
			codex: pending(
				["event_msg/token_count.rate_limits.**"],
				`${PARSER_9}: keep the snapshot and its reached-limit fields (about 440,000 token counts locally).`,
				{
					notes:
						"A usage percentage alone does not prove a request was limited. `rate_limit_reached_type` is on every token count and always null locally; a turn that hit the limit ends with turn_error_kind `usage_limit_exceeded` (21 locally).",
				},
			),
		},
	},
	{
		id: "mcp_server_state",
		view: "runs",
		meaning:
			"MCP servers or connectors the agent recorded as needing authentication, still connecting, or failed.",
		agents: {
			claude_code: pending(
				[
					"attachment/deferred_tools_delta.attachment.needsAuthMcpServers[]",
					"attachment/deferred_tools_delta.attachment.pendingMcpServers[]",
					"attachment/deferred_tools_delta.attachment.failedMcpServers",
				],
				`${PARSER_9}: keep the server names of a tools update as recorded (needing authentication on 344, still connecting on 20 locally; the failed list is always empty).`,
			),
			codex: pending(
				["event_msg/item_completed:McpToolCall.result._meta"],
				`${PARSER_9}: keep a call's recorded connector authentication failure (\`_meta._codex_apps.connector_auth_failure\`, 74 locally).`,
				{
					notes:
						"Per call, not a server state; the call's error message is its result text, and an MCP startup failure appears only in output text.",
				},
			),
		},
	},
	{
		id: "context_window",
		view: "runs",
		meaning: "The model's context window size.",
		runIndex: ["context_window"],
		agents: {
			claude_code: notRecorded(
				"no window size; a model id's `[1m]` suffix names the 1M-token variant but is not a recorded size",
			),
			codex: stored(
				["event_msg/task_started.model_context_window"],
				{ since: 7, facts: ["context_window"] },
				{
					notes:
						"usage extraction also reads `token_count.info.model_context_window`.",
				},
			),
		},
	},
	{
		id: "context_input_tokens_at_start",
		view: "runs",
		meaning:
			"Input tokens of the run's first request: how full the context was when it started.",
		agents: {
			claude_code: stored(
				["assistant.message.usage.input_tokens"],
				{ elsewhere: USAGE },
				{ testedIn: USAGE_TEST },
			),
			codex: stored(
				["event_msg/token_count.info.last_token_usage.input_tokens"],
				{ elsewhere: USAGE },
				{ testedIn: USAGE_TEST },
			),
		},
	},
	{
		id: "compacted",
		view: "runs",
		meaning: "The conversation was compacted (summarized to free context).",
		agents: {
			claude_code: stored(
				["system/compact_boundary.content", "user.isCompactSummary"],
				{ since: 1, record: ["kind"] },
				{ notes: CLAUDE_NO_LOCAL_COMPACTION },
			),
			codex: stored(
				[
					"compacted/.message",
					"compacted/.replacement_history**",
					"response_item/compaction.encrypted_content",
					"event_msg/context_compacted",
				],
				{ since: 1, record: ["kind"] },
				{
					gap: {
						sources: [
							"event_msg/item_completed:ContextCompaction.id",
							"compacted/.window_id",
							"compacted/.previous_window_id",
							"compacted/.window_number",
							"compacted/.first_window_id",
						],
						plan: `${PARSER_9}: a completed ContextCompaction item (the only witness in some sessions) becomes a compaction boundary with its turn id; keep window ids.`,
					},
				},
			),
		},
	},
	{
		id: "compact_trigger",
		view: "runs",
		meaning: "What started a compaction (automatic or the user).",
		runIndex: ["compact_trigger"],
		agents: {
			claude_code: stored(
				["system/compact_boundary.compactMetadata.trigger"],
				{ since: 7, facts: ["compact_trigger"] },
				{ notes: CLAUDE_NO_LOCAL_COMPACTION },
			),
			codex: notRecorded(
				"no trigger on `compacted`, `compaction` or ContextCompaction records",
			),
		},
	},
	{
		id: "compact_pre_tokens",
		view: "runs",
		meaning: "Tokens in the context just before a compaction.",
		runIndex: ["compact_pre_tokens"],
		agents: {
			claude_code: stored(
				["system/compact_boundary.compactMetadata.preTokens"],
				{
					since: 7,
					facts: ["compact_pre_tokens"],
				},
				{ notes: CLAUDE_NO_LOCAL_COMPACTION },
			),
			codex: pending(
				["compacted/.latest_token_usage_record.**"],
				`${PARSER_9}: keep the compaction's latest usage record, once checked to be the usage before it.`,
			),
		},
	},
	{
		id: "tool_calls",
		view: "runs",
		meaning: "Number of tool calls in the run.",
		agents: {
			claude_code: stored(
				[],
				{ elsewhere: RUN_INDEX },
				{ testedIn: RUN_INDEX_TEST },
			),
			codex: stored([], { elsewhere: RUN_INDEX }, { testedIn: RUN_INDEX_TEST }),
		},
	},
	{
		id: "failed_calls",
		view: "runs",
		meaning: "Number of failed tool calls in the run.",
		agents: {
			claude_code: stored(
				[],
				{ elsewhere: RUN_INDEX },
				{ testedIn: RUN_INDEX_TEST },
			),
			codex: wrong(
				[],
				{ elsewhere: RUN_INDEX },
				"follows is_error: refused and failed-transport calls are not counted until parser 9",
				{ testedIn: RUN_INDEX_TEST },
			),
		},
	},
	{
		id: "denied_calls",
		view: "runs",
		meaning: "Number of refused tool calls in the run.",
		agents: {
			claude_code: stored(
				[],
				{ elsewhere: RUN_INDEX },
				{ testedIn: RUN_INDEX_TEST },
			),
			codex: stored([], { elsewhere: RUN_INDEX }, { testedIn: RUN_INDEX_TEST }),
		},
	},
	{
		id: "edits",
		view: "runs",
		meaning: "Number of files the run changed.",
		agents: {
			claude_code: stored(
				[],
				{ elsewhere: RUN_INDEX },
				{
					testedIn: RUN_INDEX_TEST,
					notes:
						"Changes of failed calls are left out; a shell change that succeeded but may have done nothing still counts (see file_op).",
				},
			),
			codex: wrong(
				[],
				{ elsewhere: RUN_INDEX },
				"follows file_op and is_error: a refused call's shell or patch change still counts until parser 9",
				{ testedIn: RUN_INDEX_TEST },
			),
		},
	},
	{
		id: "reads",
		also: ["searches"],
		view: "runs",
		meaning: "Number of read and search calls in the run.",
		agents: {
			claude_code: stored(
				[],
				{ elsewhere: RUN_INDEX },
				{ testedIn: RUN_INDEX_TEST },
			),
			codex: wrong(
				["event_msg/item_completed:CommandExecution.parsed_cmd[].type"],
				{ elsewhere: RUN_INDEX },
				"counted by tool name, and Codex reads and searches through the shell: count the `read` and `search` parts Codex recorded (parsed_cmd) once parser 9 stores them as reads",
				{ testedIn: RUN_INDEX_TEST },
			),
		},
	},
	{
		id: "not_found",
		view: "runs",
		meaning:
			"Number of failed reads and searches whose output says the target was not found.",
		agents: {
			claude_code: stored(
				[],
				{ elsewhere: RUN_INDEX },
				{
					testedIn: RUN_INDEX_TEST,
					notes:
						"A text match on the output (`not found`, `No such file`, `ENOENT`).",
				},
			),
			codex: stored(
				[],
				{ elsewhere: RUN_INDEX },
				{
					testedIn: RUN_INDEX_TEST,
					notes:
						"A text match on the output (`not found`, `No such file`, `ENOENT`).",
				},
			),
		},
	},
	{
		id: "aborted",
		view: "runs",
		meaning: "The run was stopped before it finished.",
		runIndex: ["aborted"],
		agents: {
			claude_code: stored(
				["user.interruptedByShutdown"],
				{ since: 7, facts: ["aborted"] },
				{
					gap: {
						sources: [
							"user.message.content[text].text~Request interrupted by user",
							"user.message.content~Request interrupted by user",
						],
						plan: `${PARSER_9}: an \`[Request interrupted by user…]\` marker marks the run aborted.`,
					},
				},
			),
			codex: stored(["event_msg/turn_aborted.reason"], {
				since: 7,
				facts: ["aborted"],
			}),
		},
	},
	{
		id: "abort_reason",
		view: "runs",
		meaning: "Why the run was stopped.",
		runIndex: ["abort_reason"],
		agents: {
			claude_code: pending(
				[
					"user.message.content[text].text~Request interrupted by user",
					"user.message.content~Request interrupted by user",
				],
				`${PARSER_9}: keep the interrupt marker's exact variant (\`by user\`, \`by user for tool use\`); it is an empty meta row today.`,
			),
			codex: stored(["event_msg/turn_aborted.reason"], {
				since: 7,
				facts: ["abort_reason"],
			}),
		},
	},
	{
		id: "turn_error",
		view: "runs",
		meaning: "The error that ended the run.",
		runIndex: ["turn_error"],
		agents: {
			claude_code: notRecorded(
				"no run-ending error record; failed requests are api_errors",
			),
			codex: stored(
				[
					"event_msg/task_complete.error.message",
					"event_msg/task_complete.error.codex_error_info",
					"event_msg/task_complete.error.codex_error_info.**",
				],
				{ since: 7, facts: ["turn_error", "turn_error_info"] },
			),
		},
	},
	{
		id: "turn_error_kind",
		view: "runs",
		meaning: "The kind of error that ended the run, as the agent names it.",
		runIndex: ["turn_error_kind"],
		agents: {
			claude_code: notRecorded("no run-ending error record; see api_errors"),
			codex: stored(
				[
					"event_msg/task_complete.error.codex_error_info",
					"event_msg/task_complete.error.codex_error_info.**",
				],
				{ since: 7, facts: ["turn_error_kind"] },
			),
		},
	},
	{
		id: "turn_id",
		view: "runs",
		meaning: "The agent's own id of the run, which joins its records.",
		agents: {
			claude_code: pending(
				[
					"user.promptId",
					"user.turnPosition.turnIndex",
					"user.turnPosition.promptIndex",
				],
				`${PARSER_9}: keep \`promptId\` and \`turnPosition\` as recorded.`,
				{
					notes:
						"A sub-agent's records carry the `promptId` of the parent prompt that started it (135 of 136 local sub-agent files), like Codex's `root_turn_id`.",
				},
			),
			codex: stored(
				[
					"turn_context/.turn_id",
					"event_msg/task_started.turn_id",
					"event_msg/task_complete.turn_id",
					"event_msg/turn_aborted.turn_id",
				],
				{ since: 7, facts: ["turn_id"] },
				{
					gap: {
						sources: [
							"event_msg/thread_goal_updated.turnId",
							"event_msg/item_completed.turn_id",
							"event_msg/item_completed.thread_id",
							"event_msg/task_started.root_turn_id",
							"turn_context/.root_turn_id",
						],
						plan: `${PARSER_9}: completed items keep their envelope turn and thread ids, goal events their camel-case \`turnId\`, and \`root_turn_id\` is kept.`,
					},
				},
			),
		},
	},
	{
		id: "stop_reason",
		view: "runs",
		meaning:
			"Why the model stopped writing (finished, wanted a tool, hit a limit, refused).",
		runIndex: ["stop_reason"],
		agents: {
			claude_code: stored(
				["assistant.message.stop_reason"],
				{ since: 7, facts: ["stop_reason"] },
				{
					gap: {
						sources: ["assistant.message.stop_details.*"],
						plan: `${PARSER_9}: keep a refusal's \`stop_details\` (category, explanation).`,
					},
				},
			),
			codex: notRecorded(
				"no stop reason on messages, completions or token counts; a message's `phase` (message_phase) is not one",
			),
		},
	},
	{
		id: "message_phase",
		view: "runs",
		meaning: "Whether an assistant message was commentary or the final answer.",
		agents: {
			claude_code: notRecorded("no phase on assistant messages"),
			codex: pending(
				[
					"response_item/message:assistant.phase",
					"event_msg/item_completed:AgentMessage.phase",
					"event_msg/agent_message.phase",
					"event_msg/task_complete.last_agent_message",
				],
				`${PARSER_9}: keep each message's phase as recorded.`,
			),
		},
	},
	{
		id: "hook_stop_reason",
		view: "runs",
		meaning: "The reason a stop hook gave.",
		runIndex: ["hook_stop_reason"],
		agents: {
			claude_code: stored(["system/stop_hook_summary.stopReason"], {
				since: 7,
				facts: ["hook_stop_reason"],
			}),
			codex: notRecorded("no hook records in any rollout"),
		},
	},
	{
		id: "hook_errors",
		view: "runs",
		meaning: "Errors the run's hooks reported, and how many hooks ran.",
		runIndex: ["hook_errors", "hook_count"],
		agents: {
			claude_code: stored(
				[
					"system/stop_hook_summary.hookErrors[]",
					"system/stop_hook_summary.hookErrors",
					"system/stop_hook_summary.hookCount",
				],
				{ since: 7, facts: ["hook_errors", "hook_errors_more", "hook_count"] },
			),
			codex: notRecorded("no hook records in any rollout"),
		},
	},
	{
		id: "prevented_continuation",
		view: "runs",
		meaning: "A hook stopped the agent from continuing.",
		runIndex: ["prevented_continuation"],
		agents: {
			claude_code: stored(["system/stop_hook_summary.preventedContinuation"], {
				since: 7,
				facts: ["prevented_continuation"],
			}),
			codex: notRecorded("no hook records in any rollout"),
		},
	},
	{
		id: "hook_runs",
		view: "runs",
		meaning: "The hooks that ran: command and duration.",
		runIndex: ["hook_runs"],
		agents: {
			claude_code: stored(
				[
					"system/stop_hook_summary.hookInfos[].command",
					"system/stop_hook_summary.hookInfos[].durationMs",
				],
				{ since: 7, facts: ["hook_runs", "hook_runs_more"] },
			),
			codex: notRecorded("no hook records in any rollout"),
		},
	},
	{
		id: "api_errors",
		view: "runs",
		meaning: "Errors the model provider returned.",
		runIndex: ["api_errors", "api_error", "api_error_statuses"],
		agents: {
			claude_code: stored(
				[
					"assistant.error",
					"assistant.apiErrorStatus",
					"assistant.isApiErrorMessage",
				],
				{ since: 7, facts: ["api_error", "api_error_status"] },
				{
					gap: {
						sources: [
							"system/api_error.error.status",
							"system/api_error.error.connection.code",
							"system/api_error.error.message",
							"system/api_error.error.formatted",
						],
						plan: `${PARSER_9}: keep a retried request's HTTP status and connection error code (stored only as text today).`,
					},
				},
			),
			codex: pending(
				[
					"event_msg/task_complete.error.codex_error_info",
					"event_msg/task_complete.error.codex_error_info.**",
					"event_msg/task_complete.error.message",
					"event_msg/error.message",
				],
				`${PARSER_9}: count a turn error Codex classifies as a provider error (\`server_overloaded\` 25, \`usage_limit_exceeded\` 21, \`http_connection_failed\` 3 locally) as an API error, with its kind as recorded; it is stored only as turn_error_kind today.`,
				{
					notes:
						"Codex records a failed request only when it ends the turn; no `error` or `stream_error` events occur locally (the parser keeps an `error` event's text when one does).",
				},
			),
		},
	},
	{
		id: "retry_attempts",
		view: "runs",
		meaning: "Retries of failed model requests.",
		runIndex: ["retry_attempts"],
		agents: {
			claude_code: stored(
				[
					"system/api_error.retryAttempt",
					"system/api_error.maxRetries",
					"system/api_error.retryInMs",
				],
				{ since: 7, facts: ["retry_attempt", "max_retries", "retry_in_ms"] },
			),
			codex: notRecorded("no retry records"),
		},
	},
	{
		id: "refusals",
		view: "runs",
		meaning: "The model refused a request, and in which category.",
		runIndex: ["refusals"],
		agents: {
			claude_code: stored(
				[
					"system/model_refusal_fallback.apiRefusalCategory",
					"system/model_refusal_fallback.originalModel",
					"system/model_refusal_no_fallback.apiRefusalCategory",
					"system/model_refusal_no_fallback.originalModel",
				],
				{ since: 7, facts: ["refusal_category", "original_model"] },
			),
			codex: pending(
				[
					"event_msg/task_complete.error.codex_error_info",
					"event_msg/task_complete.error.message",
				],
				`${PARSER_9}: count a turn Codex ended for a policy (\`cyber_policy\` 7, \`misalignment_policy_violation\` 3 locally) as a refusal, with the kind as its category; it is stored only as turn_error_kind today.`,
				{
					notes:
						"A refusal ends the turn as an error; Codex records no refusal record or fallback model.",
				},
			),
		},
	},
	{
		id: "fallback_model",
		view: "runs",
		meaning: "The model the agent switched to after a refusal.",
		runIndex: ["fallback_model"],
		agents: {
			claude_code: stored(
				["system/model_refusal_fallback.fallbackModel"],
				{ since: 7, facts: ["fallback_model"] },
				{
					gap: {
						sources: [
							"assistant.message.content[fallback].from.model",
							"assistant.message.content[fallback].to.model",
						],
						plan: `${PARSER_9}: keep the fallback content block's models.`,
					},
				},
			),
			codex: notRecorded("no fallback records"),
		},
	},
	{
		id: "goal",
		view: "runs",
		meaning:
			"The goal set for the thread, its status, and the tokens and time spent on it.",
		runIndex: ["goal"],
		agents: {
			claude_code: notRecorded("no goal records"),
			codex: stored(
				[
					"event_msg/thread_goal_updated.goal.objective",
					"event_msg/thread_goal_updated.goal.status",
					"event_msg/thread_goal_updated.goal.tokensUsed",
					"event_msg/thread_goal_updated.goal.timeUsedSeconds",
				],
				{
					since: 7,
					facts: [
						"goal",
						"goal_status",
						"goal_tokens_used",
						"goal_time_used_seconds",
					],
				},
			),
		},
	},
	{
		id: "pushed_shas",
		view: "runs",
		meaning: "The commits the run pushed.",
		agents: {
			claude_code: stored(
				["user.message.content[tool_result].content"],
				{ elsewhere: GIT },
				{
					testedIn: GIT_TEST,
					notes:
						"From push output; `gitOperation` records only the pushed branch.",
				},
			),
			codex: stored(CODEX_OUTPUTS, { elsewhere: GIT }, { testedIn: GIT_TEST }),
		},
	},
	{
		id: "pr_number",
		also: ["pr_repository"],
		view: "runs",
		meaning: "The pull requests the run created or named.",
		runIndex: ["pr_urls"],
		agents: {
			claude_code: stored(
				[
					"pr-link.prRepository",
					"pr-link.prNumber",
					"pr-link.prUrl",
					"user.toolUseResult.gitOperation.pr.url",
					"user.toolUseResult.gitOperation.pr.number",
				],
				{
					since: 6,
					facts: [
						"pr_repository",
						"pr_number",
						"pr_url",
						"git.pr.url",
						"git.pr.number",
					],
				},
				{
					gap: {
						sources: ["assistant.message.content[tool_use:mcp__{*}].input"],
						plan: "git extractor: record a pull request a tool linked (`mcp__t3-code__link_pull_request`, 35 calls locally) as linked, not created.",
					},
				},
			),
			codex: stored(
				CODEX_OUTPUTS,
				{ elsewhere: GIT },
				{
					testedIn: GIT_TEST,
					gap: {
						sources: ["response_item/function_call:*.namespace"],
						plan: "git extractor: match connector tools by namespace and name (43 `_create_pull_request` calls locally produce no observation); needs tool_namespace.",
					},
				},
			),
		},
	},
	{
		id: "ci_runs_after_push",
		also: ["ci_checked_after_push"],
		view: "runs",
		meaning:
			"CI runs on the commits the run pushed, and whether the agent checked them.",
		agents: {
			claude_code: pending(
				[],
				"L1 edges: join pushed commits to `github_ci_runs` (inputs stored, join not built)",
			),
			codex: pending(
				[],
				"L1 edges: join pushed commits to `github_ci_runs` (inputs stored, join not built)",
			),
		},
	},
	{
		id: "repository_id",
		view: "runs",
		meaning: "The repository the session worked in.",
		agents: {
			claude_code: stored(
				[],
				{
					elsewhere:
						"the session's git remote from the CLI and the repository evidence index; a literal coalesce in analysis",
				},
				{ testedIn: "apps/api/src/services/analysis/git-links.test.ts" },
			),
			codex: stored(
				["session_meta/.git.repository_url", "session_meta/.git.commit_hash"],
				{
					elsewhere:
						"Codex git metadata, the git remote from the CLI and the repository evidence index",
				},
				{ testedIn: "apps/api/src/services/analysis/git-links.test.ts" },
			),
		},
	},

	// --- prompts ---------------------------------------------------------------
	{
		id: "kind",
		also: ["subtype"],
		view: "prompts",
		meaning:
			"Whether a user-role message is a person's prompt, injected context, a queued prompt or a delegated task.",
		agents: {
			claude_code: stored(
				[
					"user.message.content",
					"user.message.content[text].text",
					"user.isMeta",
					"attachment/queued_command.attachment.prompt",
					"attachment/queued_command.attachment.commandMode",
				],
				{ since: 1, record: ["kind", "subtype"] },
				{
					notes:
						"Prompt kinds are still told apart by their wrappers; prompt_origin holds what the agent recorded.",
				},
			),
			codex: stored(
				[
					"response_item/message:user.content[input_text].text",
					"event_msg/user_message.message",
					"response_item/agent_message.content[input_text].text",
					"response_item/agent_message.author",
					"response_item/agent_message.recipient",
				],
				{ since: 1, record: ["kind", "subtype"] },
				{
					notes:
						"Prompt kinds are still told apart by their wrappers; prompt_origin holds what the agent recorded.",
				},
			),
		},
	},
	{
		id: "prompt_origin",
		view: "prompts",
		alsoIn: ["runs"],
		meaning:
			"Where a prompt came from (a person, a task notification, another agent), as recorded.",
		runIndex: [
			"turn_origin",
			"prompt_source",
			"origin_kind",
			"trigger_turn",
			"thread_source",
		],
		agents: {
			claude_code: stored(
				["user.turnOrigin", "user.promptSource", "user.origin.kind"],
				{ since: 8, facts: ["turn_origin", "prompt_source", "origin_kind"] },
				{
					gap: {
						sources: [
							"user.origin.producer",
							"user.origin.from",
							"user.origin.fromMode",
							"user.origin.name",
							"user.origin.senderTaskId",
							"user.origin.runId",
							"attachment/queued_command.attachment.origin.kind",
						],
						plan: `${PARSER_9}: keep the origin's producer, sender and task id.`,
					},
				},
			),
			codex: stored(
				[
					"inter_agent_communication_metadata/.trigger_turn",
					"session_meta/.thread_source",
				],
				{ since: 8, facts: ["trigger_turn", "thread_source"] },
				{
					gap: {
						sources: [
							"response_item/agent_message.author",
							"response_item/agent_message.recipient",
						],
						plan: `${PARSER_9}: keep the sender and recipient agent paths of a message between agents (about 9,000 locally), like Claude Code's origin sender; they only classify the record today.`,
					},
				},
			),
		},
	},
	{
		id: "text",
		also: ["text_chars"],
		view: "prompts",
		meaning: "The prompt's text and length.",
		agents: {
			claude_code: stored(
				["user.message.content", "user.message.content[text].text"],
				{ since: 1, record: ["text", "textChars"] },
			),
			codex: stored(
				[
					"response_item/message:user.content[input_text].text",
					"event_msg/user_message.message",
				],
				{ since: 1, record: ["text", "textChars"] },
			),
		},
	},
	{
		id: "instruction_path",
		view: "prompts",
		meaning:
			"The instruction files (CLAUDE.md, AGENTS.md) loaded into the context.",
		agents: {
			claude_code: stored(
				[
					"attachment/instructions.attachment.files[].path",
					"attachment/instructions.attachment.files[].type",
					"attachment/nested_memory.attachment.path",
				],
				{
					since: 8,
					facts: ["instruction_paths", "instruction_paths_more"],
					record: ["filePath"],
				},
			),
			codex: pending(
				[
					"response_item/message:user.content[input_text].text~AGENTS.md instructions",
					"world_state/.state.agents_md.directory",
				],
				`${PARSER_9}: keep the directory Codex names for its AGENTS.md instructions (about 3,500 injections locally).`,
				{
					notes:
						"Codex names the directory, not the file; no file name is invented.",
				},
			),
		},
	},
	{
		id: "instruction_sha256",
		view: "prompts",
		meaning: "A hash that identifies the version of an instruction file.",
		decision:
			"Should instruction_sha256 hash the instruction text as the agent received it (what the model saw), or only repository files from CLI captures?",
		agents: {
			claude_code: pending(
				[
					"attachment/instructions.attachment.files[].content",
					"attachment/nested_memory.attachment.content.content",
				],
				`${PARSER_9} or the repository configuration index (order of work step 9), after the decision`,
			),
			codex: pending(
				[
					"world_state/.state.agents_md.text",
					"response_item/message:user.content[input_text].text~AGENTS.md instructions",
				],
				`${PARSER_9} or the repository configuration index (order of work step 9), after the decision`,
			),
		},
	},
	{
		id: "instruction_text",
		view: "prompts",
		meaning:
			"The instructions the agent actually received: system prompt, instruction files, developer messages.",
		agents: {
			claude_code: stored(
				[
					"attachment/instructions.attachment.files[].content",
					"attachment/nested_memory.attachment.content.content",
					"attachment/skill_listing.attachment.content",
					"attachment/mcp_instructions_delta.attachment.addedBlocks[]",
				],
				{ since: 5, record: ["text"] },
				{
					gap: {
						sources: ["attachment/prompt_snapshot.attachment.systemPrompt[]"],
						plan: `${PARSER_9}: keep the system prompt of \`prompt_snapshot\` attachments as injected context (493 locally).`,
					},
				},
			),
			codex: stored(
				[
					"response_item/message:developer.content[input_text].text",
					"response_item/message:user.content[input_text].text~AGENTS.md instructions",
				],
				{ since: 5, record: ["text"] },
				{
					gap: {
						sources: [
							"session_meta/.base_instructions.text",
							"turn_context/.user_instructions",
							"world_state/.state.agents_md.text",
						],
						plan: `${PARSER_9}: keep base instructions, user instructions and world-state AGENTS.md text as injected context, labelled by source.`,
					},
				},
			),
		},
	},
	{
		id: "edited_by_user_path",
		view: "prompts",
		meaning:
			"A file the user edited outside the agent, which the agent was told about.",
		agents: {
			claude_code: stored(
				[
					"attachment/edited_text_file.attachment.filename",
					"attachment/edited_text_file.attachment.snippet",
				],
				{ since: 5, record: ["filePath"] },
			),
			codex: notRecorded(
				"no notice of files edited outside the agent; the 8 `<external_codex_apps_writing_block_edits>` notices (the user edited an app's writing blocks) name no file",
			),
		},
	},
	{
		id: "slash_command",
		view: "prompts",
		meaning: "A slash command the user ran.",
		runIndex: ["slash_commands"],
		agents: {
			claude_code: stored(
				["user.message.content"],
				{ since: 1, record: ["text"] },
				{
					testedIn: RUN_INDEX_TEST,
					notes:
						"run_index reads the command name from the prompt's `<command-name>` wrapper.",
				},
			),
			codex: notRecorded(
				"no slash-command record or wrapper; a prompt can start with typed text such as `/goal`, which cannot be told apart from a path",
			),
		},
	},
	{
		id: "queue_operation",
		view: "prompts",
		meaning:
			"A prompt the user queued while the agent worked: queued, delivered or removed.",
		agents: {
			claude_code: pending(
				[
					"queue-operation.operation",
					"queue-operation.reason",
					"queue-operation.content",
					"queue-operation.commandUuid",
					"queue-operation.deliveryId",
				],
				`${PARSER_9}: keep the operation and its ids; pair queue and delivery only by recorded ids.`,
			),
			codex: notRecorded("no queue records"),
		},
	},

	// --- session ---------------------------------------------------------------
	{
		id: "cost_state",
		view: "session",
		meaning:
			"The agent's own running totals for the session: cost, lines changed, time.",
		runIndex: ["cost_state"],
		agents: {
			claude_code: stored(
				[
					"cost-state.totalCostUSD",
					"cost-state.totalLinesAdded",
					"cost-state.totalLinesRemoved",
					"cost-state.totalToolDuration",
					"cost-state.totalAPIDuration",
					"cost-state.totalAPIDurationWithoutRetries",
					"cost-state.hasUnknownModelCost",
					"cost-state.totalDuration",
				],
				{
					since: 8,
					facts: [
						"cost_usd",
						"lines_added",
						"lines_removed",
						"tool_duration_ms",
						"api_duration_ms",
						"api_duration_without_retries_ms",
						"has_unknown_model_cost",
						"durationMs",
					],
				},
				{
					gap: {
						sources: [
							"cost-state.modelUsage",
							"cost-state.modelUsage.{*}.*",
							"cost-state.startTime",
						],
						plan: `${PARSER_9}: keep the per-model totals.`,
					},
				},
			),
			codex: notRecorded(
				"no cumulative cost record; token counts are usage (cost_usd)",
			),
		},
	},
	{
		id: "title",
		view: "session",
		meaning: "The session's title.",
		runIndex: ["title"],
		agents: {
			claude_code: stored(["ai-title.aiTitle"], { since: 8, facts: ["title"] }),
			codex: pending(
				[],
				"CLI: read the thread's title from ~/.codex/state_5.sqlite (`threads.title`, 2,153 of 2,634 threads locally) or ~/.codex/session_index.jsonl (404 thread names) and send it with the upload",
				{
					notes:
						"Not in rollouts: Codex keeps titles in its local state, which is not uploaded today.",
				},
			),
		},
	},
	{
		id: "upload_mode",
		view: "session",
		meaning: "How the session was uploaded (hook, manual, retry).",
		agents: {
			claude_code: pending(
				[],
				"CLI: send the upload mode with the request (not a transcript fact)",
			),
			codex: pending(
				[],
				"CLI: send the upload mode with the request (not a transcript fact)",
			),
		},
	},
	{
		id: "member_coverage",
		view: "session",
		meaning: "How many workspace members upload sessions, per day.",
		agents: {
			claude_code: pending(
				[],
				"join of session ownership and workspace membership (not a transcript fact)",
			),
			codex: pending(
				[],
				"join of session ownership and workspace membership (not a transcript fact)",
			),
		},
	},
	{
		id: "instruction_file_versions",
		view: "session",
		meaning: "Which version of each instruction file the session ran under.",
		agents: {
			claude_code: pending(
				[],
				"repository configuration index (order of work step 9), with instruction_sha256",
			),
			codex: pending(
				[],
				"repository configuration index (order of work step 9), with instruction_sha256",
			),
		},
	},
	{
		id: "approved_permission_prompts",
		view: "session",
		meaning: "Permission prompts the user approved.",
		agents: {
			claude_code: pending(
				["user.permissionDecision.decision", "user.permissionDecision.source"],
				`${PARSER_9}: counted from permission_decision once its decision is made (the spec said this is not in transcripts; it is).`,
				{
					notes:
						"Only 5 local decisions were a person's (`user_temporary`); the rest were accepted by the permission mode or rejected by a hook.",
				},
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.sandbox_permissions",
					"response_item/function_call:exec_command.arguments.prefix_rule[]",
				],
				`${PARSER_9}: counted from permission_decision and sandbox_escalation; no approval-prompt events occur locally.`,
			),
		},
	},
	{
		id: "parent_session",
		view: "session",
		meaning: "The session a sub-agent or forked session came from.",
		agents: {
			claude_code: stored(
				["*.agentId", "*.isSidechain"],
				{ since: 1, record: ["agentId"] },
				{
					testedIn: SPLIT_TEST,
					notes:
						"Sub-agent transcripts are streams of their parent's session. Each sub-agent also has an `agent-*.meta.json` beside its transcript (135 locally: `agentType`, `spawnDepth`, the parent call's `toolUseId`, often `model`, a worktree branch for isolated ones), which the CLI does not upload; the depth is Codex's `depth`.",
				},
			),
			codex: pending(
				[
					"session_meta/.parent_thread_id",
					"session_meta/.forked_from_id",
					"session_meta/.source.subagent.thread_spawn.parent_thread_id",
					"session_meta/.source.subagent.thread_spawn.depth",
					"session_meta/.source.subagent.thread_spawn.agent_path",
					"session_meta/.agent_path",
					"session_meta/.source.subagent.other",
				],
				`${PARSER_9}: keep the parent and fork thread ids and depth of a sub-agent rollout (session lineage links them today, outside transcript records), and drop the tool calls a fork replays from its parent so they are not counted twice (locally 1 of 333 forks replays 137 of its parent's calls, matched by call_id; usage extraction already skips the replayed tokens).`,
			),
		},
	},
	{
		id: "facts_truncated",
		view: "session",
		meaning:
			"A record's longer fact values were dropped because the session's fact budget ran out.",
		runIndex: ["facts_truncated"],
		agents: {
			claude_code: stored([], { since: 6, facts: ["facts_truncated"] }),
			codex: stored([], { since: 6, facts: ["facts_truncated"] }),
		},
	},
	{
		id: "facts_clipped",
		view: "session",
		meaning: "Which of a record's fact values were cut at their length cap.",
		agents: {
			claude_code: stored([], { since: 7, facts: ["facts_clipped"] }),
			codex: stored([], { since: 7, facts: ["facts_clipped"] }),
		},
	},
];

/** Catalog entries by `<view>.<id>`, including `also` names and `alsoIn` views. */
export function factCatalogIndex(): Map<string, FactEntry> {
	const index = new Map<string, FactEntry>();
	for (const entry of FACT_CATALOG)
		for (const view of [entry.view, ...(entry.alsoIn ?? [])])
			for (const id of [entry.id, ...(entry.also ?? [])])
				index.set(`${view}.${id}`, entry);
	return index;
}

/** Every source path the catalog names for an agent, with stored gaps. */
export function catalogSources(agent: FactAgent): string[] {
	return FACT_CATALOG.flatMap((entry) => {
		const fact = entry.agents[agent];
		return [
			...fact.sources,
			...(fact.status === "stored" ? (fact.gap?.sources ?? []) : []),
		];
	});
}
