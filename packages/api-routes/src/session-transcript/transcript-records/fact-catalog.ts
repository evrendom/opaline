import type {
	FactMapping,
	FactSourceMapping,
	MappingEvidence,
} from "./fact-mapping-types.js";
import { mapFactSources } from "./fact-source-mappings.js";
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
 *
 * Unreviewed is the default: no semantic judgement has been made. Judgements
 * and their one-line justifications live on each agent entry, not in tooling.
 * Census/fixture/LLM evidence and tiers are computed only by tooling/tests.
 * Mapping relations point from source to fact: exact; transform (same meaning,
 * named representation change); close (partial/conditional or derived match);
 * broader/narrower (source meaning includes/is included in the definition).
 * Absence is not_found (census only), never not_emitted without writer proof.
 * Confidence is computed: verified requires a judged relation and semantic
 * writer_source, published_types or paired_run AND a positive census or fixture_test witness;
 * observed requires a positive census or fixture_test; otherwise asserted.
 * LLM agreement alone is never verified. Field existence is not meaning proof.
 * Tiers concern mappings, not parser correctness; status/gaps remain separate.
 * Comparability is derived, with explicit semantic conflicts taking priority.
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

interface AgentFactBase extends FactMapping {
	readonly sourceMappings: readonly FactSourceMapping[];
	readonly legacySources?: readonly string[];
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
	readonly gap?: { readonly sources: readonly string[]; readonly plan: string };
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
	options: Omit<
		StoredAgentFact,
		"status" | "sources" | "stores" | "relation" | "evidence" | "sourceMappings"
	> &
		Partial<FactMapping> = {},
): StoredAgentFact {
	return {
		status: "stored",
		stores,
		evidence: [],
		...options,
		...mapFactSources(sources, options, options.gap?.sources),
	};
}

function wrong(
	sources: readonly string[],
	stores: FactStores,
	plan: string,
	options: Omit<
		WrongAgentFact,
		| "status"
		| "sources"
		| "stores"
		| "plan"
		| "relation"
		| "evidence"
		| "sourceMappings"
	> &
		Partial<FactMapping> = {},
): WrongAgentFact {
	return {
		status: "wrong",
		stores,
		plan,
		evidence: [],
		...options,
		...mapFactSources(sources, options, options.gap?.sources),
	};
}

function pending(
	sources: readonly string[],
	plan: string,
	options: Partial<FactMapping> & {
		readonly notes?: string;
		readonly legacySources?: readonly string[];
	} = {},
): PendingAgentFact {
	return {
		status: "pending",
		plan,
		evidence: [],
		...options,
		...mapFactSources(sources, options),
	};
}

function notRecorded(
	what: string,
	options: {
		readonly notes?: string;
		readonly sources?: readonly string[];
	} & Partial<FactMapping> = {},
): NotRecordedAgentFact {
	return {
		status: "not_recorded",
		searched: searched(what),
		evidence: options.evidence ?? [],
		justification: options.justification ?? searched(what),
		...mapFactSources(options.sources ?? [], {
			...options,
			justification: options.justification ?? searched(what),
			relation: options.relation ?? { kind: "not_found" },
		}),
		...(options.notes === undefined ? {} : { notes: options.notes }),
	};
}

const PARSER_9 = "parser 9";
const RUN_INDEX = "run_index, counted from the stored records";
const RUN_INDEX_TEST = "apps/api/src/__tests__/run-index.integration.ts";

const CLAUDE_TOOL_NAME = "assistant.message.content[tool_use:*].name";

function semanticWriter(
	path: string,
	file: string,
	line: number,
	explanation: string,
): MappingEvidence {
	return {
		kind: "writer_source",
		path,
		file: `codex-rs/${file}`,
		line,
		version: "0.162.0",
		supportsMeaning: true,
		explanation,
	};
}

export const FACT_CATALOG: readonly FactEntry[] = [
	// --- calls -----------------------------------------------------------------
	{
		id: "tool_name",
		view: "calls",
		meaning: "The tool the agent called.",
		agents: {
			claude_code: stored(
				[CLAUDE_TOOL_NAME],
				{
					since: 1,
					record: ["toolName"],
				},
				{
					relation: { kind: "exact" },
					justification:
						"Local Claude 2.1.284 tool_use.name = Bash at 49ead9e1:22 identifies the tool whose id is echoed by the result at :23.",
				},
			),
			codex: stored(
				[
					"response_item/function_call:*.name",
					"response_item/custom_tool_call:*.name",
					"event_msg/item_completed:McpToolCall.tool",
					"event_msg/item_completed:DynamicToolCall.tool",
					"event_msg/item_completed:FunctionCallOutput.name",
					"response_item/function_call_output.name",
					"response_item/custom_tool_call_output.name",
					"response_item/web_search_call.action.type",
					"event_msg/item_completed:McpToolCall.server",
					"event_msg/item_completed:DynamicToolCall.namespace",
				],
				{ since: 1, record: ["toolName"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:FunctionCallOutput.name; judge2/sonnet/residue.json",
							explanation:
								"response_item/custom_tool_call_output.name n=72 files=3 (ignored as a repeat)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call_output.name; judge2/sonnet/residue.json",
							explanation:
								"response_item/custom_tool_call_output.name n=72 files=3 (ignored)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/tool_name/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: {
						kind: "transform",
						transform:
							"identity for ordinary names; qualify bare MCP/dynamic tool names with server or namespace",
					},
					notes:
						"A connector tool's name (`_create_pull_request`) does not say which app it belongs to; see tool_namespace. Parser review: readCallToolName emits web_search from the record discriminator, not action.type; completed MCP calls construct mcp__server__tool and dynamic calls retain namespace. Action kinds are context only.",
					justification:
						"Judge round 3: PRIMARY name/tool fields identify the called function. MCP and dynamic bare names require their server/namespace qualifier for the parser canonical tool name; ordinary function/custom/output names pass through. Action.type is CONTEXT, not a competing primary name.",
					gap: {
						sources: [
							"event_msg/item_completed:FunctionCallOutput.name",
							"response_item/function_call_output.name",
							"response_item/custom_tool_call_output.name",
						],
						plan: "parser 9: read these additional literal sources without treating different meanings or units as interchangeable.",
					},
					sourceMappings: [
						{
							path: "response_item/web_search_call.action.type",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "event_msg/item_completed:McpToolCall.server",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Parser reads this qualifier when constructing the canonical tool name; it is not the tool-name value alone.",
						},
						{
							path: "event_msg/item_completed:DynamicToolCall.namespace",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Parser reads this qualifier when constructing the canonical tool name; it is not the tool-name value alone.",
						},
					],
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

				{
					relation: { kind: "exact" },
					justification:
						"Local Claude 2.1.284 49ead9e1:22–23 repeats tool_use.id as tool_result.tool_use_id, directly joining request and result.",
				},
			),
			codex: stored(
				[
					"response_item/function_call:*.call_id",
					"response_item/custom_tool_call:*.call_id",
					"response_item/function_call_output.call_id",
					"response_item/custom_tool_call_output.call_id",
					"event_msg/item_completed:CommandExecution.id",
					"event_msg/item_completed:McpToolCall.id",
					"event_msg/item_completed:DynamicToolCall.id",
					"event_msg/item_completed:FileChange.id",
					"event_msg/item_completed:WebSearch.id",
					"event_msg/item_completed:Extension.id",
					"event_msg/exec_command_end.call_id",
					"event_msg/patch_apply_end.call_id",
					"event_msg/image_generation_end.call_id",
					"event_msg/mcp_tool_call_end.call_id",
					"response_item/local_shell_call.call_id",
					"security_risk_score/.call_id",
					"retained_context/verified_answer.call_id",
					"response_item/tool_search_call.call_id",
					"response_item/tool_search_output.call_id",
					"event_msg/item_completed:CollabAgentToolCall.id",
					"event_msg/web_search_end.call_id",
				],
				{ since: 1, record: ["callId"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#retained_context/verified_answer.call_id; judge2/sonnet/residue.json",
							explanation:
								"retained_context/verified_answer.call_id: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/call_id/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/call_id/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					legacySources: ["event_msg/exec_command_end.call_id"],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Explicit call_id fields pair lifecycle requests and outputs. Completed native/extension item IDs can instead identify nested operations without a matching top-level function request. They remain useful operation joins, but the entire primary set is not unconditionally the same outer call/result identifier.",
					gap: {
						sources: [
							"event_msg/image_generation_end.call_id",
							"event_msg/mcp_tool_call_end.call_id",
							"response_item/local_shell_call.call_id",
							"security_risk_score/.call_id",
							"retained_context/verified_answer.call_id",
							"event_msg/item_completed:CollabAgentToolCall.id",
							"event_msg/web_search_end.call_id",
						],
						plan: "parser 9: read these additional literal sources without treating different meanings or units as interchangeable.",
					},
					notes:
						"Residue path event_msg/image_generation_end.call_id is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/mcp_tool_call_end.call_id is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path response_item/local_shell_call.call_id is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path security_risk_score/.call_id is recorded but unparsed; no local witness and no semantic verification is claimed.",
				},
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
					"user.toolUseResult.query",
				],
				{ since: 1, record: ["text"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/input_text/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Local Claude 2.1.284 49ead9e1:22 records Bash input.command inside an input object; other tool inputs require JSON serialization.",
					sourceMappings: [
						{
							path: "assistant.message.content[tool_use:Bash].input.command",
							role: "primary",
							relation: {
								kind: "transform",
								transform:
									"Bash input.command preserved; other input objects → JSON text",
							},
							justification:
								"Local Claude 2.1.284 49ead9e1:22 records Bash input.command inside an input object; other tool inputs require JSON serialization.",
						},
						{
							path: "assistant.message.content[tool_use:*].input",
							role: "primary",
							relation: {
								kind: "transform",
								transform:
									"Bash input.command preserved; other input objects → JSON text",
							},
							justification:
								"Local Claude 2.1.284 49ead9e1:22 records Bash input.command inside an input object; other tool inputs require JSON serialization.",
						},
					],
					gap: {
						sources: ["user.toolUseResult.query"],
						plan: "parser 9: preserve newly mapped literal fields with call/record provenance and distinct component names/units; never infer values from prose.",
					},
				},
			),
			codex: stored(
				[
					"response_item/function_call:exec_command.arguments.cmd",
					"response_item/function_call:*.arguments",
					"response_item/custom_tool_call:*.input",
					"event_msg/item_completed:CommandExecution.command[]",
					"response_item/local_shell_call.action.command[]",
					"event_msg/item_completed:CommandExecution.interaction_input",
					"event_msg/mcp_tool_call_end.invocation.arguments",
					"response_item/function_call:spawn_agent.arguments.items",
					"response_item/function_call:exec_command.arguments.chars",
				],
				{ since: 1, record: ["text"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/input_text/codex",
							explanation:
								"The fact (what the agent asked the tool to do) is what each source carries; only the representation differs. exec_command.arguments.cmd (274,955) is the command inside a JSON argument string; other function_call arguments (2,609 across 14 tool paths) are the JSON text itself; custom_tool_call.input (188,268) is freeform text, not JSON; CommandExecution.command[] (210,499) is an argv array that the parser unwraps (bash/sh/zsh -c/-lc) or shell-quotes into one command string. The gap source local_shell_call.action.command[] has no local record (writer: models.rs:1946 Vec<String>).",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CommandExecution.interaction_input; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:write_stdin.arguments.chars n=42138",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/mcp_tool_call_end.invocation.arguments; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:McpToolCall.arguments n=30283 (stored as call text)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:spawn_agent.arguments.items; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:spawn_agent.arguments.message n=555; .items n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/input_text/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/input_text/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					notes:
						"Parser review: describeCall preserves custom freeform input, selects exec_command cmd, and argvToCommand unwraps bash/sh/zsh -c/-lc; other argv is shell-quoted. This is decoded request text, not uniformly JSON. Freeform scripts and patches are text, not JSON. Freeform scripts and patches are text, not JSON. Residue path response_item/local_shell_call.action.command[] is recorded but unparsed; no local witness and no semantic verification is claimed. Round-3 wording caveat: shell, shell_command, container.exec and local_shell also keep only the rendered command (codex-records.ts:54-59,552-565), not whole argument JSON. Parser 9 must preserve allowlisted non-command options for these variants if observed; none of the 1,218 reviewed ignored paths uses those aliases.",
					justification:
						"Judge round 3: Function/custom inputs are complete requests, and ordered command argv can be rendered as command text. interaction_input is stdin, and spawn_agent.arguments.items is only one component of a structured spawn request; a source leaf command[] is not itself the whole command.",
					gap: {
						sources: [
							"response_item/local_shell_call.action.command[]",
							"event_msg/item_completed:CommandExecution.interaction_input",
							"event_msg/mcp_tool_call_end.invocation.arguments",
							"response_item/function_call:spawn_agent.arguments.items",
							"response_item/function_call:exec_command.arguments.chars",
						],
						plan: "parser 9: read these additional literal sources without treating different meanings or units as interchangeable.",
					},
				},
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
				"find over calls (order of work step 10) derives it from the stored command text; no parser change Review constraint: Requested scripts can contain wrappers, pipelines and multiple programs; command_argv0 is not literally the program that ran.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Requested scripts can contain wrappers, pipelines and multiple programs; command_argv0 is not literally the program that ran.",
					justification:
						"Bash.input.command is the whole command string; the program and first words need shell parsing (pipes, && chains, env prefixes), so the fact is derived from the literal text, not written by the agent. Witness: 49ead9e1:22 assistant.message.content[tool_use:Bash].input.command [string] n=24856 v2.1.220..2.1.293",
				},
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.cmd",
					"event_msg/item_completed:CommandExecution.parsed_cmd[].cmd",
				],
				"find over calls (order of work step 10) derives it from the stored command text; no parser change Review constraint: Do not read argv0 from CommandExecution.command[]: element 0 is the shell wrapper. parsed_cmd[].cmd is one pipeline segment's text.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Do not read argv0 from CommandExecution.command[]: element 0 is the shell wrapper. parsed_cmd[].cmd is one pipeline segment's text.",
					justification:
						"The program is derived by parsing exec_command.arguments.cmd or the per-segment parsed_cmd[].cmd; command[0] cannot be used because it is the shell wrapper, so no field literally names the program. Witness: 019cb44a:14 response_item/function_call:exec_command.arguments.cmd [string] n=274778 v0.100.0..0.157.1",
				},
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
				"find over calls (order of work step 10) derives it from the stored command text; no parser change Review constraint: The normalization algorithm and equivalence policy are unspecified, and this is a derived analysis value, not a literal transcript fact.",
				{
					evidence: [],
					relation: { kind: "derived", from: ["calls/input_text"] },
					notes:
						"Parser review: No parser value is stored for this pending proposal. The normalization algorithm and equivalence policy are unspecified, and this is a derived analysis value, not a literal transcript fact.",
					sourceMappings: [
						{
							path: "assistant.message.content[tool_use:Bash].input.command",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Opaline computation, not an agent-written value. A fingerprint is a normalised form Opaline would compute from the recorded command text; the agent writes no fingerprint, only the literal command. Witness: 49ead9e1:22 assistant.message.content[tool_use:Bash].input.command [string] n=24856 v2.1.220..2.1.293",
				},
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.cmd",
					"response_item/custom_tool_call:exec.input",
				],
				"find over calls (order of work step 10) derives it from the stored command text; no parser change Review constraint: The fingerprint is derived and its normalization policy is unspecified.",
				{
					evidence: [],
					relation: { kind: "derived", from: ["calls/input_text"] },
					notes:
						"Parser review: No parser value is stored for this pending proposal. The fingerprint is derived and its normalization policy is unspecified.",
					sourceMappings: [
						{
							path: "response_item/function_call:exec_command.arguments.cmd",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "response_item/custom_tool_call:exec.input",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Opaline computation, not an agent-written value. A fingerprint is a normalised form Opaline would compute from the command string or code-mode script; the agent writes only the literal text. Witness: 019cb44a:14 response_item/function_call:exec_command.arguments.cmd [string] n=274778 v0.100.0..0.157.1",
				},
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
					relation: { kind: "close" },
					justification:
						"Local Claude 2.1.284 49ead9e1:52 records No matches found as returnCodeInterpretation; missing is_error is not a literal false.",
					conflict:
						"Codex nonzero exit status and Claude explicit is_error / return-code interpretation are different failure predicates; do not aggregate them as one boolean.",

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
					"event_msg/mcp_tool_call_end.result.isError",
					"event_msg/item_completed:DynamicToolCall.success",
				],
				{ since: 1, record: ["isError"] },
				"parser 9: In readOutput, treat the anchored transport envelopes (<tool> failed, failed to parse function arguments, unable to locate image at, and the Rejected/Sandbox(Denied) refusals) as isError=true, the way Claude marks denied results is_error. Evidence: Running the real parser (readCodexLine) over 3,059,068 Codex records / 644,017 tool results: 842 transport-failure results are stored isError=false with exit_code null: 645 '<tool> failed' (first: rollout-2026-02-25T15-10-33-019c9523:695), 98 Rejected refusals (019c70a2:974), 11 Sandbox(Denied) (019c9b87:451), 50 'failed to parse function arguments' (019d7677:4772), 38 'unable to locate image at' (019cd89a:915). Only 36,125 results are isError=true. A further 4,332 late-completion nonzero exits are also stored as not failed (see exit_code).",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/is_error/codex",
							explanation:
								"Running the real parser (readCodexLine) over 3,059,068 Codex records / 644,017 tool results: 842 transport-failure results are stored isError=false with exit_code null: 645 '<tool> failed' (first: rollout-2026-02-25T15-10-33-019c9523:695), 98 Rejected refusals (019c70a2:974), 11 Sandbox(Denied) (019c9b87:451), 50 'failed to parse function arguments' (019d7677:4772), 38 'unable to locate image at' (019cd89a:915). Only 36,125 results are isError=true. A further 4,332 late-completion nonzero exits are also stored as not failed (see exit_code).",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/is_error/codex",
							explanation:
								"No source is a literal 'failed' boolean: CommandExecution.exit_code (210,499) and .status (completed 193,268 = exit 0, failed 17,272 = nonzero, no nulls) agree, McpToolCall.result.isError / error / status agree (failed 3,051), FileChange.status failed 31, DynamicToolCall success=false 6, and exit/failed are otherwise read from output text conventions (Process exited with code N 273,019, '<tool> failed' 634). So 'failed' is derived per tool from codes/status/text, and the Codex writer never marks transport refusals (exec_command failed ... Rejected/Sandbox(Denied), failed to parse function arguments, unable to locate image) as failures. Not comparable to Claude, where is_error is one literal flag.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/is_error/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					legacySources: ["event_msg/exec_command_end.exit_code"],
					relation: { kind: "close" },
					justification:
						"No source is a literal 'failed' boolean: CommandExecution.exit_code (210,499) and .status (completed 193,268 = exit 0, failed 17,272 = nonzero, no nulls) agree, McpToolCall.result.isError / error / status agree (failed 3,051), FileChange.status failed 31, DynamicToolCall success=false 6, and exit/failed are otherwise read from output text conventions (Process exited with code N 273,019, '<tool> failed' 634). So 'failed' is derived per tool from codes/status/text, and the Codex writer never marks transport refusals (exec_command failed ... Rejected/Sandbox(Denied), failed to parse function arguments, unable to locate image) as failures. Not comparable to Claude, where is_error is one literal flag.",
					conflict:
						"Codex nonzero exit status and Claude explicit is_error / return-code interpretation are different failure predicates; do not aggregate them as one boolean.",
					notes:
						"Not comparable across agents: Codex marks every nonzero exit a failure (grep or diff finding nothing included); Claude Code marks a nonzero exit not failed only when it gives a return_code_interpretation (170 results locally: 168 `No matches found`, 2 `Files differ`), and every other one failed (`Exit code N`). Residue path event_msg/mcp_tool_call_end.result.isError is recorded but unparsed; no local witness and no semantic verification is claimed.",
					gap: {
						sources: ["event_msg/item_completed:DynamicToolCall.success"],
						plan: "parser 9: preserve newly mapped literal fields with call/record provenance and distinct component names/units; never infer values from prose.",
					},
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
					evidence: [],
					relation: {
						kind: "transform",
						transform:
							"Parse the signed integer following the initial Exit code marker.",
					},
					testedIn:
						"packages/api-routes/src/session-transcript/transcript-records/split-transcript.test.ts",
					notes:
						"Claude Code writes an exit code only into the text of a failed result (`Exit code 1`); successful calls have none. Parser review: readToolResult calls readClaudeExitCode only for is_error=true result text containing the Exit code convention; success without that convention has no exit code.",
					justification:
						"A failed Bash result's content starts with 'Exit code N' (is_error true) and the literal exit code is the integer N; successful calls write no exit code at all. Witness: 49ead9e1:92 user.message.content[tool_result].content~Exit code [string] n=423 v2.1.220..2.1.293",
				},
			),
			codex: stored(
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
				{
					since: 1,
					record: ["exitCode"],
				},
				{
					legacySources: [
						"event_msg/exec_command_end.exit_code",
						"response_item/custom_tool_call_output.output.metadata.exit_code",
						"response_item/function_call_output.output.metadata.exit_code",
					],
					relation: {
						kind: "transform",
						transform:
							"typed integer / legacy metadata preserved; explicit exit-code text header → integer",
					},
					justification:
						"items.rs:277 and core/src/tools/events.rs:584 preserve the process exit code; tools/context.rs:535 prints the same code in the output header.",
					gap: {
						sources: ["event_msg/item_completed:CommandExecution.exit_code"],
						plan: "parser 9: read item.exit_code onto the call's result even when its completion follows the output (19,586 late completions, 4,332 nonzero); 125,561 stored exit codes match with zero mismatches.",
					},
					evidence: [
						{
							kind: "writer_source",
							path: "event_msg/item_completed:CommandExecution.exit_code",
							file: "codex-rs/protocol/src/items.rs",
							line: 277,
							version: "0.162.0",
							supportsMeaning: true,
							explanation:
								"The completed command exit_code is copied from exec_result.exit_code at core/src/tools/events.rs:584; tools/context.rs:535 writes that code into the explicit exit header.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/exit_code/codex",
							explanation:
								"Every exit code that IS stored is right: 125,561 completions compared with the stored output/lent exit code, 0 mismatches (8,020 output-had-exit agree, 117,541 lent-before-output agree). The gap is absence: 19,586 CommandExecution completions arrive after an output stored as 'running' with exit_code null (first rollout-2026-03-21T20-47-10-019d11ef:160), 4,332 of them nonzero (:192); the mirror row keeps neither. Null is unknown here, not a wrong value.",
						},
					],
				},
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
					evidence: [],
					relation: { kind: "exact" },
					notes:
						"`permission-rule` also covers calls a hook denied; permission_decision's `source` tells them apart. Parser review: claudeToolResultFacts copies toolDenialKind verbatim, including cancelled/interrupted; a literal denial category is not proof of a permission refusal.",
					justification:
						"toolDenialKind is written on the denied tool_result record itself and names the refusal category in the agent's own words (permission-rule 148, cancelled 5, user-rejected 3, interrupted 1 on Bash/ExitPlanMode/WebFetch results). Witness: 49ead9e1:1030 user.toolDenialKind [string] n=158 v2.1.220..2.1.293",
				},
			),
			codex: stored(
				[
					"response_item/function_call_output.output~Sandbox(Denied)",
					"response_item/function_call_output.output~Rejected",
					"response_item/custom_tool_call_output.output[input_text].text~Rejected",
				],
				{
					since: 8,
					facts: ["denialKind"],
				},
				{
					relation: {
						kind: "transform",
						transform:
							"Match the anchored '<tool> failed ...: CreateProcess { message: \"...' Debug envelope in the output text and keep the variant name (Sandbox(Denied) or Rejected)",
					},
					notes:
						"Codex writes no denial field; the refusal is the call's output (`exec_command failed …: CreateProcess { message: \"Rejected(…` or `Codex(Sandbox(Denied …`). Parser review: codexDenialKind matches only the anchored failed-call CreateProcess envelope and Sandbox(Denied)/Rejected variant; Rejected does not identify the decision-maker.",
					justification:
						"Codex writes no denial field. The refusal is the call's output text: UnifiedExecError::CreateProcess{message} wraps a ToolError (Rejected(String) | Codex(CodexErr)), so the output reads 'exec_command failed ...: CreateProcess { message: \"Codex(Sandbox(Denied ...' or '...Rejected(...'. codexDenialKind anchors on that envelope and returns the variant name, which is the agent's own category name. Counts: Rejected 95 (+4 custom_tool_call_output) and Sandbox(Denied) 11. Rejected does not separate user rejection from policy rule; that detail is in the reason text (denial_reason).",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/denial_kind/codex",
							explanation:
								"Codex writes no denial field. The refusal is the call's output text: UnifiedExecError::CreateProcess{message} wraps a ToolError (Rejected(String) | Codex(CodexErr)), so the output reads 'exec_command failed ...: CreateProcess { message: \"Codex(Sandbox(Denied ...' or '...Rejected(...'. codexDenialKind anchors on that envelope and returns the variant name, which is the agent's own category name. Counts: Rejected 95 (+4 custom_tool_call_output) and Sandbox(Denied) 11. Rejected does not separate user rejection from policy rule; that detail is in the reason text (denial_reason).",
						},
					],
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
				"parser 9: keep the string `toolUseResult` of a refused or blocked result (worktree isolation, `Blocked: sleep`), and the phase, tool and message of a `PreToolUse:<tool> hook error` result. Review constraint: Path user.toolUseResult (string form) matches every errored tool result, not only refusals; it needs a filter on toolDenialKind or the hook-error convention.",
				{
					relation: {
						kind: "broader",
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. Path user.toolUseResult (string form) matches every errored tool result, not only refusals; it needs a filter on toolDenialKind or the hook-error convention.",
					justification:
						"user.toolUseResult in string form is every errored/denied tool result, not only refusals: 1,340 string-form results, 884 with is_error, 160 with a toolDenialKind and 150 starting with a 'hook error' prefix (convention ~hook error 149). The refusal reason is a subset of that field, so it needs a filter on toolDenialKind or the PreToolUse hook-error convention. The hook-error convention itself is a narrower exact source for blocked-by-hook.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/denial_reason/claude_code",
							explanation:
								"user.toolUseResult in string form is every errored/denied tool result, not only refusals: 1,340 string-form results, 884 with is_error, 160 with a toolDenialKind and 150 starting with a 'hook error' prefix (convention ~hook error 149). The refusal reason is a subset of that field, so it needs a filter on toolDenialKind or the PreToolUse hook-error convention. The hook-error convention itself is a narrower exact source for blocked-by-hook.",
						},
					],
				},
			),
			codex: wrong(
				[
					"response_item/function_call_output.output~Rejected",
					"response_item/custom_tool_call_output.output[input_text].text~Rejected",
				],
				{
					since: 8,
					facts: ["denial_reason"],
				},
				"parser 9: Store the reason with clippedText(extra, 'denial_reason', reason) so a cut value is marked in facts_clipped (or raise the cap for this key). Evidence: 97 Rejected refusals carry a reason; 7 decoded reasons exceed 512 code points (codexDenialReason + code-point count) and all 7 are stored cut with no facts_clipped marker (first rollout-2026-03-29T08-16-52-019d383c:1277). The cut can drop the policy explanation that follows the command.",
				{
					relation: {
						kind: "transform",
						transform:
							"Recognize the Rejected envelope and preserve its reason text.",
					},
					notes:
						"Parser review: parser 9: a reason over 512 characters is cut without `facts_clipped`, and the cut can drop the policy explanation that follows the command (7 refusals locally); cap it with the clipping-aware setter so the cut is marked. Data witness: 7 decoded refusal reasons exceeded 512 characters in the prior catalog census; fresh decoder count is recorded below when available. Data witness: 7 decoded refusal reasons exceed 512 Unicode code points in a fresh read-only scan using codexDenialReason; first witness 019ea151…:10.",
					justification:
						"The refusal reason is the text inside the failed output's `Rejected(...)` wrapper, which must be extracted from the 'exec_command failed ...' message. Witness: 019cb960:2007 response_item/function_call_output.output~Rejected [string] n=95 v0.100.0..0.157.1",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/denial_reason/codex",
							explanation:
								"97 Rejected refusals carry a reason; 7 decoded reasons exceed 512 code points (codexDenialReason + code-point count) and all 7 are stored cut with no facts_clipped marker (first rollout-2026-03-29T08-16-52-019d383c:1277). The cut can drop the policy explanation that follows the command.",
						},
					],
				},
			),
		},
	},
	{
		id: "return_code_interpretation",
		view: "calls",
		meaning:
			"The agent's own reading of a nonzero exit code (for example `No matches found`).",
		agents: {
			claude_code: stored(
				["user.toolUseResult.returnCodeInterpretation"],
				{
					since: 6,
					facts: ["return_code_interpretation"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"Local Claude 2.1.284 49ead9e1:52 writes returnCodeInterpretation = No matches found, the agent’s own nonzero-exit interpretation.",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.returnCodeInterpretation",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3303 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Semantic interpretation for non-error exit codes with special meaning",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no field or output convention interprets an exit code (searched CommandExecution, exec_command_end and every call output prefix).",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no field or output convention interprets an exit code (searched CommandExecution, exec_command_end and every call output prefix).",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"codex-absence-0.162.0.json#calls/return_code_interpretation",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The agent's own reading of a nonzero exit code (for example `No matches found`). Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no field or output convention interprets an exit code (searched CommandExecution, exec_command_end and every call output prefix). Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
					relation: {
						kind: "transform",
						transform: "durationMs preserved; durationSeconds × 1000 → ms",
					},
					justification:
						"Local a1f1ca64:278 (2.1.220) writes durationMs = 5068; 4ecc4daf:245 (2.1.284) writes durationSeconds = 5.89137666700012.",

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
					evidence: [
						{
							kind: "writer_source",
							path: "event_msg/item_completed:CommandExecution.duration.*",
							file: "codex-rs/protocol/src/items.rs",
							line: 280,
							version: "0.162.0",
							supportsMeaning: true,
							explanation:
								"Duration is a std::time::Duration; core/src/tools/events.rs:585 copies the measured execution duration into the persisted item. Its secs/nanos representation converts to milliseconds.",
						},
					],
					legacySources: ["event_msg/exec_command_end.duration.*"],
					relation: {
						kind: "transform",
						transform: "secs × 1000 + nanos / 1000000 → ms",
					},
					justification:
						"Duration fields use Rust secs/nanos; the catalog also includes legacy completed-item durations, not just currently emitted exec events.",
					gap: {
						sources: [
							"event_msg/item_completed:DynamicToolCall.duration.*",
							"event_msg/mcp_tool_call_end.duration.nanos",
							"event_msg/mcp_tool_call_end.duration.secs",
						],
						plan: "parser 9: the dynamic tool handler keeps its recorded duration.",
					},
					notes:
						"Versions without CommandExecution items (0.100, 0.105, 0.108–0.118 and 0.130–0.145 locally) record no command duration; see wall_time_ms. Residue path event_msg/mcp_tool_call_end.duration.nanos is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/mcp_tool_call_end.duration.secs is recorded but unparsed; no local witness and no semantic verification is claimed.",
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
					legacySources: [
						"response_item/custom_tool_call_output.output.metadata.duration_seconds",
						"response_item/function_call_output.output.metadata.duration_seconds",
					],
					relation: {
						kind: "transform",
						transform:
							"Wall time seconds / legacy duration_seconds \u00d7 1000 \u2192 wait ms",
					},
					justification:
						"tools/context.rs:531–532 formats wall_time.as_secs_f64(); unified_exec/process_manager.rs:1027 measures this write_stdin request’s wait, not total command lifetime.",
					evidence: [
						semanticWriter(
							"response_item/function_call_output.output~Wall time",
							"core/src/tools/context.rs",
							532,
							"The writer prints elapsed wall_time in seconds; unified_exec/process_manager.rs:1027 measures the current poll request, so seconds × 1000 is wait time in ms.",
						),
					],

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
				"parser 9: keep the completion's recorded start and end on its row. Review constraint: Item-level timing is not call-level: it also times AgentMessage/Reasoning/UserMessage items, and started_at_ms exists only from 0.144.1.",
				{
					relation: {
						kind: "broader",
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. Item-level timing is not call-level: it also times AgentMessage/Reasoning/UserMessage items, and started_at_ms exists only from 0.144.1.",
					justification:
						"item_completed.started_at_ms / completed_at_ms time every completed turn item, not only calls: completed_at_ms is on all 619,094 items (AgentMessage 161,885, Reasoning 103,552, UserMessage 31,654 ...), started_at_ms on 233,403 and for calls only partly (CommandExecution 70,509 of 210,540, McpToolCall 17,473 of 30,283, FileChange 7,526 of 54,983, ImageView 1,822 of 1,822). For call items the values are the writer's own start and finish in epoch ms; where no start was tracked the finish stands alone. The source meaning includes the fact.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/call_started_at/codex",
							explanation:
								"item_completed.started_at_ms / completed_at_ms time every completed turn item, not only calls: completed_at_ms is on all 619,094 items (AgentMessage 161,885, Reasoning 103,552, UserMessage 31,654 ...), started_at_ms on 233,403 and for calls only partly (CommandExecution 70,509 of 210,540, McpToolCall 17,473 of 30,283, FileChange 7,526 of 54,983, ImageView 1,822 of 1,822). For call items the values are the writer's own start and finish in epoch ms; where no start was tracked the finish stands alone. The source meaning includes the fact.",
						},
					],
				},
			),
		},
	},
	{
		id: "timed_out_after_ms",
		view: "calls",
		meaning: "The limit after which a call was stopped for running too long.",
		runIndex: ["timed_out_calls"],
		agents: {
			claude_code: stored(
				["user.toolUseResult.timedOutAfterMs"],
				{
					since: 6,
					facts: ["timedOutAfterMs"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"timedOutAfterMs appears only on Bash results (36) and holds the timeout in ms that stopped the call (120000 is Claude's default Bash timeout). Witness: 46e611b4:569 user.toolUseResult.timedOutAfterMs [number] n=36 v2.1.284..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.timedOutAfterMs",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3287 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Set when the command hit its timeout and was auto-backgrounded; the timeout value in ms",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no timed-out marker in any call's framing or completion; the 186 outputs that say `timed out` say it inside the command's own output, or are MCP startup failures (`… MCP startup failed: timed out handshaking …`, 4); a wait tool's `timed_out` result is not a command timeout.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no timed-out marker in any call's framing or completion; the 186 outputs that say `timed out` say it inside the command's own output, or are MCP startup failures (`… MCP startup failed: timed out handshaking …`, 4); a wait tool's `timed_out` result is not a command timeout.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/timed_out_after_ms",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The limit after which a call was stopped for running too long. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no timed-out marker in any call's framing or completion; the 186 outputs that say `timed out` say it inside the command's own output, or are MCP startup failures (`… MCP startup failed: timed out handshaking …`, 4); a wait tool's `timed_out` result is not a command timeout. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
		},
	},
	{
		id: "timeout_ms",
		view: "calls",
		meaning: "The time limit set for a call.",
		agents: {
			claude_code: stored(
				[
					"user.toolUseResult.timeoutMs",
					"assistant.message.content[tool_use:Monitor].input.timeout_ms",
				],
				{ since: 6, facts: ["timeout_ms"] },
				{
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.timeoutMs",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:4072 (MonitorOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Timeout deadline in milliseconds (0 when persistent).",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Bash].input.timeout",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:809 (BashInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Optional timeout in milliseconds (max 600000 for a foreground command)",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Monitor].input.timeout_ms",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:2958 (MonitorInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Kill the monitor after this deadline. Default 300000ms. Deadlines above 1800000ms are capped to 1800000ms. You are notified at expiry and can re-arm.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/timeout_ms/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					gap: {
						sources: [
							"assistant.message.content[tool_use:Bash].input.timeout",
							"assistant.message.content[tool_use:Monitor].input.timeout_ms",
						],
						plan: "parser 9: read Bash input.timeout as a millisecond call limit; Monitor input.timeout_ms remains an unparsed structured counterpart (also present in stored JSON).",
					},
					notes:
						"Bash stores only input.command, so input.timeout is a parser gap, not stored timeout_ms. Monitor result timeoutMs is stored; its input timeout_ms is only present in the input JSON.",
					justification:
						"Judge round 3: Bash.timeout and Monitor.timeout_ms are configured limits in milliseconds. MonitorOutput.timeoutMs records that configured deadline/limit, with 0 explicitly meaning persistent. No seconds-to-ms transformation is required for these PRIMARY sources.",
					sourceMappings: [
						{
							path: "assistant.message.content[tool_use:Bash].input.timeout",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"Judge round 3: Bash.timeout and Monitor.timeout_ms are configured limits in milliseconds. MonitorOutput.timeoutMs records that configured deadline/limit, with 0 explicitly meaning persistent. No seconds-to-ms transformation is required for these PRIMARY sources.",
						},
					],
				},
			),
			codex: stored(
				["response_item/function_call:exec_command.arguments.timeout_ms"],
				{ since: 8, facts: ["timeout_ms"] },
				{
					evidence: [],
					notes:
						"The requested limit, from the call's arguments. Residue path response_item/local_shell_call.action.timeout_ms is recorded but unparsed; no local witness and no semantic verification is claimed.",
					relation: { kind: "exact" },
					justification:
						"ExecCommandArgs.timeout_ms is the optional limit the model sets on the call; it is the requested limit, as the note says, and appears only in 0.107 locally. Witness: 019d785d:454 response_item/function_call:exec_command.arguments.timeout_ms [number] n=66 v0.107.0..0.107.0",
					gap: {
						sources: ["response_item/local_shell_call.action.timeout_ms"],
						plan: "parser 9: read the agreed writer-residue fields separately with their recorded provenance; do not coalesce context with values.",
					},
				},
			),
		},
	},
	{
		id: "is_async",
		view: "calls",
		meaning:
			"Whether the call was still running in the background when its result was recorded.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.isAsync"],
				{
					since: 6,
					facts: ["is_async"],
				},
				{
					relation: {
						kind: "narrower",
					},
					notes:
						"Parser review: claudeToolResultFacts reads the Agent launch isAsync flag; it is not Bash backgroundTaskId and does not prove the process remained running.",
					justification:
						"Judge ruling. toolUseResult.isAsync is written only on Agent results, always true (138, status async_launched); background Bash is signalled by backgroundTaskId instead, so it covers only background sub-agent launches. Witness: 49ead9e1:452 user.toolUseResult.isAsync [boolean] n=138 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.isAsync",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:153 (AgentOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "AgentOutput explicitly declares isAsync as true.",
						},
					],
				},
			),
			codex: stored(
				[
					"response_item/function_call_output.output~Process running with session ID",
					"response_item/custom_tool_call_output.output~Script running with cell ID",
					"response_item/function_call_output.output~Script running with cell ID",
					"response_item/custom_tool_call_output.output[input_text].text~Script running with cell ID",
				],
				{ since: 5, record: ["subtype"] },
				{
					evidence: [],
					notes: "As the result subtype `running`.",
					relation: {
						kind: "transform",
						transform:
							"Recognize the running-process/session or running-script/cell convention as is_async=true.",
					},
					justification:
						"A running exec_command/write_stdin output carries 'Process running with session ID N' (and code-mode 'Script running with cell ID N') only while the process is still running, so the text maps to is_async=true. Witness: 019cb44a:1150 response_item/function_call_output.output~Process running with session ID [string] n=46695 v0.100.0..0.157.1",
				},
			),
		},
	},
	{
		id: "background_task_id",
		view: "calls",
		meaning:
			"The id of the background task or process a call started or polls.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.backgroundTaskId"],
				{
					since: 6,
					facts: ["background_task_id"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"backgroundTaskId on Bash results is the ID of the background task, per the Bash output schema 'ID of the background task if command is running in background'. Witness: 49ead9e1:228 user.toolUseResult.backgroundTaskId [string] n=495 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.backgroundTaskId",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3279 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"ID of the background task if command is running in background",
						},
					],
				},
			),
			codex: pending(
				[
					"response_item/function_call_output.output~Process running with session ID",
					"response_item/custom_tool_call_output.output~Script running with cell ID",
					"response_item/function_call:write_stdin.arguments.session_id",
					"response_item/function_call:wait.arguments.cell_id",
					"event_msg/exec_command_end.process_id",
					"event_msg/item_completed:CommandExecution.process_id",
					"response_item/function_call_output.output[input_text].text~Script running with cell ID",
					"response_item/function_call:exec_command.arguments.session_id",
				],
				"parser 9: retain background_task_id as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/background_task_id/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					legacySources: ["response_item/function_call:wait.arguments.cell_id"],
					relation: { kind: "close" },
					justification:
						"The started process is named only in output text ('Process running with session ID N' / 'Script running with cell ID N'); a poll names it as write_stdin.session_id (number) or wait.cell_id. Witness: 019cb44a:1150 response_item/function_call_output.output~Process running with session ID [string] n=46695 v0.100.0..0.157.1",
					sourceMappings: [
						{
							path: "response_item/function_call_output.output~Process running with session ID",
							role: "primary",
							relation: {
								kind: "transform",
								transform:
									"Parse the ID in the running marker or preserve session_id/cell_id in a poll request.",
							},
							justification:
								"The started process is named only in output text ('Process running with session ID N' / 'Script running with cell ID N'); a poll names it as write_stdin.session_id (number) or wait.cell_id. Witness: 019cb44a:1150 response_item/function_call_output.output~Process running with session ID [string] n=46695 v0.100.0..0.157.1",
						},
						{
							path: "response_item/custom_tool_call_output.output~Script running with cell ID",
							role: "primary",
							relation: {
								kind: "transform",
								transform:
									"Parse the ID in the running marker or preserve session_id/cell_id in a poll request.",
							},
							justification:
								"The started process is named only in output text ('Process running with session ID N' / 'Script running with cell ID N'); a poll names it as write_stdin.session_id (number) or wait.cell_id. Witness: 019cb44a:1150 response_item/function_call_output.output~Process running with session ID [string] n=46695 v0.100.0..0.157.1",
						},
						{
							path: "response_item/function_call:write_stdin.arguments.session_id",
							role: "primary",
							relation: {
								kind: "transform",
								transform:
									"Parse the ID in the running marker or preserve session_id/cell_id in a poll request.",
							},
							justification:
								"The started process is named only in output text ('Process running with session ID N' / 'Script running with cell ID N'); a poll names it as write_stdin.session_id (number) or wait.cell_id. Witness: 019cb44a:1150 response_item/function_call_output.output~Process running with session ID [string] n=46695 v0.100.0..0.157.1",
						},
						{
							path: "response_item/function_call:wait.arguments.cell_id",
							role: "primary",
							relation: {
								kind: "transform",
								transform:
									"Parse the ID in the running marker or preserve session_id/cell_id in a poll request.",
							},
							justification:
								"The started process is named only in output text ('Process running with session ID N' / 'Script running with cell ID N'); a poll names it as write_stdin.session_id (number) or wait.cell_id. Witness: 019cb44a:1150 response_item/function_call_output.output~Process running with session ID [string] n=46695 v0.100.0..0.157.1",
						},
					],
				},
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
				"parser 9: keep the requested background flag, apart from is_async (what happened).",
				{
					relation: {
						kind: "exact",
					},
					justification:
						"input.run_in_background is the model's own request flag on Bash and Agent calls (547 and 102), a requested rather than actual state. Witness: 49ead9e1:227 assistant.message.content[tool_use:Bash].input.run_in_background [boolean] n=547 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Bash].input.run_in_background",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:829 (BashInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Set to true to run this command in the background. With it, `timeout` limits how long the command may run in the background before it is stopped (default 1800000 ms, max 7200000 ms).",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Agent].input.run_in_background",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:783 (AgentInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Agents run in the background by default; you will be notified when one completes. Set to false only when your very next action depends on this agent's result and nothing else could usefully happen while it runs — otherwise leave it in the background so the user can hand you other work.",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): exec_command arguments have no background flag (cmd, workdir, timeout_ms, yield_time_ms, max_output_tokens, tty, login, shell, sandbox_permissions, justification, prefix_rule); any command may keep running past its `yield_time_ms`.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): exec_command arguments have no background flag (cmd, workdir, timeout_ms, yield_time_ms, max_output_tokens, tty, login, shell, sandbox_permissions, justification, prefix_rule); any command may keep running past its `yield_time_ms`.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/run_in_background",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The agent asked for the call to run in the background. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): exec_command arguments have no background flag (cmd, workdir, timeout_ms, yield_time_ms, max_output_tokens, tty, login, shell, sandbox_permissions, justification, prefix_rule); any command may keep running past its `yield_time_ms`. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
		},
	},
	{
		id: "interrupted",
		view: "calls",
		meaning: "The user stopped the call while it ran.",
		runIndex: ["interrupted_calls"],
		agents: {
			claude_code: stored(
				["user.toolUseResult.interrupted"],
				{
					since: 6,
					facts: ["interrupted"],
				},
				{
					relation: {
						kind: "broader",
					},
					notes:
						"Parser review: claudeToolResultFacts copies toolUseResult.interrupted only; user causation is not inferred. toolDenialKind and user-interrupt markers are separate witnesses.",
					justification:
						"toolUseResult.interrupted is documented as 'Whether the command was interrupted' (any cause) in sdk-tools.d.ts:3267-3271, not 'the user stopped the call'. Locally it is false on 14,297 of 14,297 Bash results (never true), so the user-stop meaning is unobserved; real user stops appear as is_error results with a toolDenialKind or the '[Request interrupted by user ...]' text instead.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/interrupted/claude_code",
							explanation:
								"toolUseResult.interrupted is documented as 'Whether the command was interrupted' (any cause) in sdk-tools.d.ts:3267-3271, not 'the user stopped the call'. Locally it is false on 14,297 of 14,297 Bash results (never true), so the user-stop meaning is unobserved; real user stops appear as is_error results with a toolDenialKind or the '[Request interrupted by user ...]' text instead.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.interrupted",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3271 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Whether the command was interrupted",
						},
					],
				},
			),
			codex: stored(
				[
					"response_item/function_call_output.output~aborted by user",
					"response_item/custom_tool_call_output.output~aborted by user",
				],
				{ since: 8, facts: ["interrupted", "durationMs"] },
				{
					evidence: [],
					notes:
						"Codex writes the call's output as `aborted by user after <s>s`.",
					relation: {
						kind: "transform",
						transform:
							"Recognize the initial aborted by user marker as interrupted=true.",
					},
					justification:
						"parallel.rs writes 'aborted by user after Ns' (or 'Wall time ... aborted by user' for exec_command) as the output when a tool call is cancelled by the user. Witness: 019d381d:1704 response_item/function_call_output.output~aborted by user [string] n=123 v0.107.0..0.160.0",
				},
			),
		},
	},
	{
		id: "no_output_expected",
		view: "calls",
		meaning: "The tool said the command was not expected to print anything.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.noOutputExpected"],
				{
					since: 6,
					facts: ["no_output_expected"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"noOutputExpected is the Bash output field 'Whether the command is expected to produce no output on success' (true on 9 of 13922 local results). Witness: 49ead9e1:23 user.toolUseResult.noOutputExpected [boolean] n=13925 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.noOutputExpected",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3307 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Whether the command is expected to produce no output on success",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such flag on calls, outputs or completions.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such flag on calls, outputs or completions.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/no_output_expected",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The tool said the command was not expected to print anything. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such flag on calls, outputs or completions. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
				{
					since: 6,
					facts: ["stdout_chars", "stderr_chars"],
				},
				{
					relation: {
						kind: "close",
					},
					notes:
						"Parser review: claudeToolResultFacts counts Unicode code points in the recorded stdout/stderr strings, not original untruncated process streams.",
					justification:
						"stdout and stderr are recorded strings counted in code points (stdout_chars, stderr_chars), but the recorded string is not always the whole output: stdout never exceeds 30,000 characters and for all 35 results with persistedOutputSize (full size kept in a file) the recorded stdout is shorter than the total. stderr is non-empty on 4,192 of 14,297 results (the entry notes say older shells merge stderr into stdout). So the counts are of what was recorded, not of what the command wrote.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/stdout_chars/claude_code",
							explanation:
								"stdout and stderr are recorded strings counted in code points (stdout_chars, stderr_chars), but the recorded string is not always the whole output: stdout never exceeds 30,000 characters and for all 35 results with persistedOutputSize (full size kept in a file) the recorded stdout is shorter than the total. stderr is non-empty on 4,192 of 14,297 results (the entry notes say older shells merge stderr into stdout). So the counts are of what was recorded, not of what the command wrote.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.stdout",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3259 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "The standard output of the command",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.stderr",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3263 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "The standard error output of the command",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CommandExecution.stdout",
					"event_msg/item_completed:CommandExecution.stderr",
					"event_msg/exec_command_end.stdout",
					"event_msg/exec_command_end.stderr",
				],
				"parser 9: count each stream where it is recorded separately (about 70,000 completions locally); never split merged output. Review constraint: Plan says to count each stream where recorded separately, but stderr is empty in 100% of 70294 local items and stdout is the merged output; no per-stream split exists (0.146+ only).",
				{
					evidence: [],
					relation: { kind: "close" },
					legacySources: [
						"event_msg/item_completed:CommandExecution.stdout",
						"event_msg/item_completed:CommandExecution.stderr",
						"event_msg/exec_command_end.stdout",
						"event_msg/exec_command_end.stderr",
					],
					notes:
						"Other Codex outputs merge both streams into one text. Parser review: No parser value is stored for this pending proposal. Plan says to count each stream where recorded separately, but stderr is empty in 100% of 70294 local items and stdout is the merged output; no per-stream split exists (0.146+ only).",
					justification:
						"CommandExecution.stdout equals aggregated_output (70294 of 70294) and stderr is empty in all of them, so Codex writes one merged stream, not two; the merged length is the only count available. Witness: 01a1009d:13 event_msg/item_completed:CommandExecution.stdout [string] n=70270 v0.146.0..0.162.0-alpha.2",
				},
			),
		},
	},
	{
		id: "persisted_output_bytes",
		view: "calls",
		meaning:
			"Size of a large output the agent saved to a file instead of showing it.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.persistedOutputSize"],
				{
					since: 6,
					facts: ["persisted_output_bytes"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"persistedOutputSize is the Bash output field 'Total size of the output in bytes (set when output is too large for inline)', which is the saved file's size. Witness: 49ead9e1:335 user.toolUseResult.persistedOutputSize [number] n=32 v2.1.280..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.persistedOutputSize",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3319 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Total size of the output in bytes (set when output is too large for inline)",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): Codex truncates long output in place and writes `Original token count: N`, a token count, not a saved file.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): Codex truncates long output in place and writes `Original token count: N`, a token count, not a saved file.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"codex-absence-0.162.0.json#calls/persisted_output_bytes",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for Size of a large output the agent saved to a file instead of showing it. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): Codex truncates long output in place and writes `Original token count: N`, a token count, not a saved file. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				"parser 9: keep the recorded path beside its size.",
				{
					relation: {
						kind: "exact",
					},
					justification:
						"persistedOutputPath is written beside persistedOutputSize on the same 32 Bash results and names the saved file. Witness: 49ead9e1:335 user.toolUseResult.persistedOutputPath [string] n=32 v2.1.280..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.persistedOutputPath",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3315 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Path to the persisted full output in tool-results dir (set when output is too large for inline)",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no saved-output path on any call output.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no saved-output path on any call output.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"codex-absence-0.162.0.json#calls/persisted_output_path",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for Where the agent saved a large output. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no saved-output path on any call output. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
				"parser 9: keep the flag as recorded.",
				{
					evidence: [],
					notes:
						"It does not mean the agent never read the file or saw nothing.",
					relation: { kind: "exact" },
					justification:
						"contentNotInModelContext is a boolean true on Edit results (197) and is the tool's own flag, as the fact says; not present in the 2.1.88 source. Witness: 49ead9e1:594 user.toolUseResult.contentNotInModelContext [boolean] n=197 v2.1.284..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such flag on outputs or completions.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such flag on outputs or completions.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"codex-absence-0.162.0.json#calls/content_not_in_model_context",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The tool said its result content was not put into the model's context. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such flag on outputs or completions. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
		},
	},
	{
		id: "result_chars",
		view: "calls",
		meaning: "Length of the call's result text.",
		agents: {
			claude_code: stored(
				[
					"user.message.content[tool_result].content",
					"user.message.content[tool_result].content[text].text",
				],
				{
					since: 1,
					record: ["textChars"],
				},
				{
					relation: {
						kind: "transform",
						transform:
							"decoded result text (string or joined text blocks, image blocks as labels) -> Unicode code-point count",
					},
					notes:
						"Parser review: readResultText joins string/text blocks, image labels and recognized wrapped outputs; core textChars counts Unicode code points of that decoded result before head/tail caps.",
					justification:
						"The source is the result content itself (string 29,298, or text blocks 500); the fact is its length, counted in Unicode code points after decoding: text blocks are joined and image blocks become short labels, so images add label characters, not bytes.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/result_chars/claude_code",
							explanation:
								"The source is the result content itself (string 29,298, or text blocks 500); the fact is its length, counted in Unicode code points after decoding: text blocks are joined and image blocks become short labels, so images add label characters, not bytes.",
						},
					],
				},
			),
			codex: stored(
				[
					"response_item/function_call_output.output",
					"response_item/custom_tool_call_output.output",
					"response_item/function_call_output.output[input_text].text",
					"response_item/custom_tool_call_output.output[input_text].text",
				],
				{
					since: 1,
					record: ["textChars"],
				},
				{
					relation: {
						kind: "transform",
						transform:
							"output string or input_text blocks decoded (JSON envelope unwrapped) -> Unicode code-point count; transport framing lines are included",
					},
					notes:
						"Parser review: readCallOutput/readContentText decode string and input_text output blocks; textChars counts Unicode code points of decoded result text, not process-output bytes. Residue path event_msg/item_completed:FunctionCallOutput.output is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"Same meaning as for Claude: the length of the result text as recorded. Codex's recorded output keeps its transport framing (Chunk ID: header on 318,652 of 342,216 function_call_output strings, Wall time 324,441, Original token count 319,742), so the count includes framing lines; older JSON envelopes are unwrapped by the parser before counting. Output is either a string (342,216) or input_text blocks (15,759 + 139,128).",
					gap: {
						sources: ["event_msg/item_completed:FunctionCallOutput.output"],
						plan: "parser 9: read the agreed writer-residue fields separately with their recorded provenance; do not coalesce context with values.",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/result_chars/codex",
							explanation:
								"Same meaning as for Claude: the length of the result text as recorded. Codex's recorded output keeps its transport framing (Chunk ID: header on 318,652 of 342,216 function_call_output strings, Wall time 324,441, Original token count 319,742), so the count includes framing lines; older JSON envelopes are unwrapped by the parser before counting. Output is either a string (342,216) or input_text blocks (15,759 + 139,128).",
						},
					],
				},
			),
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
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Parser review: shellEditFiles reads bashEditDiff.files paths and changedFiles; moreFiles/unavailable/shared are completeness flags, never file paths.",
					justification:
						"Judge ruling. bashEditDiff lists recorded changed paths but also records unavailable/moreFiles/shared conditions, so the list is not a complete inventory in every result. Witness: cb81a350-1d8c-482f-8cf7-d73bffb49715:44; user.toolUseResult.bashEditDiff.files; type=array; version=2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no record of the files a shell command changed; the parser infers them from the command (see file_op).",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no record of the files a shell command changed; the parser infers them from the command (see file_op).",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/shell_edit_files",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for Files a shell command changed, as the agent recorded them. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no record of the files a shell command changed; the parser infers them from the command (see file_op). Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				{
					relation: {
						kind: "exact",
					},
					justification:
						"toolUseResult.gitOperation is the harness's own record of a push, commit, branch or PR operation on Bash results (161), with branch/ref/sha/number/action fields. Witness: 49ead9e1:1081 user.toolUseResult.gitOperation.pr.number [number] n=122 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.push.branch",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3338 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "BashOutput explicitly declares branch as string.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.commit.sha",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3333 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "BashOutput explicitly declares sha as string.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.commit.kind",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3334 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: 'BashOutput explicitly declares kind as "amended".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.commit.kind",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3334 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								'BashOutput explicitly declares kind as "cherry-picked".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.commit.kind",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3334 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								'BashOutput explicitly declares kind as "committed".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.branch.ref",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3341 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "BashOutput explicitly declares ref as string.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.branch.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3342 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: 'BashOutput explicitly declares action as "merged".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.branch.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3342 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								'BashOutput explicitly declares action as "rebased".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.number",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3345 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "BashOutput explicitly declares number as number.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								'BashOutput explicitly declares action as "auto-merge-disabled".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								'BashOutput explicitly declares action as "auto-merge-enabled".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: 'BashOutput explicitly declares action as "closed".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								'BashOutput explicitly declares action as "commented".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								'BashOutput explicitly declares action as "created".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: 'BashOutput explicitly declares action as "draft".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: 'BashOutput explicitly declares action as "edited".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: 'BashOutput explicitly declares action as "merged".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: 'BashOutput explicitly declares action as "ready".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.action",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3347 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								'BashOutput explicitly declares action as "reopened".',
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.gitOperation.pr.url",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3346 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "BashOutput explicitly declares url as string.",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no git operation field; the git extractor reads push and commit output instead.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no git operation field; the git extractor reads push and commit output instead.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/git_operation",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The git operation a call performed (push, commit, branch, pull request), as the agent recorded it. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no git operation field; the git extractor reads push and commit output instead. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
		},
	},
	{
		id: "mcp_server",
		view: "calls",
		meaning: "The MCP server a call went to.",
		runIndex: ["mcp_calls", "mcp_servers"],
		agents: {
			claude_code: wrong(
				["assistant.attributionMcpServer"],
				{
					since: 6,
					facts: ["mcpServer"],
				},
				"parser 9: Derive mcpServer from the call's own mcp__<server>__<tool> name; keep attributionMcpServer only as line context (e.g. attribution_mcp_server on the assistant text row), never on a non-MCP call. Evidence: Real parser over 309 Claude files: 711 assistant lines with attributionMcp* hold exactly one call; 522 are mcp__ calls but 189 are non-MCP calls that now carry mcpServer (Bash 169, ToolSearch 6, Write 4, Agent 4, SendMessage 2, Read 2, Edit 1, ScheduleWakeup 1; first 02d9aca1-2906-49f4-bc77-fe5bff0b371b:49). A further 705 attributed lines have no tool call at all (02d9aca1:37). The SDK types (sdk.d.ts, sdk-tools.d.ts) do not document attributionMcpServer.",
				{
					relation: {
						kind: "close",
					},
					notes:
						"Parser review: parser 9: derive MCP server from the call own mcp__<server>__<tool> name; never apply line attribution to a non-MCP call. Data witness: 185 single non-MCP calls inherit MCP attribution; 695 attributed lines have no call (fresh scan). Data witness: 185 single non-MCP calls inherit MCP attribution; 695 attributed lines have no call (fresh scan).",
					justification:
						"Judge ruling. attributionMcpServer is a line-level attribution on assistant records, not the call target: 655 of 1309 such lines carry no tool_use and values include plugin-style names ('plugin:opaline:opaline'); the call target is in the mcp__<server>__<tool> tool name. Witness: 3b0e7c12:43 assistant.attributionMcpServer [string] n=1265 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/mcp_server/claude_code",
							explanation:
								"Real parser over 309 Claude files: 711 assistant lines with attributionMcp* hold exactly one call; 522 are mcp__ calls but 189 are non-MCP calls that now carry mcpServer (Bash 169, ToolSearch 6, Write 4, Agent 4, SendMessage 2, Read 2, Edit 1, ScheduleWakeup 1; first 02d9aca1-2906-49f4-bc77-fe5bff0b371b:49). A further 705 attributed lines have no tool call at all (02d9aca1:37). The SDK types (sdk.d.ts, sdk-tools.d.ts) do not document attributionMcpServer.",
						},
					],
				},
			),
			codex: stored(
				[
					"event_msg/item_completed:McpToolCall.server",
					"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].server_name",
					"response_item/function_call_output@metadata.mcp_attribution.sources[].server_name",
					"event_msg/mcp_tool_call_end.invocation.server",
					"response_item/function_call:list_mcp_resources.arguments.server",
				],
				{ since: 6, facts: ["mcpServer"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/mcp_server/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					gap: {
						sources: [
							"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].server_name",
							"response_item/function_call_output@metadata.mcp_attribution.sources[].server_name",
							"event_msg/mcp_tool_call_end.invocation.server",
							"response_item/function_call:list_mcp_resources.arguments.server",
						],
						plan: "parser 9: preserve the literal response_item/function_call:list_mcp_resources.arguments.server with its existing mcp_server meaning and provenance.",
					},
					relation: { kind: "close" },
					justification:
						"Judge round 3: McpToolCall.server and invocation.server identify the actual target, and list_mcp_resources.server is a discovery filter. metadata.mcp_attribution.sources[].server_name is cumulative historical source provenance, explicitly not the current call server.",
					notes:
						"Residue path event_msg/mcp_tool_call_end.invocation.server is recorded but unparsed; no local witness and no semantic verification is claimed.",
					legacySources: [
						"response_item/function_call:list_mcp_resources.arguments.server",
					],
				},
			),
		},
	},
	{
		id: "mcp_tool",
		view: "calls",
		meaning: "The MCP tool a call used.",
		agents: {
			claude_code: wrong(
				["assistant.attributionMcpTool"],
				{
					since: 6,
					facts: ["mcpTool"],
				},
				"parser 9: Derive mcpTool from the mcp__<server>__<tool> call name and propagate only that identity to its result. Evidence: Same 189 non-MCP single calls carry mcpTool from line attribution (first 02d9aca1-2906-49f4-bc77-fe5bff0b371b:49); 522 genuine mcp__ calls; 705 attributed lines have no call.",
				{
					relation: {
						kind: "close",
					},
					notes:
						"Parser review: parser 9: derive MCP tool from the call own mcp__<server>__<tool> name and propagate only that call identity to its result. Data witness: Same 185 non-MCP calls inherit a line MCP identity (fresh scan). Data witness: Same 185 non-MCP calls inherit a line MCP identity (fresh scan).",
					justification:
						"Judge ruling. attributionMcpTool is a line-level attribution on assistant records (also present on lines with no tool_use) rather than the tool of a call. Witness: 3b0e7c12:43 assistant.attributionMcpTool [string] n=1265 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/mcp_tool/claude_code",
							explanation:
								"Same 189 non-MCP single calls carry mcpTool from line attribution (first 02d9aca1-2906-49f4-bc77-fe5bff0b371b:49); 522 genuine mcp__ calls; 705 attributed lines have no call.",
						},
					],
				},
			),
			codex: stored(
				["event_msg/item_completed:McpToolCall.tool"],
				{ since: 6, facts: ["mcpTool"] },
				{
					evidence: [],
					gap: {
						sources: [
							"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].tool_name",
							"response_item/function_call_output@metadata.mcp_attribution.sources[].tool_name",
							"event_msg/mcp_tool_call_end.invocation.tool",
						],
						plan: "parser 9: keep the MCP tool an output's `mcp_attribution` names (see mcp_server).",
					},
					sourceMappings: [
						{
							path: "response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].tool_name",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"McpToolCallItem.tool is the MCP tool the call used (server is a separate field). Witness: 019d1b53:368 event_msg/item_completed:McpToolCall.tool [string] n=30264 v0.107.0..0.162.0-alpha.2",
						},
						{
							path: "response_item/function_call_output@metadata.mcp_attribution.sources[].tool_name",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"McpToolCallItem.tool is the MCP tool the call used (server is a separate field). Witness: 019d1b53:368 event_msg/item_completed:McpToolCall.tool [string] n=30264 v0.107.0..0.162.0-alpha.2",
						},
					],
					relation: { kind: "exact" },
					justification:
						"McpToolCallItem.tool is the MCP tool the call used (server is a separate field). Witness: 019d1b53:368 event_msg/item_completed:McpToolCall.tool [string] n=30264 v0.107.0..0.162.0-alpha.2",
					notes:
						"Residue path event_msg/mcp_tool_call_end.invocation.tool is recorded but unparsed; no local witness and no semantic verification is claimed.",
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
			codex: stored(
				["event_msg/item_completed:McpToolCall.readOnlyHint"],
				{ since: 6, facts: ["mcp_read_only"] },
				{
					evidence: [
						{
							kind: "writer_source",
							path: "event_msg/item_completed:McpToolCall.readOnlyHint",
							file: "codex-rs/protocol/src/items.rs",
							line: 479,
							version: "0.162.0",
							supportsMeaning: true,
							explanation:
								"The optional boolean read_only_hint is serialized as readOnlyHint; core/src/mcp_tool_call.rs:432–434 copies annotations.read_only_hint, not observed tool behaviour.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"items.rs:479 stores read_only_hint; core/src/mcp_tool_call.rs:432–434 copies the MCP tool annotation, a declaration rather than proof of side-effect freedom.",
					gap: {
						sources: ["event_msg/mcp_tool_call_end.read_only_hint"],
						plan: "parser 9: read the agreed writer-residue fields separately with their recorded provenance; do not coalesce context with values.",
					},
					notes:
						"Residue path event_msg/mcp_tool_call_end.read_only_hint is recorded but unparsed; no local witness and no semantic verification is claimed.",
				},
			),
		},
	},
	{
		id: "attribution_plugin",
		view: "calls",
		meaning: "The plugin the call came from.",
		agents: {
			claude_code: pending(
				["assistant.attributionPlugin"],
				"parser 9: keep `attributionPlugin` like `attributionSkill`.",
				{
					evidence: [],
					relation: { kind: "close" },
					justification:
						"Judge ruling. attributionPlugin is a per-assistant-line attribution (16 lines, all value 'conductor', 2.1.280) rather than a per-call property. Witness: 5408a691:494 assistant.attributionPlugin [string] n=16 v2.1.280..2.1.280",
				},
			),
			codex: stored(
				["event_msg/item_completed:McpToolCall.pluginId"],
				{ since: 6, facts: ["attribution_plugin"] },
				{
					evidence: [],
					relation: { kind: "narrower" },
					gap: {
						sources: [
							"event_msg/item_completed:CommandExecution.plugin_id",
							"event_msg/mcp_tool_call_end.plugin_id",
						],
						plan: "parser 9: copy CommandExecution.plugin_id as shell plugin attribution.",
					},
					notes:
						"Parser review: codexItemFacts reads only McpToolCall.pluginId today; CommandExecution.plugin_id is a real but unparsed gap, not already stored attribution. Residue path event_msg/mcp_tool_call_end.plugin_id is recorded but unparsed; no local witness and no semantic verification is claimed.",
					sourceMappings: [
						{
							path: "event_msg/item_completed:CommandExecution.plugin_id",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"36 local CommandExecution.plugin_id values explicitly identify the shell-call plugin. Recorded gap; parser does not extract it yet.",
						},
					],
					justification:
						"McpToolCall.pluginId is extracted; 36 local CommandExecution.plugin_id values are recorded but not extracted. Narrower current parser coverage; parser 9 must retain shell attribution.",
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
			claude_code: stored(
				["assistant.attributionSkill"],
				{ since: 6, facts: ["attributionSkill"] },
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"attributionSkill is written on assistant lines (2603, 1278 without tool_use), matching the fact's own 'on this line' scope. Witness: 49ead9e1:1050 assistant.attributionSkill [string] n=2603 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no skill attribution on any record; Codex uses a skill by reading its SKILL.md (see skill).",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no skill attribution on any record; Codex uses a skill by reading its SKILL.md (see skill).",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/attribution_skill",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The skill whose instructions the agent was following on this line. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no skill attribution on any record; Codex uses a skill by reading its SKILL.md (see skill). Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				"parser 9: keep `attributionAgent` (about 19,000 lines locally).",
				{
					evidence: [],
					relation: { kind: "narrower" },
					justification:
						"Judge ruling. attributionAgent is written only on sidechain (sub-agent) lines, always one of general-purpose/Explore/Plan (21473), and is absent on main-thread lines, so 'main' is the absence, not a recorded value. Witness: agent-ac:13 assistant.attributionAgent [string] n=21473 v2.1.220..2.1.293",
				},
			),
			codex: pending(
				[
					"session_meta/.agent_role",
					"session_meta/.agent_nickname",
					"session_meta/.source.subagent.thread_spawn.agent_role",
					"session_meta/.source.subagent.thread_spawn.agent_nickname",
				],
				"parser 9: keep the sub-agent's role and nickname from its session_meta on its stream. Review constraint: agent_role is null in 507 of 508 sub-agent sessions and nickname is random; session_meta.agent_path (507) is the usable kind/identity.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Codex records it once per sub-agent thread, not per line. Parser review: No parser value is stored for this pending proposal. agent_role is null in 507 of 508 sub-agent sessions and nickname is random; session_meta.agent_path (507) is the usable kind/identity.",
					justification:
						"session_meta agent_nickname is a random label (not a kind) and agent_role is filled on 1 of 508 local sub-agent sessions; the stable sub-agent identity is agent_path, which is not listed. Witness: 019e3494:1 session_meta/.agent_nickname [string] n=508 v0.130.0..0.162.0-alpha.2",
				},
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
				{
					since: 1,
					record: ["filePath"],
				},
				{
					relation: {
						kind: "close",
					},
					notes:
						"Parser review: readToolUse/getClaudeMutationFiles copy requested Read/Edit/Write targets; a stored path is not proof of a completed change.",
					justification:
						"Judge ruling. Read/Write/Edit/NotebookEdit inputs name the requested target file, not proof that the file was successfully read or changed. Witness: 46e611b4-12c4-450b-94fe-343803f564ea:71; assistant.message.content[tool_use:Read].input.file_path; type=string; chars=144; version=2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Read].input.file_path",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:873 (FileReadInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "The absolute path to the file to read",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Write].input.file_path",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:891 (FileWriteInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"The absolute path to the file to write (must be absolute, not relative)",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Edit].input.file_path",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:855 (FileEditInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "The absolute path to the file to modify",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:NotebookEdit].input.notebook_path",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:998 (NotebookEditInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)",
						},
					],
				},
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
					evidence: [],
					relation: { kind: "close" },
					gap: {
						sources: [
							"event_msg/item_completed:ImageView.path",
							"response_item/function_call:view_image.arguments.path",
						],
						plan: "parser 9: keep the path of an image the agent viewed (about 1,800 ImageView completions locally have no handler).",
					},
					notes:
						"Parser review: readFileChange iterates changes map keys and move_path; parseCodexPatch reads requested patch paths. Operation type values are not path values.",
					sourceMappings: [
						{
							path: "event_msg/item_completed:ImageView.path",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"The changed path in FileChange is the map key of `changes`, which census normalises to {*}; the listed .type and .move_path fields describe the operation and rename target, and apply_patch.input holds paths inside patch text. Witness: 019d0073:783 event_msg/item_completed:FileChange.changes.{*}.type [string] n=54978 v0.107.0..0.160.0 values={'update': 49396, 'add': 4643, 'delete': 939}",
						},
						{
							path: "response_item/function_call:view_image.arguments.path",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"The changed path in FileChange is the map key of `changes`, which census normalises to {*}; the listed .type and .move_path fields describe the operation and rename target, and apply_patch.input holds paths inside patch text. Witness: 019d0073:783 event_msg/item_completed:FileChange.changes.{*}.type [string] n=54978 v0.107.0..0.160.0 values={'update': 49396, 'add': 4643, 'delete': 939}",
						},
					],
					justification:
						"The changed path in FileChange is the map key of `changes`, which census normalises to {*}; the listed .type and .move_path fields describe the operation and rename target, and apply_patch.input holds paths inside patch text. Witness: 019d0073:783 event_msg/item_completed:FileChange.changes.{*}.type [string] n=54978 v0.107.0..0.160.0 values={'update': 49396, 'add': 4643, 'delete': 939}",
				},
			),
		},
	},
	{
		id: "file_op",
		view: "calls",
		meaning:
			"What a call asked to do to a file (requested); the call's outcome says whether it happened.",
		decision:
			"Should a file change the agent asked for but no result confirms (a refused or failed edit, a shell `rm` that may have found nothing) count as an edit, or only changes a result confirms?",
		agents: {
			claude_code: stored(
				[
					"assistant.message.content[tool_use:Write].input.file_path",
					"assistant.message.content[tool_use:Edit].input.file_path",
					"assistant.message.content[tool_use:Bash].input.command",
					"assistant.message.content[tool_use:Read].input.file_path",
				],
				{
					since: 1,
					record: ["fileOp"],
				},
				{
					relation: {
						kind: "close",
					},
					notes:
						"Parser review: parser 9: a refused `rm` or Edit still becomes a `delete` or `edit` row; store what the command asked for as requested operations and count a change only when a result confirms it (`structuredPatch`, `bashEditDiff`). Data witness: 857 requested Edit paths in the committed census; readToolUse emits effects before any outcome. Data witness: 857 requested Edit paths in the committed census; readToolUse emits effects before any outcome.",
					justification:
						"The operation is derived from the tool name (Write/Edit) or parsed from the Bash command text; Read and NotebookEdit are not in sources although the fact includes reads. Witness: 49ead9e1:427 assistant.message.content[tool_use:Write].input.file_path [string] n=839 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/file_op/claude_code",
							explanation:
								"Parser rows are the literal request. Real parser over 3,955 Claude calls that emitted file_change rows: 3,862 ok, 21 denied (all shell, e.g. rm; denial seen in 69405f58-75d8-4064-9c5c-20dd17e8f76b), 70 failed without denial (20 native Edit/Write, 50 shell), 2 without a result: 91 (2.3%) are operations that did not happen. No native Edit/Write was denied locally.",
						},
					],
				},
			),
			codex: stored(
				[
					"response_item/custom_tool_call:apply_patch.input",
					"response_item/function_call:exec_command.arguments.cmd",
					"event_msg/item_completed:FileChange.changes.{*}.type",
				],
				{
					since: 1,
					record: ["fileOp"],
				},
				{
					relation: {
						kind: "close",
					},
					notes:
						"Codex reads (`parsed_cmd` parts of type `read`) are not file_op `read` yet; see reads. Parser review: parser 9: 70 of 108 refused calls locally still emit counted `write`, `edit` or `delete` rows; store shell and patch syntax as requested operations and count a change only from applied-change evidence (FileChange or patch_apply_end success). Data witness: 70 of 108 refused calls emitted requested mutation rows in the prior local catalog census; those are not applied effects. Data witness: 70 of 108 refused calls emitted requested mutation rows in the prior local catalog census; those are not applied effects.",
					justification:
						"Operations are inferred from apply_patch headers and shell command text; the applied operation is recorded in FileChange.changes.{*}.type (add/update/delete) which is not listed here. Witness: 019cb44a:319 response_item/custom_tool_call:apply_patch.input [string] n=42622 v0.100.0..0.147.0-alpha.1.2",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/file_op/codex",
							explanation:
								"Real parser: 110 refused calls (99 Rejected, 11 Sandbox(Denied)), 71 of them have counted write/edit/delete rows (first file rollout-2026-02-18T13-03-37-019c70a2); 749 of the 1,892 transport-failed calls also carry mutation rows. They are literal requests, not applied changes.",
						},
					],
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
			claude_code: stored(
				["user.toolUseResult.structuredPatch[].lines[]"],
				{
					since: 6,
					facts: ["patch_lines_added", "patch_lines_removed"],
				},
				{
					relation: {
						kind: "transform",
						transform:
							"count of structuredPatch lines starting with '+' (added) and '-' (removed)",
					},
					justification:
						"structuredPatch hunks carry diff lines whose prefix is the literal added/removed marker; the stored counts are the number of '+' and '-' lines. Local: 474 non-empty patches with 10,003 '+', 5,492 '-', 5,897 context lines (one unprefixed). Gap: a Write that creates a file has structuredPatch [] (384 of 384 type=create), so patchLineCounts returns undefined and the lines of created files are not counted (57 type=update Writes do have hunks).",
					notes:
						"Independent disagreement remains unreviewed: Sol=transform, Sonnet=close.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/patch_lines_added/claude_code",
							explanation:
								"structuredPatch hunks carry diff lines whose prefix is the literal added/removed marker; the stored counts are the number of '+' and '-' lines. Local: 474 non-empty patches with 10,003 '+', 5,492 '-', 5,897 context lines (one unprefixed). Gap: a Write that creates a file has structuredPatch [] (384 of 384 type=create), so patchLineCounts returns undefined and the lines of created files are not counted (57 type=update Writes do have hunks).",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].lines[]",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3413 (FileEditOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileEditOutput explicitly declares lines[] as string.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].lines[]",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3461 (FileWriteOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileWriteOutput explicitly declares lines[] as string.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:FileChange.changes.{*}.unified_diff",
					"event_msg/patch_apply_end.changes.{*}.unified_diff",
				],
				"parser 9: count the lines of an applied change's unified diff (about 49,000 changes locally); a proposed patch is not an applied one. Review constraint: Add/Delete.content sources are missing, so the listed update-diff sources do not cover all edits; diff line counts also require an explicit transform.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Add/Delete.content sources are missing, so the listed update-diff sources do not cover all edits; diff line counts also require an explicit transform.",
					justification:
						"unified_diff text of an applied FileChange holds +/- lines to count; the counts are derived, not recorded. Witness: 019d0073:783 event_msg/item_completed:FileChange.changes.{*}.unified_diff [string] n=49490 v0.107.0..0.160.0",
				},
			),
		},
	},
	{
		id: "user_modified",
		view: "calls",
		meaning: "The user changed the agent's proposed edit before accepting it.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.userModified"],
				{
					since: 6,
					facts: ["user_modified"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"userModified is the Write/Edit output field 'Whether the user modified the proposed changes' (832 results, all false locally). Witness: 49ead9e1:428 user.toolUseResult.userModified [boolean] n=832 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.userModified",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3418 (FileEditOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Whether the user modified the proposed changes",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.userModified",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3482 (FileWriteOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"True when the user edited the proposed content in the permission dialog before accepting",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such field on FileChange or patch events.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such field on FileChange or patch events.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/user_modified",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The user changed the agent's proposed edit before accepting it. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such field on FileChange or patch events. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
		},
	},
	{
		id: "stale_read",
		view: "calls",
		meaning:
			"The tool warned that files changed since the agent last read them.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.staleReadFileStateHint"],
				{
					since: 6,
					facts: ["stale_read"],
				},
				{
					relation: {
						kind: "narrower",
					},
					justification:
						"sdk-tools.d.ts:3321-3323 documents staleReadFileStateHint as a model-facing note listing readFileState entries whose mtime changed DURING this command (set when write-command markers match), i.e. the tool telling the agent that files it had read were changed. That is a subset of 'files changed since the agent last read them' (changes made by other parties between the read and the command are not reported). It is present on 656 results (652 in the census), and the parser stores the note text (capped), so the stored value is the warning itself.",
					notes:
						"Independent disagreement remains unreviewed: Sol=transform, Sonnet=close.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/stale_read/claude_code",
							explanation:
								"sdk-tools.d.ts:3321-3323 documents staleReadFileStateHint as a model-facing note listing readFileState entries whose mtime changed DURING this command (set when write-command markers match), i.e. the tool telling the agent that files it had read were changed. That is a subset of 'files changed since the agent last read them' (changes made by other parties between the read and the command are not reported). It is present on 656 results (652 in the census), and the parser stores the note text (capped), so the stored value is the warning itself.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.staleReadFileStateHint",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3323 (BashOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Model-facing note listing readFileState entries whose mtime bumped during this command (set when WRITE_COMMAND_MARKERS matches)",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no stale-read notice on any output or completion.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no stale-read notice on any output or completion.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/stale_read",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The tool warned that files changed since the agent last read them. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no stale-read notice on any output or completion. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
		},
	},
	{
		id: "search_matches",
		view: "calls",
		meaning: "How many matches a search found.",
		agents: {
			claude_code: wrong(
				["user.toolUseResult.numFiles"],
				{
					since: 6,
					facts: ["search_matches"],
				},
				"parser 9: Store numFiles as files_found and numLines/numMatches as the match counts, keyed by mode; define search_matches from the mode-appropriate counter only. Evidence: Locally only 2 tool results carry numFiles (user.toolUseResult.numFiles n=2, both Grep mode=content, v2.1.286): 435d28db-0fd5-46cb-b312-4601631ecca6:167 has numFiles=0 with numLines=5, :232 has numFiles=0 and numLines=0. So the stored match count is 0 for a search that matched 5 lines.",
				{
					relation: {
						kind: "close",
					},
					notes:
						"Parser review: parser 9: `numFiles` is stored as the match count, but in content mode it is 0 while `numLines` counts the matches; keep the search `mode` and each counter under its own name. Data witness: 1 of 2 Grep results has numFiles!=numLines; 435d28db…:167 records numFiles=0 (fresh scan). Data witness: 1 of 2 Grep results has numFiles!=numLines; 435d28db…:167 records numFiles=0 (fresh scan).",
					justification:
						"numFiles counts files with matches (0 in content mode, where numLines counts matches), and only 2 Grep results exist locally. Witness: 435d28db:167 user.toolUseResult.numFiles [number] n=2 v2.1.286..2.1.286",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/search_matches/claude_code",
							explanation:
								"Locally only 2 tool results carry numFiles (user.toolUseResult.numFiles n=2, both Grep mode=content, v2.1.286): 435d28db-0fd5-46cb-b312-4601631ecca6:167 has numFiles=0 with numLines=5, :232 has numFiles=0 and numLines=0. So the stored match count is 0 for a search that matched 5 lines.",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no match count; `parsed_cmd` search parts record the query and path only.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no match count; `parsed_cmd` search parts record the query and path only.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/search_matches",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for How many matches a search found. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no match count; `parsed_cmd` search parts record the query and path only. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
					"assistant.message.content[tool_use:Glob].input.pattern",
					"assistant.message.content[tool_use:Grep].input.path",
				],
				{
					since: 1,
					record: ["text"],
				},
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Inside the call's input text. Parser review: readToolUse stores the input JSON of native Grep/Glob calls; it does not extract every Bash search query.",
					justification:
						"Grep input.pattern and input.path are the query and the place; Glob.pattern never occurs locally and only 2 Grep calls exist. Witness: 435d28db:166 assistant.message.content[tool_use:Grep].input.pattern [string] n=2 v2.1.286..2.1.286",
					evidence: [
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Grep].input.pattern",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:911 (GrepInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"The regular expression pattern to search for in file contents",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Glob].input.pattern",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:901 (GlobInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "The glob pattern to match files against",
						},
					],
					sourceMappings: [
						{
							path: "assistant.message.content[tool_use:Grep].input.path",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CommandExecution.parsed_cmd[].query",
					"event_msg/exec_command_end.parsed_cmd[].query",
					"event_msg/item_completed:Extension.action.queries[]",
					"event_msg/item_completed:WebSearch.action.queries[]",
					"response_item/web_search_call.action.queries[]",
					"event_msg/item_completed:CommandExecution.parsed_cmd[].path",
				],
				"parser 9: retain search_query as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/search_query/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					legacySources: ["event_msg/exec_command_end.parsed_cmd[].query"],
					notes:
						"Parser review: No parser value is stored for this pending proposal. parsed_cmd[].path is shared by read/list/search parts (109770 local) and is best-effort; only type=search parts are search_query.",
					sourceMappings: [
						{
							path: "event_msg/item_completed:CommandExecution.parsed_cmd[].path",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"No search-query extractor yet. Generic query sources are not filtered by parsed_cmd.type=search; keep close until parser 9 adds that predicate. Path is scope context.",
				},
			),
		},
	},
	{
		id: "spawned_agent_id",
		view: "calls",
		meaning: "The sub-agent a call started.",
		agents: {
			claude_code: stored(
				["user.toolUseResult.agentId"],
				{
					since: 1,
					record: ["spawnedAgentId"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"toolUseResult.agentId on Agent results (144) is the ID of the sub-agent the call started. Witness: 49ead9e1:452 user.toolUseResult.agentId [string] n=145 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.agentId",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:102 (AgentOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "AgentOutput explicitly declares agentId as string.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.agentId",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:157 (AgentOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "The ID of the async agent",
						},
					],
				},
			),
			codex: wrong(
				[
					"event_msg/item_completed:SubAgentActivity.agent_thread_id",
					"event_msg/item_completed:CollabAgentToolCall.receiver_thread_ids",
					"event_msg/item_completed:CollabAgentToolCall.receiver_thread_ids[]",
					"response_item/function_call_output.output",
				],
				{
					since: 7,
					facts: ["spawned_thread_ids", "spawned_thread_ids_more"],
				},
				"parser 9: Store spawned ids only from kind=started activities and spawn tool outputs; keep the other activities' thread id under subagent_activity (kind + thread), and do not write an empty list for waits. Evidence: Real parser: 7,552 SubAgentActivity items (kind started 521, interacted 6,187, completed 808, interrupted 36) all store spawned_thread_ids, so 7,031 (93%) of the 'spawned' ids are not starts (interacted example rollout-2026-07-15T10-48-57-019f64f7:343, started :279). 3,278 CollabAgentToolCall wait mirrors also carry the field, as an empty list. Genuine spawn evidence is spawn_agent output (506 rows set spawnedAgentId).",
				{
					relation: {
						kind: "broader",
					},
					notes:
						"Parser review: parser 9: every sub-agent activity and every wait is stored as a spawn (7,536 activities, of which 519 starts, and 3,272 waits locally); keep the activity kind and related thread ids (subagent_activity) and name a spawn only from spawn evidence. Data witness: 7544 activity items but only 521 starts; other kinds still populate spawned_thread_ids (fresh scan). Data witness: 7544 activity items but only 521 starts; other kinds still populate spawned_thread_ids (fresh scan).",
					justification:
						"The sources name the sub-agent a call touched, not only the one it started: SubAgentActivity.agent_thread_id is present on all 7,552 activities but only 521 are kind=started (interacted 6,187, completed 808, interrupted 36), and CollabAgentToolCall.receiver_thread_ids (3,278 items, all tool=wait) is an empty array every time. function_call_output.output is spawn evidence only for spawn tools (506 task_name/agent_id reads). So the source meaning (affected agent) includes the fact (agent started).",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#calls/spawned_agent_id/codex",
							explanation:
								"Real parser: 7,552 SubAgentActivity items (kind started 521, interacted 6,187, completed 808, interrupted 36) all store spawned_thread_ids, so 7,031 (93%) of the 'spawned' ids are not starts (interacted example rollout-2026-07-15T10-48-57-019f64f7:343, started :279). 3,278 CollabAgentToolCall wait mirrors also carry the field, as an empty list. Genuine spawn evidence is spawn_agent output (506 rows set spawnedAgentId).",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/spawned_agent_id/codex",
							explanation:
								"The sources name the sub-agent a call touched, not only the one it started: SubAgentActivity.agent_thread_id is present on all 7,552 activities but only 521 are kind=started (interacted 6,187, completed 808, interrupted 36), and CollabAgentToolCall.receiver_thread_ids (3,278 items, all tool=wait) is an empty array every time. function_call_output.output is spawn evidence only for spawn tools (506 task_name/agent_id reads). So the source meaning (affected agent) includes the fact (agent started).",
						},
					],
				},
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
				"parser 9: keep the Agent result's status (`async_launched`, `completed`) and a resumed agent's id. Review constraint: The sources only cover selected sub-agent outcomes; resumedAgentId is an identifier, not an activity kind.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_activity/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "narrower" },
					notes:
						"SendMessage pin identifies the addressed sub-agent, not an artifact and not an activity kind (89/89 results; 89/89 pin.id matches a sub-agent file). The identity belongs to communication_recipient/subagent_thread_ids.",
					justification:
						"Judge round 3: Agent tool results carry status async_launched (143) or completed (6-7): two of the four activity kinds (started, completed). Messaging, interruption and resumption are not given as a status; SendMessage results carry only the addressed agent (pin.id/name/ref, 89 results, never an activity kind) and resumedAgentId (54).",
					sourceMappings: [
						{
							path: "user.toolUseResult.resumedAgentId",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:SubAgentActivity.kind",
					"event_msg/item_completed:CollabAgentToolCall.tool",
					"event_msg/sub_agent_activity.agent_path",
					"event_msg/sub_agent_activity.kind",
					"event_msg/item_completed:SubAgentActivity.agent_path",
					"event_msg/item_completed:CollabAgentToolCall.sender_thread_id",
				],
				"parser 9: keep the activity kind and agent path, and a collaboration call's tool and threads. Review constraint: sender_thread_id and agent_path are identity context, not the activity.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. sender_thread_id and agent_path are identity context, not the activity. Residue path event_msg/sub_agent_activity.agent_path is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/sub_agent_activity.kind is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"SubAgentActivity.kind (n=7,552) is the literal activity: started 521, interacted 6,187, completed 808, interrupted 36, i.e. the four verbs of the fact (interacted = messaged). CollabAgentToolCall.tool is a tool name, not an activity: locally only 'wait' (3,278), which is none of started/messaged/interrupted/completed. The legacy event_msg/sub_agent_activity.kind has no local record. Mixed exact and tool-name sources make the entry close.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/subagent_activity/codex",
							explanation:
								"SubAgentActivity.kind (n=7,552) is the literal activity: started 521, interacted 6,187, completed 808, interrupted 36, i.e. the four verbs of the fact (interacted = messaged). CollabAgentToolCall.tool is a tool name, not an activity: locally only 'wait' (3,278), which is none of started/messaged/interrupted/completed. The legacy event_msg/sub_agent_activity.kind has no local record. Mixed exact and tool-name sources make the entry close.",
						},
					],
					sourceMappings: [
						{
							path: "event_msg/item_completed:CollabAgentToolCall.tool",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Activity context; the explicit SubAgentActivity.kind is the primary activity.",
						},
						{
							path: "event_msg/sub_agent_activity.agent_path",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Activity context; the explicit SubAgentActivity.kind is the primary activity.",
						},
						{
							path: "event_msg/sub_agent_activity.kind",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Activity context; the explicit SubAgentActivity.kind is the primary activity.",
						},
						{
							path: "event_msg/item_completed:SubAgentActivity.agent_path",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Activity context; the explicit SubAgentActivity.kind is the primary activity.",
						},
						{
							path: "event_msg/item_completed:CollabAgentToolCall.sender_thread_id",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Activity context; the explicit SubAgentActivity.kind is the primary activity.",
						},
					],
				},
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
					evidence: [],
					relation: { kind: "close" },
					gap: {
						sources: [
							"assistant.message.content[tool_use:Agent].input.model",
							"assistant.message.content[tool_use:Agent].input.isolation",
							"user.toolUseResult.resolvedModel",
							"user.toolUseResult.agentType",
						],
						plan: "parser 9: keep the requested model and isolation and the model the sub-agent resolved to.",
					},
					notes:
						"run_index reads the type from the Agent call's input text. Parser review: Catalog scope correction: Separate requested type/model, resolved type/model and isolation; no listed source supplies requested reasoning effort.",
					sourceMappings: [
						{
							path: "assistant.message.content[tool_use:Agent].input.model",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Agent input.subagent_type is the requested type (116 of 151 Agent calls) and input.model the requested model (gap, 89), but Claude has no reasoning-effort field on Agent calls. Witness: 49ead9e1:451 assistant.message.content[tool_use:Agent].input.subagent_type [string] n=116 v2.1.220..2.1.293",
						},
						{
							path: "assistant.message.content[tool_use:Agent].input.isolation",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Agent input.subagent_type is the requested type (116 of 151 Agent calls) and input.model the requested model (gap, 89), but Claude has no reasoning-effort field on Agent calls. Witness: 49ead9e1:451 assistant.message.content[tool_use:Agent].input.subagent_type [string] n=116 v2.1.220..2.1.293",
						},
						{
							path: "user.toolUseResult.resolvedModel",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Agent input.subagent_type is the requested type (116 of 151 Agent calls) and input.model the requested model (gap, 89), but Claude has no reasoning-effort field on Agent calls. Witness: 49ead9e1:451 assistant.message.content[tool_use:Agent].input.subagent_type [string] n=116 v2.1.220..2.1.293",
						},
						{
							path: "user.toolUseResult.agentType",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Agent input.subagent_type is the requested type (116 of 151 Agent calls) and input.model the requested model (gap, 89), but Claude has no reasoning-effort field on Agent calls. Witness: 49ead9e1:451 assistant.message.content[tool_use:Agent].input.subagent_type [string] n=116 v2.1.220..2.1.293",
						},
					],
					justification:
						"Agent input.subagent_type is the requested type (116 of 151 Agent calls) and input.model the requested model (gap, 89), but Claude has no reasoning-effort field on Agent calls. Witness: 49ead9e1:451 assistant.message.content[tool_use:Agent].input.subagent_type [string] n=116 v2.1.220..2.1.293",
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
				"parser 9: keep the spawn request's agent type, model, effort, task name and forked turns. Review constraint: agent_type is rare (2 of 551 spawns); task_name, fork_turns and fork_context are not part of the fact's meaning.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. agent_type is rare (2 of 551 spawns); task_name, fork_turns and fork_context are not part of the fact's meaning.",
					sourceMappings: [
						{
							path: "response_item/function_call:spawn_agent.arguments.task_name",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "response_item/function_call:spawn_agent.arguments.fork_turns",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "response_item/function_call:spawn_agent.arguments.fork_context",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"spawn_agent.arguments model (301) and reasoning_effort (191) are the requested model and effort, but agent_type occurs in only 2 of 551 spawns and task_name/fork_turns/fork_context are not a type, model or effort. Witness: 019e3171:6066 response_item/function_call:spawn_agent.arguments.agent_type [string] n=2 v0.130.0..0.130.0",
				},
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
				"parser 9: keep the child's reported totals apart from the parent call's duration; never add them to usage already counted from the child's stream.",
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"Sync Agent results report totalDurationMs, totalTokens, totalToolUseCount, toolStats and usage (7 local); async launches have no totals. Witness: 24468b99:537 user.toolUseResult.totalDurationMs [number] n=7 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): a completed SubAgentActivity carries no totals; the child's own rollout has its usage.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): a completed SubAgentActivity carries no totals; the child's own rollout has its usage.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/subagent_totals",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90, codex-rs/protocol/src/items.rs:361. Checked the 0.162.0 durable schema/policy and candidate paths for Totals a finished sub-agent reported: time, tokens, tool calls. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): a completed SubAgentActivity carries no totals; the child's own rollout has its usage. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Parser review: readToolUse stores Skill input.skill as a requested invocation; it does not certify loading success or following its instructions.",
					justification:
						"Judge ruling. Skill input.skill identifies the skill the assistant requested, which alone does not establish successful loading or use of its instructions. Witness: b988425c-f09b-44d9-b06c-5919f40363f0:23; assistant.message.content[tool_use:Skill].input.skill; type=string; chars=10; version=2.1.293",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:UserMessage.content[skill].name",
					"event_msg/item_completed:UserMessage.content[skill].path",
					"event_msg/item_completed:CommandExecution.parsed_cmd[].path",
				],
				"parser 9: store the explicit skill items (UserMessage content[skill] name and path) as skill, and a read of a SKILL.md path (parsed_cmd part type read) as a skill read; never treat other read paths as skills.",
				{
					relation: { kind: "close" },
					notes:
						"Codex has no skill tool: the agent uses a skill by reading its SKILL.md, which `parsed_cmd` records as a read, and a user invokes one in the prompt (an explicit skill item, 6 locally, 0.159+). Transcript records store every parsed read path literally as `parsed_cmd_read_paths` (see that fact); nothing labels them as skills today, and run_index counts skills for Claude Code only. Of 107,016 local read parts, 99,163 are not SKILL.md paths, so a skill read needs the SKILL.md filter. Versions without CommandExecution items (0.100, 0.105, 0.108–0.118 and 0.130–0.145 locally) record no such read.",
					justification:
						"Judge ruling: a SKILL.md read is a skill use only after a path filter, and the explicit skill items are the literal source; the stored read paths are correct as reads, not as skills.",
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
					evidence: [],
					legacySources: [
						"event_msg/exec_command_end.parsed_cmd[].type",
						"event_msg/exec_command_end.parsed_cmd[].cmd",
						"event_msg/exec_command_end.parsed_cmd[].name",
					],
					gap: {
						sources: [
							"event_msg/exec_command_end.parsed_cmd[].type",
							"event_msg/exec_command_end.parsed_cmd[].cmd",
							"event_msg/exec_command_end.parsed_cmd[].name",
						],
						plan: "parser 9: read the same parts from `exec_command_end` events of older versions.",
					},
					sourceMappings: [
						{
							path: "event_msg/exec_command_end.parsed_cmd[].type",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"ParsedCommand's tag (read, search, list_files, unknown) is Codex's own classification of each command part, with its cmd text and (for reads) name. Witness: 019d0073:657 event_msg/item_completed:CommandExecution.parsed_cmd[].type [string] n=210301 v0.107.0..0.162.0-alpha.2 values={'unknown': 101047, 'read': 76732, 'search': 26355, 'list_files': 6167}",
						},
						{
							path: "event_msg/exec_command_end.parsed_cmd[].cmd",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"ParsedCommand's tag (read, search, list_files, unknown) is Codex's own classification of each command part, with its cmd text and (for reads) name. Witness: 019d0073:657 event_msg/item_completed:CommandExecution.parsed_cmd[].type [string] n=210301 v0.107.0..0.162.0-alpha.2 values={'unknown': 101047, 'read': 76732, 'search': 26355, 'list_files': 6167}",
						},
						{
							path: "event_msg/exec_command_end.parsed_cmd[].name",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"ParsedCommand's tag (read, search, list_files, unknown) is Codex's own classification of each command part, with its cmd text and (for reads) name. Witness: 019d0073:657 event_msg/item_completed:CommandExecution.parsed_cmd[].type [string] n=210301 v0.107.0..0.162.0-alpha.2 values={'unknown': 101047, 'read': 76732, 'search': 26355, 'list_files': 6167}",
						},
					],
					relation: { kind: "exact" },
					justification:
						"ParsedCommand's tag (read, search, list_files, unknown) is Codex's own classification of each command part, with its cmd text and (for reads) name. Witness: 019d0073:657 event_msg/item_completed:CommandExecution.parsed_cmd[].type [string] n=210301 v0.107.0..0.162.0-alpha.2 values={'unknown': 101047, 'read': 76732, 'search': 26355, 'list_files': 6167}",
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
					evidence: [],
					relation: { kind: "exact" },
					legacySources: ["event_msg/exec_command_end.parsed_cmd[].path"],
					gap: {
						sources: ["event_msg/exec_command_end.parsed_cmd[].path"],
						plan: "parser 9: read `exec_command_end` events of older versions too.",
					},
					notes:
						"Parser review: codexItemFacts filters parsed_cmd to type=read AND a nonempty string path before storing the capped list; search/list/null paths are excluded.",
					sourceMappings: [
						{
							path: "event_msg/exec_command_end.parsed_cmd[].path",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"record-facts.ts:240 filters type=read and nonempty string path; search/list/null paths are excluded. Reviewer witness: 109,770 parsed path values before filtering.",
						},
					],
					justification:
						"record-facts.ts:240 filters type=read and nonempty string path; search/list/null paths are excluded. Reviewer witness: 109,770 parsed path values before filtering.",
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
				"parser 9: keep each record's `cwd` (it changes within 55 local sessions). Review constraint: Separate session/message context, background hints and actual call cwd; a shell command may cd internally.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Stored per session only today. Parser review: No parser value is stored for this pending proposal. Separate session/message context, background hints and actual call cwd; a shell command may cd internally.",
					sourceMappings: [
						{
							path: "user.toolUseResult.backgroundCwdHint",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "attachment/environment.attachment.snapshot.workingDirectory",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "assistant.wireIngestContext.{*}.cwd",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Every Claude record has a session-level cwd, which is where the session stood when the line was written, not necessarily the directory the shell call ran in (wireIngestContext.cwd and the 'cd' prefix of the wire input show the real one for Bash). Witness: 49ead9e1:3 *.cwd [string] n=139715 v2.1.220..2.1.293",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CommandExecution.cwd",
					"event_msg/exec_command_end.cwd",
					"response_item/local_shell_call.action.working_directory",
					"response_item/function_call:exec_command.arguments.workdir",
					"turn_context/.cwd",
					"session_meta/.cwd",
					"event_msg/thread_settings_applied.thread_settings.cwd",
					"world_state/.state.environments.environments.local.cwd",
				],
				"parser 9: keep the requested `workdir` and the completion's `cwd` apart (requested vs where it ran). Review constraint: Sources mix per-call cwd (CommandExecution.cwd), a requested workdir, and turn/session cwd; only the first is 'where the call ran'.",
				{
					relation: {
						kind: "transform",
						transform: "Decode PathUri file: URI to a filesystem path.",
					},
					legacySources: ["event_msg/exec_command_end.cwd"],
					notes:
						"Stored per session only today. Parser review: No parser value is stored for this pending proposal. Sources mix per-call cwd (CommandExecution.cwd), a requested workdir, and turn/session cwd; only the first is 'where the call ran'. Residue path response_item/local_shell_call.action.working_directory is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"CommandExecution.cwd (210,499) is where the command ran, but every value is a file: URI (PathUri, 210,540 of 210,540), not a plain path. exec_command_end.cwd (65, legacy) is the same fact. local_shell_call.action.working_directory is the requested directory (a call parameter, models.rs:1949), and no such record exists locally. Mixed ran-in and requested semantics, plus a URI representation, so close; the per-call cwd is not stored today (session cwd only).",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/cwd/codex",
							explanation:
								"CommandExecution.cwd (210,499) is where the command ran, but every value is a file: URI (PathUri, 210,540 of 210,540), not a plain path. exec_command_end.cwd (65, legacy) is the same fact. local_shell_call.action.working_directory is the requested directory (a call parameter, models.rs:1949), and no such record exists locally. Mixed ran-in and requested semantics, plus a URI representation, so close; the per-call cwd is not stored today (session cwd only).",
						},
					],
					sourceMappings: [
						{
							path: "response_item/function_call:exec_command.arguments.workdir",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "turn_context/.cwd",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "session_meta/.cwd",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "event_msg/thread_settings_applied.thread_settings.cwd",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "world_state/.state.environments.environments.local.cwd",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
				},
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
				"parser 9: keep each record's `gitBranch` (it changes within 53 local sessions). Review constraint: Scope this to the recorded message branch snapshot, not a guaranteed branch checked out throughout a call.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Stored per session only today. Parser review: No parser value is stored for this pending proposal. Scope this to the recorded message branch snapshot, not a guaranteed branch checked out throughout a call.",
					justification:
						"gitBranch is a snapshot on every Claude record at write time (it changes within 53 of 305 local sessions), not a property recorded by the call. Witness: 49ead9e1:3 *.gitBranch [string] n=139715 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no branch per turn or call; session_meta records it once per session.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no branch per turn or call; session_meta records it once per session.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/git_branch",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The git branch checked out when the call ran. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no branch per turn or call; session_meta records it once per session. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
					sources: ["session_meta/.git.branch"],
				},
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
				"parser 9: keep the wire input by call id beside the requested input (6,051 of 27,313 calls differ locally).",
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"assistant.wireToolInputs holds, keyed by tool_use id, the input as sent; for Bash it differs from the model's input by a 'cd <dir> &&' prefix in 5332 of 5333 differing calls (5923 of 29243 differ overall). Witness: 49ead9e1:22 assistant.wireToolInputs.{*} [object] n=29166 v2.1.280..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): Codex records only one input per call.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): Codex records only one input per call.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#calls/wire_input",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:244, codex-rs/core/src/tools/handlers/unified_exec.rs:29, codex-rs/protocol/src/items.rs:90. Checked the 0.162.0 durable schema/policy and candidate paths for The tool input as the harness actually sent it, when it differs from what the model asked for (for example with a `cd` prepended). Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): Codex records only one input per call. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
				"parser 9: keep the requested sandbox bypass. Review constraint: Claude has no 'why' for the escalation; the fact definition includes a reason.",
				{
					relation: {
						kind: "narrower",
					},
					notes:
						"`dangerouslyDisableSandbox` appears on 2 local shell calls, both `false`; no call asked to bypass the sandbox. Parser review: No parser value is stored for this pending proposal. Claude has no 'why' for the escalation; the fact definition includes a reason.",
					justification:
						"dangerouslyDisableSandbox is documented as 'Set this to true to dangerously override sandbox mode and run commands without sandboxing' (sdk-tools.d.ts:830-833), i.e. exactly the 'asked to run outside the sandbox' half of the fact. Claude records no reason with it, so the source covers less than the fact (flag + why). Locally it appears on 2 shell calls, both false (first witness agent-ae45ba2520c4de21a:34), so no escalation has been observed.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/sandbox_escalation/claude_code",
							explanation:
								"dangerouslyDisableSandbox is documented as 'Set this to true to dangerously override sandbox mode and run commands without sandboxing' (sdk-tools.d.ts:830-833), i.e. exactly the 'asked to run outside the sandbox' half of the fact. Claude records no reason with it, so the source covers less than the fact (flag + why). Locally it appears on 2 shell calls, both false (first witness agent-ae45ba2520c4de21a:34), so no escalation has been observed.",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Bash].input.dangerouslyDisableSandbox",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:833 (BashInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"Set this to true to dangerously override sandbox mode and run commands without sandboxing.",
						},
					],
				},
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.sandbox_permissions",
					"response_item/function_call:exec_command.arguments.justification",
				],
				"parser 9: keep the requested escalation and its justification (about 550 calls locally). Review constraint: with_additional_permissions is a widening inside the sandbox, not an escape; the additional_permissions object (residue) carries those details.",
				{
					evidence: [],
					relation: { kind: "exact" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. with_additional_permissions is a widening inside the sandbox, not an escape; the additional_permissions object (residue) carries those details.",
					justification:
						"exec_command.sandbox_permissions=require_escalated is the model's request to run outside the sandbox and justification is its stated reason (553 local calls, all require_escalated). Witness: 019d30dc:24 response_item/function_call:exec_command.arguments.sandbox_permissions [string] n=555 v0.105.0..0.147.0-alpha.1.2",
				},
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
				"parser 9: keep the decision, its source and reason on the call's result (about 4,700 records locally).",
				{
					evidence: [],
					notes:
						"A recorded decision; it does not say a dialog was shown. Locally almost all are automatic: about 4,700 `accept` by `config` (`reasonType: mode`, sessions in `bypassPermissions` mode), 17 `reject` by a hook, and 5 `accept` by the user (`user_temporary`); a person's refusal is denial_kind `user-rejected` (3) or `cancelled` (5).",
					relation: { kind: "exact" },
					justification:
						"permissionDecision on the tool_result records gives decision (accept/reject), source (config/hook/user_temporary) and reasonType (mode/hook), exactly the decision and who made it (2.1.293 only). Witness: 06b5ee0c:26 user.permissionDecision.decision [string] n=6471 v2.1.293..2.1.293 values={'accept': 6449, 'reject': 22}",
				},
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.prefix_rule[]",
					"world_state/.state.permissions.approved_command_prefixes[][]",
					"event_msg/item_completed:FileChange.auto_approved",
				],
				"parser 9: keep the requested prefix rule of a call and the approved prefixes in force. Review constraint: Neither source is a decision; Codex rollouts persist no per-call accept/reject (a rejection appears only as `Rejected(` output text, see denial_kind).",
				{
					relation: {
						kind: "narrower",
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. Neither source is a decision; Codex rollouts persist no per-call accept/reject (a rejection appears only as `Rejected(` output text, see denial_kind). Residue path event_msg/item_completed:FileChange.auto_approved is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"No Codex source is a per-call accept/reject with its decider. The approval requests (ExecApprovalRequest, RequestPermissions, ApplyPatchApprovalRequest) are transient events, never persisted (rollout/src/policy.rs:195-199). prefix_rule[] (450) is the model's proposed standing rule and world_state approved_command_prefixes is state, neither a decision. The only decision-bearing source is FileChange.auto_approved (an Option<bool>, items.rs:417-419), which is narrower: accepted by configuration, patches only; it does not occur in the local FileChange items (54,983 items, 0 with auto_approved).",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/permission_decision/codex",
							explanation:
								"No Codex source is a per-call accept/reject with its decider. The approval requests (ExecApprovalRequest, RequestPermissions, ApplyPatchApprovalRequest) are transient events, never persisted (rollout/src/policy.rs:195-199). prefix_rule[] (450) is the model's proposed standing rule and world_state approved_command_prefixes is state, neither a decision. The only decision-bearing source is FileChange.auto_approved (an Option<bool>, items.rs:417-419), which is narrower: accepted by configuration, patches only; it does not occur in the local FileChange items (54,983 items, 0 with auto_approved).",
						},
					],
				},
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
				"parser 9: in a reviewer thread, keep the final verdict's `outcome`, `risk_level` and `user_authorization` as recorded (about 3,900 locally: 3,907 `allow`, 41 `deny`). Review constraint: 'On a requested action' cannot be joined: the reviewed session is named only in the reviewer's prompt text; thread_source=guardian_review exists only in the 308 newer reviewer threads.",
				{
					relation: {
						kind: "close",
					},
					notes:
						"A reviewer thread is its own rollout: `source.subagent.other: guardian` marks all 372 locally, `thread_source: guardian_review` only the 303 newer ones. The reviewed session is named only in the reviewer's prompt text (`Reviewed Codex session id`, 307 of 372 locally); the parent thread's outputs carry no verdict. Parser review: No parser value is stored for this pending proposal. 'On a requested action' cannot be joined: the reviewed session is named only in the reviewer's prompt text; thread_source=guardian_review exists only in the 308 newer reviewer threads.",
					justification:
						"The reviewer thread's final assistant message holds the verdict (outcome allow 3,907 / deny 41 per the entry notes; 3,953 matching output_text messages), so the convention path is a transform of the literal verdict. thread_source=guardian_review (311 session_meta) and source.subagent.other (380) only mark which threads are reviewers. The verdict cannot be joined to the reviewed call: the reviewed session is named only inside the reviewer's prompt text.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/auto_review_decision/codex",
							explanation:
								"The reviewer thread's final assistant message holds the verdict (outcome allow 3,907 / deny 41 per the entry notes; 3,953 matching output_text messages), so the convention path is a transform of the literal verdict. thread_source=guardian_review (311 session_meta) and source.subagent.other (380) only mark which threads are reviewers. The verdict cannot be joined to the reviewed call: the reviewed session is named only inside the reviewer's prompt text.",
						},
					],
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
					"event_msg/mcp_tool_call_end.app_name",
					"event_msg/mcp_tool_call_end.connector_id",
					"response_item/custom_tool_call:*.namespace",
					"event_msg/item_completed:FunctionCallOutput.namespace",
					"response_item/function_call_output.namespace",
					"event_msg/mcp_tool_call_end.action_name",
					"event_msg/item_completed:McpToolCall.actionName",
				],
				"parser 9: keep the namespace beside the tool name (about 26,000 calls locally); the git extractor then matches connector pull-request tools by namespace and name. Review constraint: Keep actionName separate from namespace/app identity and preserve each identifier’s provenance.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/tool_namespace/codex",
							explanation:
								"function_call.namespace (25,559 calls over 48 tool paths, e.g. js, send_message, uidotsh_fetch, wait_agent) and DynamicToolCall.namespace (183) are literally the tool's namespace. McpToolCall.connectorId (2,829) and appName (2,826) are the connector's identifier and display name, i.e. the app the tool belongs to but not a namespace string; actionName (2,826) is the action, not a namespace. So the fact's 'app or namespace' is exact for two sources and close for the connector ones.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:FunctionCallOutput.namespace; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:FunctionCallOutput.namespace: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call_output.namespace; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call_output.namespace: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/tool_namespace/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Keep actionName separate from namespace/app identity and preserve each identifier’s provenance. Residue path event_msg/mcp_tool_call_end.action_name is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/mcp_tool_call_end.app_name is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/mcp_tool_call_end.connector_id is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path response_item/custom_tool_call:*.namespace is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"Judge round 3: Function/dynamic namespace is the literal namespace. MCP connectorId identifies the connector while appName is its display name. All describe affiliation, but identifier, namespace, and display-name components are not interchangeable units. actionName is CONTEXT and does not invalidate the namespace primary by itself.",
					sourceMappings: [
						{
							path: "event_msg/mcp_tool_call_end.action_name",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Independent map_existing agreement; never seen locally. Legacy MCP completion records connector/app/action attribution; retain connector/app as namespace and action_name as a distinct action label.",
						},
						{
							path: "event_msg/item_completed:McpToolCall.actionName",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
				},
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
					"event_msg/image_generation_end.saved_path",
					"event_msg/item_completed:ImageGeneration.saved_path",
				],
				"parser 9: keep the kind, a sleep's requested duration and a generated image's saved path (374 sleeps, 4 images locally); web searches are already calls.",
				{
					notes:
						"A sleep's duration is what was asked for, not measured time. Residue path event_msg/image_generation_end.saved_path is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/item_completed:ImageGeneration.saved_path is recorded but unparsed; no local witness and no semantic verification is claimed.",
					relation: {
						kind: "close",
					},
					justification:
						"Extension.kind is a different thing than the fact's two actions: values web.search 4,429, clock.sleep 374, image_gen.generation 4 (92% are web searches, which the fact excludes because searches are already calls). durationMs (374) is the sleep length that was asked for, savedPath (4) is where a generated image was saved (exact). So exact for the two named actions, but the kind source is broader than the fact.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#calls/extension_item/codex",
							explanation:
								"Extension.kind is a different thing than the fact's two actions: values web.search 4,429, clock.sleep 374, image_gen.generation 4 (92% are web searches, which the fact excludes because searches are already calls). durationMs (374) is the sleep length that was asked for, savedPath (4) is where a generated image was saved (exact). So exact for the two named actions, but the kind source is broader than the fact.",
						},
					],
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
					"attachment/queued_command.attachment.prompt[].source.media_type",
					"attachment/queued_command.attachment.prompt[].source.type",
					"attachment/queued_command.attachment.prompt[].type",
				],
				{ since: 5, record: ["text"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/image_input/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					gap: {
						sources: [
							"user.imagePasteIds[]",
							"attachment/queued_command.attachment.prompt[].source.media_type",
							"attachment/queued_command.attachment.prompt[].source.type",
							"attachment/queued_command.attachment.prompt[].type",
						],
						plan: "parser 9: a prompt with text and images keeps the image labels it drops today.",
					},
					testedIn:
						"packages/api-routes/src/session-transcript/transcript-records/split-transcript.test.ts",
					notes:
						"An image-only prompt is stored as `[image attachment]` or its screenshot marker.",
					sourceMappings: [
						{
							path: "user.imagePasteIds[]",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"A base64 image block in a user message carries source.type and source.media_type, which gives the image's presence and type without storing bytes (3 local prompts, 2.1.293). Witness: 06b5ee0c:4 user.message.content[image].source.media_type [string] n=3 v2.1.293..2.1.293",
						},
					],
					relation: { kind: "exact" },
					justification:
						"A base64 image block in a user message carries source.type and source.media_type, which gives the image's presence and type without storing bytes (3 local prompts, 2.1.293). Witness: 06b5ee0c:4 user.message.content[image].source.media_type [string] n=3 v2.1.293..2.1.293",
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
					"event_msg/item_completed:UserMessage.content[image].detail",
					"event_msg/item_completed:UserMessage.content[local_image].detail",
					"event_msg/user_message.local_images[]",
					"event_msg/user_message.file_id_details",
					"event_msg/user_message.file_ids",
					"event_msg/user_message.image_details",
					"event_msg/user_message.local_image_details",
					"event_msg/item_completed:UserMessage.content[image].file_id",
					"event_msg/user_message.image_details[]",
					"event_msg/user_message.local_image_details[]",
					"response_item/message:*.content[input_image].file_id",
				],
				"parser 9: keep image presence and source on the prompt; image-only messages are stored as empty today. Review constraint: Store only image presence/type/detail as intended; image_url can contain inline data and must not become a stored byte payload.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#prompts/image_input/codex",
							explanation:
								"The sources carry the image itself or its reference: input_image.image_url is a base64 data URL in 176 of 176 response items (png 175, jpeg 1), detail is present on 59 (high) and absent on 117, and the event forms carry image URLs, local paths and file ids. The fact keeps presence and type only, never bytes, so the source includes the fact; type is recoverable only from the data-URL prefix, detail is literal. Tools also write images into user-role messages, so role alone does not make it a person's attachment.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/user_message.file_id_details; judge2/sonnet/residue.json",
							explanation:
								"event_msg/user_message.file_id_details: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/user_message.file_ids; judge2/sonnet/residue.json",
							explanation:
								"event_msg/user_message.file_ids: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/user_message.image_details; judge2/sonnet/residue.json",
							explanation:
								"event_msg/user_message.image_details: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/user_message.local_image_details; judge2/sonnet/residue.json",
							explanation:
								"event_msg/user_message.local_image_details: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/image_input/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "broader" },
					notes:
						"Tools also put images into user-role messages; not every one is a person's. Parser review: No parser value is stored for this pending proposal. Store only image presence/type/detail as intended; image_url can contain inline data and must not become a stored byte payload. Residue path event_msg/item_completed:UserMessage.content[image].detail is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/item_completed:UserMessage.content[image].file_id is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/item_completed:UserMessage.content[local_image].detail is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/user_message.image_details[] is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/user_message.local_image_details[] is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/user_message.local_images[] is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path response_item/message:*.content[input_image].file_id is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"Judge round 3: The sources carry the image itself or a reference to it, not just presence and type: message input_image.image_url is a data URL or remote URL (176 values, 148 distinct), local_image.path is a file path (42), UserMessage image_url 42, event user_message.images[] 80. The fact keeps only presence, type and detail, so each source is wider than the meaning. Tool-injected images also arrive as user-role messages.",
					sourceMappings: [
						{
							path: "event_msg/item_completed:UserMessage.content[image].file_id",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Independent map_existing agreement; never seen locally. User image/local-image detail or file-backed image reference explicitly identifies attached image input; store presence/type/detail, not media bytes.",
						},
						{
							path: "event_msg/user_message.image_details[]",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Independent map_existing agreement; never seen locally. Image detail arrays or local-image references are legacy representations of explicit attached image input.",
						},
						{
							path: "event_msg/user_message.local_image_details[]",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Independent map_existing agreement; never seen locally. Image detail arrays or local-image references are legacy representations of explicit attached image input.",
						},
						{
							path: "response_item/message:*.content[input_image].file_id",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Independent map_existing agreement; never seen locally. A user-role input-image file_id is an explicit file-backed image attachment; on non-user roles it is not prompt image input.",
						},
					],
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
				{
					relation: { kind: "close" },
					justification:
						"Record timestamps mark individual messages, not literal run boundaries or active minutes; run_index derives the grouped interval.",
					testedIn: RUN_INDEX_TEST,
				},
			),
			codex: stored(
				["*@timestamp"],
				{ elsewhere: RUN_INDEX },
				{
					relation: { kind: "close" },
					justification:
						"Outer rollout timestamps mark records; deriving run boundaries differs from the literal task start/end fields still listed as gaps.",

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
			claude_code: stored(
				["user.toolUseResult.durationMs", "user.toolUseResult.durationSeconds"],
				{
					since: 6,
					facts: ["durationMs"],
				},
				{
					relation: {
						kind: "transform",
						transform: "durationMs preserved; durationSeconds × 1000 → ms",
					},
					justification:
						"Local a1f1ca64:278 (2.1.220) writes durationMs = 5068; 4ecc4daf:245 (2.1.284) writes durationSeconds = 5.89137666700012.",
					notes:
						"Only some tools record it (web fetch and search, a few others); shell results record none.",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.durationMs",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3492 (GlobOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Time taken to execute the search in milliseconds",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.durationMs",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3718 (WebFetchOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Time taken to fetch and process the content",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.durationSeconds",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3762 (WebSearchOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Time taken to complete the search operation",
						},
					],
				},
			),
			codex: stored(
				[
					"event_msg/task_complete.duration_ms",
					"event_msg/turn_aborted.duration_ms",
				],
				{ since: 7, facts: ["durationMs"] },

				{
					relation: { kind: "exact" },
					justification:
						"protocol.rs:2195/4272 documents duration_ms as milliseconds between turn start and completion/abort, exactly the run-duration definition.",
					evidence: [
						semanticWriter(
							"event_msg/task_complete.duration_ms",
							"protocol/src/protocol.rs",
							2195,
							"The doc comment explicitly defines duration between turn start and completion in milliseconds, if known.",
						),
						semanticWriter(
							"event_msg/turn_aborted.duration_ms",
							"protocol/src/protocol.rs",
							4272,
							"The doc comment explicitly defines duration between turn start and abort in milliseconds, if known.",
						),
					],
				},
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
			codex: stored(
				["event_msg/task_complete.time_to_first_token_ms"],
				{
					since: 7,
					facts: ["time_to_first_token_ms"],
				},
				{
					relation: { kind: "exact" },
					justification:
						"protocol.rs:2199 documents milliseconds from turn start to the first model token, exactly the model first-answer latency definition.",
					evidence: [
						semanticWriter(
							"event_msg/task_complete.time_to_first_token_ms",
							"protocol/src/protocol.rs",
							2199,
							"The doc comment explicitly defines duration between turn start and the first model token in milliseconds, if known.",
						),
					],
				},
			),
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
					evidence: [],
					relation: { kind: "exact" },
					gap: {
						sources: ["permission-mode.permissionMode"],
						plan: "parser 9: keep mid-session `permission-mode` records too.",
					},
					notes:
						"Parser review: claudePromptFacts reads user.permissionMode only; permission-mode records, including auto, remain a gap.",
					sourceMappings: [
						{
							path: "permission-mode.permissionMode",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"user.permissionMode is the permission mode in force at the prompt, with the names default/plan/acceptEdits/bypassPermissions the fact lists; separate permission-mode records add 'auto'. Witness: 49ead9e1:3 user.permissionMode [string] n=2375 v2.1.220..2.1.293 values={'bypassPermissions': 2358, 'default': 13, 'plan': 2, 'acceptEdits': 2}",
						},
					],
					justification:
						"user.permissionMode is the permission mode in force at the prompt, with the names default/plan/acceptEdits/bypassPermissions the fact lists; separate permission-mode records add 'auto'. Witness: 49ead9e1:3 user.permissionMode [string] n=2375 v2.1.220..2.1.293 values={'bypassPermissions': 2358, 'default': 13, 'plan': 2, 'acceptEdits': 2}",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no permission mode; Codex records approval_policy and sandbox_policy instead.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no permission mode; Codex records approval_policy and sandbox_policy instead.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/permission_mode",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for The permission mode the run used (default, plan, accept edits, bypass). Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no permission mode; Codex records approval_policy and sandbox_policy instead. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"The auto_mode attachment holds the auto-mode settings flags (bashFirst, bypass, steerOnly, autoModeConsentFlow) and bashFirstSteer text (276 local). Witness: 49ead9e1:9 attachment/auto_mode.attachment.bashFirst [boolean] n=276 v2.1.257..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no auto mode.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no auto mode.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/auto_mode_*",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for The settings of Claude Code's auto mode for the run. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no auto mode. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
				"parser 9: keep the mode label and a plan-mode attachment's plan file as recorded; no equivalence with Codex modes. Review constraint: mode.mode has one value locally ('normal'), so its meaning is not witnessed; planFilePath is a file path, not a mode label.",
				{
					evidence: [],
					relation: { kind: "exact" },
					notes:
						"Always `normal` in the local transcripts. Parser review: No parser value is stored for this pending proposal. mode.mode has one value locally ('normal'), so its meaning is not witnessed; planFilePath is a file path, not a mode label.",
					sourceMappings: [
						{
							path: "attachment/plan_mode.attachment.planFilePath",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"mode.mode is the primary mode label; only normal is witnessed locally. planFilePath is context; no semantic writer/type authority, so confidence stays observed.",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such label; see collaboration_mode.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such label; see collaboration_mode.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/mode",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for A mode label Claude Code records separately from the permission mode. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no such label; see collaboration_mode. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
					evidence: [],
					relation: { kind: "exact" },
					gap: {
						sources: [
							"event_msg/thread_settings_applied.thread_settings.approval_policy",
							"turn_context/.approval_policy.granular.mcp_elicitations",
							"turn_context/.approval_policy.granular.request_permissions",
							"turn_context/.approval_policy.granular.rules",
							"turn_context/.approval_policy.granular.sandbox_approval",
							"turn_context/.approval_policy.granular.skill_approval",
						],
						plan: "parser 9: keep thread settings changes with their time.",
					},
					notes:
						"Parser review: codexTurnContextFacts setText reads a string policy only; granular object policies remain an unparsed gap and must not be treated as never/on-request. Residue path turn_context/.approval_policy.granular.mcp_elicitations is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path turn_context/.approval_policy.granular.request_permissions is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path turn_context/.approval_policy.granular.rules is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path turn_context/.approval_policy.granular.sandbox_approval is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path turn_context/.approval_policy.granular.skill_approval is recorded but unparsed; no local witness and no semantic verification is claimed.",
					sourceMappings: [
						{
							path: "event_msg/thread_settings_applied.thread_settings.approval_policy",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"TurnContext.approval_policy is the policy for when to ask (never, on-request, untrusted, or a granular object). Witness: 019cb44a:8 turn_context/.approval_policy [string] n=42553 v0.100.0..0.162.0-alpha.2 values={'never': 39551, 'on-request': 3001, 'untrusted': 1}",
						},
					],
					justification:
						"TurnContext.approval_policy is the policy for when to ask (never, on-request, untrusted, or a granular object). Witness: 019cb44a:8 turn_context/.approval_policy [string] n=42553 v0.100.0..0.162.0-alpha.2 values={'never': 39551, 'on-request': 3001, 'untrusted': 1}",
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
					evidence: [],
					gap: {
						sources: [
							"event_msg/thread_settings_applied.thread_settings.approvals_reviewer",
						],
						plan: "parser 9: keep thread settings changes with their time.",
					},
					sourceMappings: [
						{
							path: "event_msg/thread_settings_applied.thread_settings.approvals_reviewer",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"TurnContext.approvals_reviewer names who reviews approvals (user or auto_review). Witness: 019e4ef4:105 turn_context/.approvals_reviewer [string] n=13644 v0.130.0..0.162.0-alpha.2 values={'user': 7361, 'auto_review': 6283}",
						},
					],
					relation: { kind: "exact" },
					justification:
						"TurnContext.approvals_reviewer names who reviews approvals (user or auto_review). Witness: 019e4ef4:105 turn_context/.approvals_reviewer [string] n=13644 v0.130.0..0.162.0-alpha.2 values={'user': 7361, 'auto_review': 6283}",
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
					"turn_context/.file_system_sandbox_policy.entries[].access",
					"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].access",
					"event_msg/thread_settings_applied.thread_settings.permission_profile.network",
					"turn_context/.permission_profile.file_system.entries[].access",
					"turn_context/.permission_profile.network",
				],
				{ since: 7, facts: ["sandbox_policy", "sandbox_network_access"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#turn_context/.sandbox_policy.network-access; judge2/sonnet/residue.json",
							explanation:
								"turn_context/.sandbox_policy.network_access n=3143 files=550 type boolean v0.105.0..0.162.0-alpha.2",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/sandbox_policy/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/sandbox_policy/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					notes:
						"Parser review: codexTurnContextFacts reads the turn baseline sandbox type/network_access; per-command permission overrides are not effective sandbox measurements.",
					justification:
						"Judge round 3: The fact bundles the sandbox kind and whether network was allowed. sandbox_policy.type is the sandbox kind (danger-full-access 34,857, read-only 4,572, workspace-write 3,146), network_access the network flag (only present on workspace-write: 3,146; false 3,112, true 34), entries[].access the filesystem access entries (81,444; read 70,407, write 11,037). Each source supplies one component.",
					gap: {
						sources: [
							"turn_context/.sandbox_policy.network_access",
							"turn_context/.file_system_sandbox_policy.entries[].access",
							"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].access",
							"event_msg/thread_settings_applied.thread_settings.permission_profile.network",
							"turn_context/.permission_profile.file_system.entries[].access",
							"turn_context/.permission_profile.network",
						],
						plan: "parser 9: preserve the literal turn_context/.file_system_sandbox_policy.entries[].access with its existing sandbox_policy meaning and provenance.",
					},
				},
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
			codex: wrong(
				[
					"turn_context/.permission_profile.type",
					"event_msg/thread_settings_applied.thread_settings.active_permission_profile.id",
				],
				{ since: 7, facts: ["permission_profile"] },
				"parser 9: Store permission_profile.type as permission_profile_kind and active_permission_profile.id (and extends) as permission_profile; or reword the fact to the kind. Evidence: Real parser over 42,572 turn_context records: stored values are only 'managed' (9,444) and 'disabled' (14,490), 23,934 in all; the named profile active_permission_profile.id exists on 1,947 turns (':workspace' 1,946, 'danger-full-access' 1; first rollout-2026-08-12T07-33-52-019ff476:1620) and is never stored.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#runs/permission_profile/codex",
							explanation:
								"Real parser over 42,572 turn_context records: stored values are only 'managed' (9,444) and 'disabled' (14,490), 23,934 in all; the named profile active_permission_profile.id exists on 1,947 turns (':workspace' 1,946, 'danger-full-access' 1; first rollout-2026-08-12T07-33-52-019ff476:1620) and is never stored.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/permission_profile/codex",
							explanation:
								"turn_context permission_profile.type is the profile kind (managed 9,444, disabled 14,490; 23,934 turns), not its name; the name is active_permission_profile.id, present on only 1,947 turns (':workspace' 1,946, 'danger-full-access' 1). The listed primary source answers a different question (what kind of profile) than 'the named profile the run used'; the parser stores the kind under the name permission_profile.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/permission_profile/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "unreviewed" },
					notes:
						"Parser review: parser 9: retain permission_profile.type as profile_kind and active_permission_profile.id separately as the named profile; never substitute the kind for the id. Data witness: 23919 type-bearing turn profiles vs 1939 named active profile IDs (fresh scan); kind and name are distinct fields. Data witness: 23919 type-bearing turn profiles vs 1939 named active profile IDs (fresh scan); kind and name are distinct fields.",
					justification:
						"turn_context permission_profile.type is the profile kind (managed 9,444, disabled 14,490; 23,934 turns), not its name; the name is active_permission_profile.id, present on only 1,947 turns (':workspace' 1,946, 'danger-full-access' 1). The listed primary source answers a different question (what kind of profile) than 'the named profile the run used'; the parser stores the kind under the name permission_profile.",
					gap: {
						sources: [
							"turn_context/.active_permission_profile.id",
							"event_msg/thread_settings_applied.thread_settings.permission_profile.type",
							"event_msg/thread_settings_applied.thread_settings.active_permission_profile.id",
						],
						plan: "parser 9: retain permission_profile.type as profile_kind and active_permission_profile.id separately as the named profile; never substitute the kind for the id.",
					},
					sourceMappings: [
						{
							path: "turn_context/.permission_profile.type",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"turn_context permission_profile.type is the profile kind (managed 9,444, disabled 14,490; 23,934 turns), not its name; the name is active_permission_profile.id, present on only 1,947 turns (':workspace' 1,946, 'danger-full-access' 1). The listed primary source answers a different question (what kind of profile) than 'the named profile the run used'; the parser stores the kind under the name permission_profile.",
						},
						{
							path: "turn_context/.active_permission_profile.id",
							role: "primary",
							relation: { kind: "unreviewed" },
							justification:
								"Recorded gap; not extracted by the current parser.",
						},
						{
							path: "event_msg/thread_settings_applied.thread_settings.permission_profile.type",
							role: "primary",
							relation: { kind: "unreviewed" },
							justification:
								"Recorded gap; not extracted by the current parser.",
						},
						{
							path: "event_msg/thread_settings_applied.thread_settings.active_permission_profile.id",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Judge round 3 agreed_map: The named permission profile the run used. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
						},
					],
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
					"world_state/.state.collaboration_mode",
					"world_state/.state.collaboration_mode.mode",
				],
				{ since: 7, facts: ["collaboration_mode"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/collaboration_mode/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"collaboration_mode.mode and task_started.collaboration_mode_kind both hold the mode (default or plan). Witness: 019cb44a:8 turn_context/.collaboration_mode.mode [string] n=42553 v0.100.0..0.162.0-alpha.2 values={'default': 41873, 'plan': 680}",
					gap: {
						sources: [
							"world_state/.state.collaboration_mode",
							"world_state/.state.collaboration_mode.mode",
						],
						plan: "parser 9: preserve newly mapped literal fields with call/record provenance and distinct component names/units; never infer values from prose.",
					},
				},
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
					relation: { kind: "close" },
					justification:
						"Local Claude 2.1.284 49ead9e1:21 records response model claude-opus-5-5; configured attachment identity is a different, still unread source.",
					conflict:
						"Claude response model and Codex turn-configured model do not establish the same actual model identity.",

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
					relation: { kind: "close" },
					justification:
						"turn_context model is configured for the turn, not proof of which model answered; thread-setting/model-switch sources remain gaps.",
					conflict:
						"Claude response model and Codex turn-configured model do not establish the same actual model identity.",

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
			claude_code: stored(
				["assistant.effort", "assistant.perTurnEffort"],
				{
					since: 7,
					facts: ["effort", "per_turn_effort"],
				},
				{
					relation: { kind: "close" },
					justification:
						"Local Claude 2.1.284 49ead9e1:21 writes effort = high; perTurnEffort is a second level and has not been proved equivalent.",
				},
			),
			codex: stored(
				[
					"turn_context/.effort",
					"event_msg/thread_settings_applied.thread_settings.collaboration_mode.settings.reasoning_effort",
				],
				{ since: 7, facts: ["effort"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/effort/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "unreviewed" },
					justification:
						"turn_context effort is turn configuration; thread-setting and collaboration-mode values remain unread and may override it.",
					gap: {
						sources: [
							"event_msg/thread_settings_applied.thread_settings.reasoning_effort",
							"turn_context/.collaboration_mode.settings.reasoning_effort",
							"response_item/configuration_update.reasoning.effort",
							"event_msg/thread_settings_applied.thread_settings.collaboration_mode.settings.reasoning_effort",
						],
						plan: "parser 9: keep thread settings changes with their time.",
					},
					notes:
						"Residue path response_item/configuration_update.reasoning.effort is recorded but unparsed; no local witness and no semantic verification is claimed.",
					sourceMappings: [
						{
							path: "turn_context/.effort",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"turn_context effort is turn configuration; thread-setting and collaboration-mode values remain unread and may override it.",
						},
						{
							path: "event_msg/thread_settings_applied.thread_settings.reasoning_effort",
							role: "primary",
							relation: { kind: "unreviewed" },
							justification:
								"Recorded gap; not extracted by the current parser.",
						},
						{
							path: "turn_context/.collaboration_mode.settings.reasoning_effort",
							role: "primary",
							relation: { kind: "unreviewed" },
							justification:
								"Recorded gap; not extracted by the current parser.",
						},
						{
							path: "response_item/configuration_update.reasoning.effort",
							role: "primary",
							relation: { kind: "unreviewed" },
							justification:
								"Recorded gap; not extracted by the current parser.",
						},
						{
							path: "event_msg/thread_settings_applied.thread_settings.collaboration_mode.settings.reasoning_effort",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Judge round 3 map_vs_map: The reasoning effort the run used. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
						},
					],
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
				"parser 9: keep the recorded advisor model (about 51,000 responses locally, `claude-opus-5-5` or `claude-fable-5-1`) apart from the model that answered.",
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"assistant.advisorModel is the advisor model recorded on each response (claude-opus-5-5 52324, claude-fable-5-1 1854 lines). Witness: 49ead9e1:21 assistant.advisorModel [string] n=54035 v2.1.280..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no advisor model; no key containing `advisor` on any record.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no advisor model; no key containing `advisor` on any record.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/advisor_model",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for The advisor model the agent recorded on a response. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no advisor model; no key containing `advisor` on any record. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				{
					elsewhere:
						"usage_events (packages/usage-events), priced per run in run_index",
				},
				{
					evidence: [],
					relation: { kind: "exact" },
					testedIn: "packages/usage-events/src/extract.test.ts",
					notes:
						"Parser review: usage extraction reads message.usage.service_tier for request pricing; top-level speed is a separate request setting, not a tier alias.",
					sourceMappings: [
						{
							path: "assistant.message.usage.speed",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Judge ruling. usage.service_tier is the tier the request ran at ('standard' on 61046 lines, null on 88); usage.speed is a separate field. Witness: 49ead9e1:21 assistant.message.usage.service_tier [string/null] n=60795 v2.1.220..2.1.293",
				},
			),
			codex: pending(
				["event_msg/thread_settings_applied.thread_settings.service_tier"],
				"usage extraction (packages/usage-events): it reads `token_count.info.service_tier`, which no local record has; read the configured tier instead, marked as configured Review constraint: Codex values are 'default'/'priority' (configured) while Claude's are 'standard' (actual per request); the plan to read token_count.info.service_tier targets a field that no local record has.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Configured for the thread, not recorded per response. Parser review: No parser value is stored for this pending proposal. Codex values are 'default'/'priority' (configured) while Claude's are 'standard' (actual per request); the plan to read token_count.info.service_tier targets a field that no local record has.",
					justification:
						"thread_settings.service_tier is the tier configured for the thread (default or priority), not what a response ran at. Witness: 019e4ef4:100 event_msg/thread_settings_applied.thread_settings.service_tier [string] n=10481 v0.130.0..0.162.0-alpha.2",
				},
			),
		},
	},
	{
		id: "entrypoint",
		view: "runs",
		meaning: "How the agent was started (CLI, IDE, SDK, exec).",
		runIndex: ["entrypoint"],
		agents: {
			claude_code: stored(
				["*.entrypoint"],
				{ since: 6, facts: ["entrypoint"] },
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"Every Claude record carries entrypoint (sdk-ts 139653, sdk-cli 367, cli 10), the way the agent was started. Witness: 49ead9e1:3 *.entrypoint [string] n=139715 v2.1.220..2.1.293",
				},
			),
			codex: stored(
				[
					"session_meta/.originator",
					"session_meta/.source",
					"session_meta/.source.custom",
					"session_meta/.source.internal",
					"session_meta/.source.subagent",
					"session_meta/.thread_source",
				],
				{ since: 6, facts: ["entrypoint"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.source.subagent; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.source.subagent.other n=380; .source.subagent.thread_spawn.depth n=509",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/entrypoint/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					gap: {
						sources: [
							"session_meta/.source",
							"session_meta/.source.custom",
							"session_meta/.source.internal",
							"session_meta/.source.subagent",
							"session_meta/.thread_source",
						],
						plan: "parser 9: retain explicit thread_source entrypoint alongside the older source discriminator.",
					},
					notes:
						"Parser review: readSessionMetadata propagates originator verbatim as the client origin; it does not normalize session_meta.source into CLI/IDE/SDK/exec. Residue path session_meta/.source.custom is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path session_meta/.source.internal is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"Judge round 3: SessionSource distinguishes CLI/IDE/exec and sub-agent/internal/custom origins; originator is an application identity string. Sub-agent source objects add spawning/lineage information, and thread_source is a separately documented analytics classification. Their meanings overlap initiation provenance but are not all the same entrypoint enum.",
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
			claude_code: stored(
				["*.version"],
				{ since: 6, facts: ["agentVersion"] },
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"Every Claude record carries version, the Claude Code version. Witness: 49ead9e1:3 *.version [string] n=139715 v2.1.220..2.1.293",
				},
			),
			codex: stored(
				["session_meta/.cli_version"],
				{
					since: 6,
					facts: ["agentVersion"],
				},
				{
					relation: { kind: "exact" },
					justification:
						"SessionMeta.cli_version is populated from env!(CARGO_PKG_VERSION) by rollout/src/recorder.rs:962, the writer’s actual CLI version.",
					evidence: [
						semanticWriter(
							"session_meta/.cli_version",
							"protocol/src/protocol.rs",
							3180,
							"The writer sets cli_version from env!(CARGO_PKG_VERSION) at rollout/src/recorder.rs:962, rather than inferring it from filenames or timestamps.",
						),
					],
				},
			),
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
				{
					elsewhere:
						"usage_events (packages/usage-events), priced per run in run_index",
				},
				{
					evidence: [],
					relation: { kind: "derived", from: ["runs/request_usage"] },
					testedIn: "packages/usage-events/src/extract.test.ts",
					notes:
						"Parser review: usage extraction groups repeated blocks by request/message identity, then prices literal token vectors; estimated_cost is Opaline-derived, not recorded USD.",
					sourceMappings: [
						{
							path: "assistant.message.id",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "assistant.message.usage.input_tokens",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "assistant.message.usage.output_tokens",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "assistant.message.usage.cache_read_input_tokens",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "assistant.message.usage.cache_creation_input_tokens",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "assistant.message.usage.cache_creation.*",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "assistant.message.usage.inference_geo",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Opaline computation, not an agent-written value. Tokens by kind (input, output, cache read, cache creation) are written, but no per-request cost exists, and usage repeats on every content-block line of a request (61347 lines for 29904 message ids), so sums over lines double count. Witness: 49ead9e1:21 assistant.message.usage.input_tokens [number] n=60795 v2.1.220..2.1.293",
				},
			),
			codex: stored(
				[
					"event_msg/token_count.info.last_token_usage.*",
					"event_msg/token_count.info.total_token_usage.*",
				],
				{
					elsewhere:
						"usage_events (packages/usage-events), priced per run in run_index",
				},
				{
					evidence: [],
					relation: { kind: "derived", from: ["runs/request_usage"] },
					testedIn: "packages/usage-events/src/extract.test.ts",
					notes:
						"Parser review: usage extraction computes nonnegative cumulative token deltas and excludes fork replays before pricing; cost is derived, never a writer USD amount.",
					sourceMappings: [
						{
							path: "event_msg/token_count.info.last_token_usage.*",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "event_msg/token_count.info.total_token_usage.*",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Opaline computation, not an agent-written value. token_count.info gives per-request (last) and cumulative (total) token usage by kind with cached and reasoning subsets, but no cost. Witness: 019cb44a:17 event_msg/token_count.info.last_token_usage.* [number] n=2877422 v0.100.0..0.162.0-alpha.2",
				},
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
					"assistant.message.usage.iterations[].*",
					"assistant.message.usage.iterations[].cache_creation.*",
					"assistant.message.usage.input_tokens",
					"assistant.message.usage.output_tokens",
					"assistant.message.usage.cache_read_input_tokens",
					"assistant.message.usage.cache_creation_input_tokens",
					"system/model_refusal_fallback.requestId",
					"system/model_refusal_no_fallback.requestId",
					"assistant.message.id",
					"assistant.requestId",
				],
				{
					elsewhere:
						"usage_events (packages/usage-events), priced per run in run_index",
				},
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/request_usage/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					testedIn: "packages/usage-events/src/extract.test.ts",
					notes:
						"Parser review: usage extraction groups content-block snapshots by request/message identity and selects token maxima; message/request IDs are context, usage counters are primary.",
					sourceMappings: [
						{
							path: "assistant.message.id",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "assistant.requestId",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Each Claude request is written across several content-block lines that share message.id and requestId and repeat the usage snapshot (identical in 17410 of 21076 multi-line requests), so per-request usage needs grouping by message.id. Witness: 49ead9e1:21 assistant.message.id [string] n=60795 v2.1.220..2.1.293",
					gap: {
						sources: [
							"system/model_refusal_fallback.requestId",
							"system/model_refusal_no_fallback.requestId",
						],
						plan: "parser 9: preserve newly mapped literal fields with call/record provenance and distinct component names/units; never infer values from prose.",
					},
				},
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
				"usage extraction (packages/usage-events): read `token_usage_record` (about 80,000 locally) with its response id; keep request, turn and thread usage apart and never add them to the `token_count` witnesses Review constraint: Only usage plus response_id is per-request usage; keep turn/thread aggregates and root IDs separate.",
				{
					evidence: [],
					relation: { kind: "exact" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Only usage plus response_id is per-request usage; keep turn/thread aggregates and root IDs separate.",
					sourceMappings: [
						{
							path: "token_usage_record/.response_id",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "token_usage_record/.turn_id",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "token_usage_record/.root_turn_id",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "token_usage_record/.turn_token_usage.*",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "token_usage_record/.thread_token_usage.*",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Judge ruling. token_usage_record is written per completed response with response_id, usage (that response) and turn/thread totals ('best-effort Responses API usage observed for one completed response'). Witness: 01a1009d:12 token_usage_record/.response_id [string] n=80526 v0.146.0..0.162.0-alpha.2",
				},
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
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"usage.output_tokens_details.thinking_tokens is the output tokens spent thinking (53062 lines, 2.1.280+), repeated per content-block line like other usage. Witness: 49ead9e1:21 assistant.message.usage.output_tokens_details.thinking_tokens [number] n=53062 v2.1.280..2.1.293",
				},
			),
			codex: stored(
				["event_msg/token_count.info.last_token_usage.reasoning_output_tokens"],
				{
					elsewhere:
						"usage_events (packages/usage-events), priced per run in run_index",
				},
				{
					evidence: [],
					testedIn: "packages/usage-events/src/extract.test.ts",
					relation: { kind: "exact" },
					justification:
						"reasoning_output_tokens is a TokenUsage field, a subset of output_tokens (213712 of 213712 sampled counts satisfy reasoning <= output). Witness: 019cb44a:17 event_msg/token_count.info.last_token_usage.reasoning_output_tokens [number] n=481367 v0.100.0..0.162.0-alpha.2",
				},
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
					"user.toolUseResult.searchCount",
				],
				"parser 9: retain server_tool_requests as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/server_tool_requests/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"usage.server_tool_use.web_search_requests and web_fetch_requests are the provider-run server tool counts (all zero locally). Witness: 49ead9e1:21 assistant.message.usage.server_tool_use.web_search_requests [number] n=55266 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no request counts in token counts or usage records; Codex web searches are calls of their own.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no request counts in token counts or usage records; Codex web searches are calls of their own.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/server_tool_requests",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:2270. Checked the 0.162.0 durable schema/policy and candidate paths for Web searches and fetches the provider ran for a request, which are billed apart from tokens. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no request counts in token counts or usage records; Codex web searches are calls of their own. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				"parser 9: keep the recorded reasoning time (2.1.292 and later).",
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"assistant.thinkingDurationMs sits on lines holding a thinking block (6232 of 6232 sampled) from 2.1.292. Witness: 3b0e7c12:43 assistant.thinkingDurationMs [number] n=6183 v2.1.292..2.1.293",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed.started_at_ms",
					"event_msg/item_completed.completed_at_ms",
				],
				"parser 9: keep the recorded start and end of a completed Reasoning item (about 96,000 of 103,000 locally carry both); the duration is their difference. Review constraint: The source paths are item-level for all item kinds; they must be restricted to Reasoning items.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"The span of the reasoning item, not a duration the agent wrote; versions without completed items record none. Parser review: No parser value is stored for this pending proposal. The source paths are item-level for all item kinds; they must be restricted to Reasoning items.",
					justification:
						"A Reasoning item's started_at_ms and completed_at_ms bound the item, so the duration is their difference, derived rather than written; started_at_ms is absent on 6590 of 103188 items and before 0.144.1. Witness: 01a1009d:8 event_msg/item_completed.started_at_ms [number] n=232771 v0.144.1..0.162.0-alpha.2",
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
				"parser 9: keep the recorded reason and missed tokens (162 responses locally).",
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"diagnostics.cache_miss_reason.type (previous_message_not_found, messages_changed, model_changed, unavailable) and cache_missed_input_tokens are the provider's recorded miss reason. Witness: 49ead9e1:255 assistant.message.diagnostics.cache_miss_reason.type [string] n=165 v2.1.220..2.1.293 values={'previous_message_not_found': 131, 'messages_changed': 26, 'model_changed': 5, 'unavailable': 3}",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no cache diagnostics on token counts or usage records.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no cache diagnostics on token counts or usage records.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/cache_miss_reason",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for Why the provider says a request missed its prompt cache. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no cache diagnostics on token counts or usage records. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				"parser 9: keep the recorded quota state (7 responses locally).",
				{
					evidence: [],
					relation: { kind: "narrower" },
					justification:
						"Judge ruling. assistant.quotaLimits appears only when a request was rejected (status rejected on all 7 local lines), so it records the limit-hit state, not the general quota state. Witness: agent-ac:61 assistant.quotaLimits.status [string] n=7 v2.1.284..2.1.284 values={'rejected': 7}",
				},
			),
			codex: pending(
				[
					"event_msg/token_count.rate_limits.**",
					"event_msg/image_generation_end.failure.limitId",
					"event_msg/image_generation_end.failure.resetsAt",
				],
				"parser 9: keep the snapshot and its reached-limit fields (about 440,000 token counts locally). Review constraint: rate_limits last appears in 0.159.2 locally; later versions may drop it.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"A usage percentage alone does not prove a request was limited. `rate_limit_reached_type` is on every token count and always null locally; a turn that hit the limit ends with turn_error_kind `usage_limit_exceeded` (21 locally). Parser review: No parser value is stored for this pending proposal. rate_limits last appears in 0.159.2 locally; later versions may drop it. Residue path event_msg/image_generation_end.failure.limitId is recorded but unparsed; no local witness and no semantic verification is claimed. Residue path event_msg/image_generation_end.failure.resetsAt is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"token_count.rate_limits is the provider's own rate-limit snapshot, present on 442,756 token_count events (null on 39,969): limit_id, plan_type, primary/secondary windows with used_percent, window_minutes and resets_at (440,729 / 268,426), credits, and rate_limit_reached_type (always null locally). image_generation_end.failure.resetsAt carries the quota reset of a usage-limit failure (the same kind of state, narrower; no local record). A usage percentage alone does not prove a request was limited; the fact only says 'state reported'.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/rate_limits/codex",
							explanation:
								"token_count.rate_limits is the provider's own rate-limit snapshot, present on 442,756 token_count events (null on 39,969): limit_id, plan_type, primary/secondary windows with used_percent, window_minutes and resets_at (440,729 / 268,426), credits, and rate_limit_reached_type (always null locally). image_generation_end.failure.resetsAt carries the quota reset of a usage-limit failure (the same kind of state, narrower; no local record). A usage percentage alone does not prove a request was limited; the fact only says 'state reported'.",
						},
					],
					sourceMappings: [
						{
							path: "event_msg/image_generation_end.failure.limitId",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; token_count.rate_limits carries the literal rate-limit snapshot.",
						},
						{
							path: "event_msg/image_generation_end.failure.resetsAt",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; token_count.rate_limits carries the literal rate-limit snapshot.",
						},
					],
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
					"attachment/mcp_instructions_delta.attachment.removedNames[]",
				],
				"parser 9: keep the server names of a tools update as recorded (needing authentication on 344, still connecting on 20 locally; the failed list is always empty).",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/mcp_server_state/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Pending/authentication list entries plausibly record connection states, consistent with published MCP status enums. A removed MCP instruction name does not establish failed/auth/pending state, and failedMcpServers at its container path can merely be an empty marker. The unpublished attachment schema prevents a verified all-source state mapping.",
				},
			),
			codex: pending(
				[
					"event_msg/mcp_tool_call_end.result._meta._codex_apps.connector_auth_failure",
					"event_msg/item_completed:McpToolCall.result._meta",
				],
				"parser 9: keep a call's recorded connector authentication failure (`_meta._codex_apps.connector_auth_failure`, 74 locally). Review constraint: The listed source is the whole _meta object; only _meta._codex_apps.connector_auth_failure is a server/connector state.",
				{
					relation: {
						kind: "broader",
					},
					notes:
						"Per call, not a server state; the call's error message is its result text, and an MCP startup failure appears only in output text. Parser review: No parser value is stored for this pending proposal. The listed source is the whole _meta object; only _meta._codex_apps.connector_auth_failure is a server/connector state.",
					justification:
						"The listed source is the whole McpToolCall.result._meta object (16,170 items, opaque tool-defined metadata that the census does not walk). Only _meta._codex_apps.connector_auth_failure{is_auth_failure,auth_reason,connector_id,...} is a connector/server state: 74 unescaped occurrences in the corpus (42 more are escaped copies inside text), and it records an authentication failure only, not 'connecting' or other failures. Source includes the fact; the specific sub-key would be narrower.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/mcp_server_state/codex",
							explanation:
								"The listed source is the whole McpToolCall.result._meta object (16,170 items, opaque tool-defined metadata that the census does not walk). Only _meta._codex_apps.connector_auth_failure{is_auth_failure,auth_reason,connector_id,...} is a connector/server state: 74 unescaped occurrences in the corpus (42 more are escaped copies inside text), and it records an authentication failure only, not 'connecting' or other failures. Source includes the fact; the specific sub-key would be narrower.",
						},
					],
					sourceMappings: [
						{
							path: "event_msg/item_completed:McpToolCall.result._meta",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification: "Other MCP result metadata is not server state.",
						},
					],
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
				[
					"event_msg/task_started.model_context_window",
					"event_msg/token_count.info.model_context_window",
				],
				{ since: 7, facts: ["context_window"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/context_window/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					notes:
						"usage extraction also reads `token_count.info.model_context_window`.",
					relation: { kind: "exact" },
					justification:
						"task_started.model_context_window is the context window size the turn started with (null in 29 of 31204). Witness: 019cb44a:5 event_msg/task_started.model_context_window [number/null] n=31204 v0.100.0..0.162.0-alpha.2",
					gap: {
						sources: ["event_msg/token_count.info.model_context_window"],
						plan: "parser 9: preserve newly mapped literal fields with call/record provenance and distinct component names/units; never infer values from prose.",
					},
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
				[
					"assistant.message.usage.input_tokens",
					"assistant.message.usage.cache_read_input_tokens",
					"assistant.message.usage.cache_creation_input_tokens",
				],
				{
					elsewhere:
						"usage_events (packages/usage-events), priced per run in run_index",
				},
				{
					evidence: [],
					relation: { kind: "close" },
					testedIn: "packages/usage-events/src/extract.test.ts",
					notes:
						"Parser review: extract.ts:517 adds uncached input and cache-read/cache-write tokens; run-index-sql.ts:501 selects the earliest verified event in the run, not input_tokens alone.",
					justification:
						"usage.input_tokens excludes cached tokens (median 2 vs cache_read median 355982; input < cache_read on 99.8% of lines), so it is not how full the context was, and it is per content-block line, not per first request. Witness: 49ead9e1:21 assistant.message.usage.input_tokens [number] n=60795 v2.1.220..2.1.293",
				},
			),
			codex: stored(
				["event_msg/token_count.info.last_token_usage.input_tokens"],
				{
					elsewhere:
						"usage_events (packages/usage-events), priced per run in run_index",
				},
				{
					relation: {
						kind: "broader",
					},
					testedIn: "packages/usage-events/src/extract.test.ts",
					notes:
						"Parser review: usage extraction uses deduplicated increments with replay handling; run_index selects the earliest verified event in the run, not the last counter of the session.",
					justification:
						"last_token_usage.input_tokens is the input size of the last completed response at every token_count update (481,693 events with info), so it covers every request of a run; the fact is the first request of a run only. The value is the right literal, the selection (earliest verified usage event of the run, replays de-duplicated) is done in usage events / run_index.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/context_input_tokens_at_start/codex",
							explanation:
								"last_token_usage.input_tokens is the input size of the last completed response at every token_count update (481,693 events with info), so it covers every request of a run; the fact is the first request of a run only. The value is the right literal, the selection (earliest verified usage event of the run, replays de-duplicated) is done in usage events / run_index.",
						},
					],
				},
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
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/compacted/claude_code",
							explanation:
								"Neither source can be witnessed or tied to a writer: the local Claude corpus has no system/compact_boundary record and no isCompactSummary field (0 of 175,336 records; system subtypes seen: stop_hook_summary 2,305, api_error 13, informational 8, refusal 7). The published SDK type documents a compact_boundary system message (sdk.d.ts:3739-3743) but not the transcript's .content text nor isCompactSummary. Missing: one real compact_boundary record or Claude Code writer source.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/compacted/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "unreviewed" },
					notes:
						"No compaction record occurs in the local transcripts (2.1.220–2.1.293), so the census cannot confirm this source; the parser fixtures cover it. Parser review: readClaudeLine recognizes compaction conventions/discriminators, but no local corpus witness exists; fixtures are not a local transcript witness. Keep unreviewed.",
					justification:
						"Judge round 3: No compaction record exists in the local transcripts: 0 occurrences of system/compact_boundary or user.isCompactSummary in 310 files, and the published SDK types declare the compact_boundary system message (sdk.d.ts:3739) but neither a content text meaning nor isCompactSummary. Missing: a real compaction transcript or the Claude writer to show what these two fields hold.",
				},
			),
			codex: stored(
				[
					"compacted/.message",
					"compacted/.replacement_history**",
					"event_msg/context_compacted",
					"response_item/compaction.encrypted_content",
					"response_item/context_compaction.encrypted_content",
				],
				{ since: 1, record: ["kind"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/compacted/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					gap: {
						sources: [
							"event_msg/item_completed:ContextCompaction.id",
							"compacted/.window_id",
							"compacted/.previous_window_id",
							"compacted/.window_number",
							"compacted/.first_window_id",
							"response_item/context_compaction.encrypted_content",
						],
						plan: "parser 9: a completed ContextCompaction item (the only witness in some sessions) becomes a compaction boundary with its turn id; keep window ids.",
					},
					notes:
						"Parser review: readCompletedItem keeps ContextCompaction mirrors as meta; response compaction mirrors also stay meta. Count the primary compacted event, not replacement_history leaves. Residue path response_item/context_compaction.encrypted_content is recorded but unparsed; no local witness and no semantic verification is claimed.",
					sourceMappings: [
						{
							path: "response_item/compaction.encrypted_content",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "event_msg/item_completed:ContextCompaction.id",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"Primary compacted record denotes the compaction; completed/response mirrors stay meta, so count one event. Replacement history and checkpoint IDs are context.",
						},
						{
							path: "compacted/.window_id",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"Primary compacted record denotes the compaction; completed/response mirrors stay meta, so count one event. Replacement history and checkpoint IDs are context.",
						},
						{
							path: "compacted/.previous_window_id",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"Primary compacted record denotes the compaction; completed/response mirrors stay meta, so count one event. Replacement history and checkpoint IDs are context.",
						},
						{
							path: "compacted/.window_number",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"Primary compacted record denotes the compaction; completed/response mirrors stay meta, so count one event. Replacement history and checkpoint IDs are context.",
						},
						{
							path: "compacted/.first_window_id",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"Primary compacted record denotes the compaction; completed/response mirrors stay meta, so count one event. Replacement history and checkpoint IDs are context.",
						},
						{
							path: "response_item/context_compaction.encrypted_content",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Independent map_existing agreement; never seen locally. The ContextCompaction response discriminator/presence is explicit compaction evidence; do not retain encrypted bytes.",
						},
					],
					justification:
						"Primary compacted record denotes the compaction; completed/response mirrors stay meta, so count one event. Replacement history and checkpoint IDs are context.",
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
				{
					since: 7,
					facts: ["compact_trigger"],
				},
				{
					notes:
						"No compaction record occurs in the local transcripts (2.1.220–2.1.293), so the census cannot confirm this source; the parser fixtures cover it.",
					relation: {
						kind: "exact",
					},
					justification:
						"The published type gives compact_metadata.trigger as 'manual' | 'auto' (sdk.d.ts:3739-3742): manual is the user's /compact, auto the automatic one, which is the fact. The transcript spelling (compactMetadata.trigger) cannot be seen locally (0 compact_boundary records), so the match rests on the SDK type.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/compact_trigger/claude_code",
							explanation:
								"The published type gives compact_metadata.trigger as 'manual' | 'auto' (sdk.d.ts:3739-3742): manual is the user's /compact, auto the automatic one, which is the fact. The transcript spelling (compactMetadata.trigger) cannot be seen locally (0 compact_boundary records), so the match rests on the SDK type.",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no trigger on `compacted`, `compaction` or ContextCompaction records.",
				{
					justification:
						"0.162.0 filters ResponseItem::CompactionTrigger from durable rollouts (policy.rs:98); the persisted checkpoint and ContextCompaction item have no automatic/manual trigger. CompactionTurnMetadata.trigger/reason describe outgoing requests, not rollout items. The snapshot has no compaction-trigger field; resume_metadata.turn_attribution.turn_trigger is turn attribution, not why compaction started.",
					relation: {
						kind: "not_emitted",
					},
					notes:
						"Writer absence proof is scoped to Codex 0.162.0; the historical bounded corpus search is retained separately.",
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/compact_trigger",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:98, codex-rs/history/src/lib.rs:287, codex-rs/core/src/compact.rs:69, codex-rs/core/src/responses_metadata.rs:122, codex-rs/protocol/src/items.rs:509. 0.162.0 filters ResponseItem::CompactionTrigger from durable rollouts (policy.rs:98); the persisted checkpoint and ContextCompaction item have no automatic/manual trigger. CompactionTurnMetadata.trigger/reason describe outgoing requests, not rollout items. The snapshot has no compaction-trigger field; resume_metadata.turn_attribution.turn_trigger is turn attribution, not why compaction started.",
						},
						{
							kind: "writer_source",
							path: "response_item/compaction_trigger",
							file: "codex-rs/rollout/src/policy.rs",
							line: 98,
							version: "0.162.0",
							supportsMeaning: true,
							explanation:
								"0.162.0 filters ResponseItem::CompactionTrigger from durable rollouts (policy.rs:98); the persisted checkpoint and ContextCompaction item have no automatic/manual trigger. CompactionTurnMetadata.trigger/reason describe outgoing requests, not rollout items. The snapshot has no compaction-trigger field; resume_metadata.turn_attribution.turn_trigger is turn attribution, not why compaction started.",
						},
					],
				},
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
				{
					notes:
						"No compaction record occurs in the local transcripts (2.1.220–2.1.293), so the census cannot confirm this source; the parser fixtures cover it.",
					relation: {
						kind: "exact",
					},
					justification:
						"compact_metadata.pre_tokens: number is the token count before compaction (sdk.d.ts:3739-3743), the fact. Transcript key spelling (compactMetadata.preTokens) is unverified because no compaction record occurs locally.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/compact_pre_tokens/claude_code",
							explanation:
								"compact_metadata.pre_tokens: number is the token count before compaction (sdk.d.ts:3739-3743), the fact. Transcript key spelling (compactMetadata.preTokens) is unverified because no compaction record occurs locally.",
						},
					],
				},
			),
			codex: pending(
				["compacted/.latest_token_usage_record.**"],
				"parser 9: keep the compaction's latest usage record, once checked to be the usage before it. Review constraint: Do not use total_tokens or thread_token_usage as pre-compaction context tokens; select the correct usage field and explain the timing proxy.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Do not use total_tokens or thread_token_usage as pre-compaction context tokens; select the correct usage field and explain the timing proxy.",
					justification:
						"latest_token_usage_record is a snapshot of the latest reachable usage record when the compaction was written, whose input tokens approximate the pre-compaction context but are the last request's usage. Witness: 01a102ea:674 compacted/.latest_token_usage_record.** [string/number] n=14214 v0.146.0..0.160.0",
				},
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
				{ elsewhere: "run_index, counted from the stored records" },
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["calls/call_id", "calls/tool_name"],
					},
					justification: "Opaline computation, not an agent-written value. ",
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
				},
			),
			codex: stored(
				[],
				{ elsewhere: "run_index, counted from the stored records" },
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["calls/call_id", "calls/tool_name"],
					},
					justification: "Opaline computation, not an agent-written value. ",
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
				},
			),
		},
	},
	{
		id: "failed_calls",
		view: "runs",
		meaning: "Number of failed tool calls in the run.",
		agents: {
			claude_code: stored(
				[],
				{ elsewhere: "run_index, counted from the stored records" },
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["calls/is_error", "calls/exit_code"],
					},
					justification: "Opaline computation, not an agent-written value. ",
					conflict:
						"Derived counts inherit the incompatible Claude/Codex is_error predicates and Codex transport-failure gaps.",
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
				},
			),
			codex: wrong(
				[],
				{
					elsewhere: "run_index, counted from the stored records",
				},
				"parser 9: Recompute after the calls/is_error and late-completion exit fixes; no run_index change needed. Evidence: Count follows the stored is_error: 36,125 error results, but 842 transport-failure results are stored not failed (645 failed, 98 Rejected, 11 Sandbox(Denied), 50 parse-args, 38 image) and 4,332 late nonzero exits are missed: at least 5,174 failed calls absent (about 12% of 41,299).",
				{
					relation: {
						kind: "derived",
						from: ["calls/is_error", "calls/exit_code"],
					},
					justification: "Opaline computation, not an agent-written value. ",
					conflict:
						"Derived counts inherit the incompatible Claude/Codex is_error predicates and Codex transport-failure gaps.",
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#runs/failed_calls/codex",
							explanation:
								"Count follows the stored is_error: 36,125 error results, but 842 transport-failure results are stored not failed (645 failed, 98 Rejected, 11 Sandbox(Denied), 50 parse-args, 38 image) and 4,332 late nonzero exits are missed: at least 5,174 failed calls absent (about 12% of 41,299).",
						},
					],
				},
			),
		},
	},
	{
		id: "denied_calls",
		view: "runs",
		meaning: "Number of refused tool calls in the run.",
		agents: {
			claude_code: wrong(
				[],
				{
					elsewhere: "run_index, counted from the stored records",
				},
				"parser 9: Exclude denial_kind='interrupted' from denied_calls (count permission-rule, user-rejected, cancelled). Evidence: Real data: 160 denial-bearing results (user.toolDenialKind n=159): permission-rule 151, cancelled 5, user-rejected 3, interrupted 1. The 'interrupted' one is a harness note that the session ended before the result was recorded (f73243d5-15f3-4f4c-bf20-fde44163d469:1118), not a refusal; the 5 'cancelled' read 'The user doesn't want to take this action right now' (053c7e61-2650-4e73-8048-a68d7028f55d:554), a user decline, so they are genuine refusals. Error is 1 of 160.",
				{
					relation: {
						kind: "derived",
						from: ["calls/denial_kind", "calls/call_id"],
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"Parser review: parser 9: separate cancellation/interruption categories from refused permission calls before run_index counts distinct denial call ids. Data witness: 6 toolDenialKind values are cancelled/interrupted and satisfy denial_kind!=empty (fresh scan). Data witness: 6 toolDenialKind values are cancelled/interrupted and satisfy denial_kind!=empty (fresh scan).",
					justification:
						"Opaline computation, not an agent-written value. No agent field counts refusals; the count is derived from denied tool results (Claude toolDenialKind 158, Codex `Rejected(` output text 99). Witness: 49ead9e1:1030 user.toolDenialKind [string] n=158 v2.1.220..2.1.293",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#runs/denied_calls/claude_code",
							explanation:
								"Real data: 160 denial-bearing results (user.toolDenialKind n=159): permission-rule 151, cancelled 5, user-rejected 3, interrupted 1. The 'interrupted' one is a harness note that the session ended before the result was recorded (f73243d5-15f3-4f4c-bf20-fde44163d469:1118), not a refusal; the 5 'cancelled' read 'The user doesn't want to take this action right now' (053c7e61-2650-4e73-8048-a68d7028f55d:554), a user decline, so they are genuine refusals. Error is 1 of 160.",
						},
					],
				},
			),
			codex: stored(
				[],
				{ elsewhere: "run_index, counted from the stored records" },
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["calls/denial_kind", "calls/call_id"],
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"Parser review: run-index-sql counts distinct result call keys with denial_kind!=empty; codexDenialKind supplies only failed-call denial-envelope categories, not arbitrary output text.",
					justification:
						"Opaline computation, not an agent-written value. No agent field counts refusals; the count is derived from `Rejected(`/`Sandbox(Denied` output text, a convention rather than a recorded count. Witness: 019cb960:2007 response_item/function_call_output.output~Rejected [string] n=95 v0.100.0..0.157.1",
				},
			),
		},
	},
	{
		id: "edits",
		view: "runs",
		meaning: "Number of files the run changed.",
		agents: {
			claude_code: stored(
				[],
				{ elsewhere: "run_index, counted from the stored records" },
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["calls/file_path", "calls/file_op", "calls/is_error"],
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"Changes of failed calls are left out; a shell change that succeeded but may have done nothing still counts (see file_op). Parser review: run-index-sql counts distinct file_change paths and excludes known failed calls, but successful requested operations still do not prove effects; see calls/file_op parser-9 defect.",
					justification:
						"Opaline computation, not an agent-written value. The count of changed files is derived from edit results (structuredPatch on Write/Edit results, bashEditDiff on Bash results), not written by the agent. Witness: 49ead9e1:396 user.toolUseResult.bashEditDiff.files[].filePath [string] n=1688 v2.1.280..2.1.292",
				},
			),
			codex: wrong(
				[],
				{
					elsewhere: "run_index, counted from the stored records",
				},
				"parser 9: Fixed by calls/is_error (mark refusals and transport failures failed) or by counting edits only from FileChange / patch_apply_end success. Evidence: Real parser: 81 calls in total (71 of the 110 refusals plus about 10 other transport failures) emit write/edit/delete rows yet are not flagged failed, so they enter edits although nothing was applied (refusal example rollout-2026-02-18T13-03-37-019c70a2:974).",
				{
					relation: {
						kind: "derived",
						from: ["calls/file_path", "calls/file_op", "calls/is_error"],
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"Parser review: follows file_op and is_error: a refused call's shell or patch change still counts until parser 9 Data witness: 70 refused mutation requests in the prior local catalog census can enter the effect rows; see calls/file_op and calls/is_error. Data witness: 70 refused mutation requests in the prior local catalog census can enter the effect rows; see calls/file_op and calls/is_error.",
					justification:
						"Opaline computation, not an agent-written value. The count is derived from FileChange items and shell/patch text, none of which records 'files changed' directly; refused calls still count today (status wrong). Witness: 019d0073:783 event_msg/item_completed:FileChange.changes.{*}.type [string] n=54978 v0.107.0..0.160.0 values={'update': 49396, 'add': 4643, 'delete': 939}",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#runs/edits/codex",
							explanation:
								"Real parser: 81 calls in total (71 of the 110 refusals plus about 10 other transport failures) emit write/edit/delete rows yet are not flagged failed, so they enter edits although nothing was applied (refusal example rollout-2026-02-18T13-03-37-019c70a2:974).",
						},
					],
				},
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
				{ elsewhere: "run_index, counted from the stored records" },
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: [
							"calls/tool_name",
							"calls/input_text",
							"calls/parsed_cmd_types",
							"calls/call_id",
						],
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"Parser review: toolGroupSql classifies native names and shell-head read/search conventions, not only tool names; run_index counts tool_call rows rather than parsed command parts.",
					justification:
						"Opaline computation, not an agent-written value. The count is derived by classifying Read/Grep/Glob calls by tool name; no agent field counts reads. Witness: 49ead9e1:265 assistant.message.content[tool_use:Read].input.file_path [string] n=2124 v2.1.220..2.1.293",
				},
			),
			codex: wrong(
				["event_msg/item_completed:CommandExecution.parsed_cmd[].type"],
				{
					elsewhere: "run_index, counted from the stored records",
				},
				"parser 9: Count reads/searches from parsed_cmd types (store them as read/search sub-rows or use parsed_cmd_types) and keep the first-word regex only for agents without parsed_cmd. Evidence: Real parser over CommandExecution items: 83,167 calls have a parsed_cmd read part (107,076 parts in total) while the regex marks 113,194 calls as read; they agree on 65,961, regex-only 47,233, parsed_cmd-only 17,206: 64,439 of 130,400 calls (49%) disagree. Codex's own classification also finds 28,970 search calls.",
				{
					relation: {
						kind: "derived",
						from: [
							"calls/tool_name",
							"calls/input_text",
							"calls/parsed_cmd_types",
							"calls/call_id",
						],
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"Parser review: counted by tool name, and Codex reads and searches through the shell: count the `read` and `search` parts Codex recorded (parsed_cmd) once parser 9 stores them as reads Data witness: 107016 explicit type=read parts exist (fresh scan); run_index uses shell-head heuristics, not those literal parts or distinct-call grouping. Data witness: 107016 explicit type=read parts exist (fresh scan); run_index uses shell-head heuristics, not those literal parts or distinct-call grouping.",
					justification:
						"Opaline computation, not an agent-written value. parsed_cmd[].type read/search (76732 and 26355 parts) is Codex's own classification, but the count is derived per part, not per call, and the current tool-name counting misses shell reads. Witness: 019d0073:657 event_msg/item_completed:CommandExecution.parsed_cmd[].type [string] n=210301 v0.107.0..0.162.0-alpha.2 values={'unknown': 101047, 'read': 76732, 'search': 26355, 'list_files': 6167}",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#runs/reads/codex",
							explanation:
								"Real parser over CommandExecution items: 83,167 calls have a parsed_cmd read part (107,076 parts in total) while the regex marks 113,194 calls as read; they agree on 65,961, regex-only 47,233, parsed_cmd-only 17,206: 64,439 of 130,400 calls (49%) disagree. Codex's own classification also finds 28,970 search calls.",
						},
					],
					sourceMappings: [
						{
							path: "event_msg/item_completed:CommandExecution.parsed_cmd[].type",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
				},
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
				{ elsewhere: "run_index, counted from the stored records" },
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: [
							"calls/is_error",
							"calls/input_text",
							"calls/result_chars",
							"calls/tool_name",
						],
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"A text match on the output (`not found`, `No such file`, `ENOENT`). Parser review: run-index-sql:217 requires failed status, read/search call group AND not-found output text; incidental words in successful output do not count.",
					justification:
						"Opaline computation, not an agent-written value. The count is a text match on failed outputs ('not found', 'No such file', 'ENOENT'), a derived value; neither agent records a not-found flag.",
				},
			),
			codex: stored(
				[],
				{ elsewhere: "run_index, counted from the stored records" },
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: [
							"calls/is_error",
							"calls/input_text",
							"calls/result_chars",
							"calls/tool_name",
						],
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"A text match on the output (`not found`, `No such file`, `ENOENT`). Parser review: run-index-sql:217 requires failed status, read/search call group AND not-found output text; shell classifier coverage remains limited, but the proposed predicate already exists.",
					justification:
						"Opaline computation, not an agent-written value. The count is a text match on failed outputs, a derived value; Codex writes no not-found flag. Witness: 019cb44a:18 response_item/function_call_output.output [string] n=342010 v0.100.0..0.162.0-alpha.2",
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
				{
					since: 7,
					facts: ["aborted"],
				},
				{
					relation: {
						kind: "narrower",
					},
					gap: {
						sources: [
							"user.message.content[text].text~Request interrupted by user",
							"user.message.content~Request interrupted by user",
						],
						plan: "parser 9: an `[Request interrupted by user…]` marker marks the run aborted.",
					},
					notes:
						"Parser review: claudeLineFacts copies interruptedByShutdown; run_index separately reads interrupt marker subtypes. Missing markers are unknown, not successful completion.",
					justification:
						"interruptedByShutdown is one cause of a run not finishing (true on 1 of 1 records, cbec77b3:61), and the user-interrupt text markers are another (convention ~Request interrupted by user n=10 in text blocks); neither covers every way a run can stop, and a missing marker means unknown, not completed. So the sources are narrower than 'stopped before it finished'.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/aborted/claude_code",
							explanation:
								"interruptedByShutdown is one cause of a run not finishing (true on 1 of 1 records, cbec77b3:61), and the user-interrupt text markers are another (convention ~Request interrupted by user n=10 in text blocks); neither covers every way a run can stop, and a missing marker means unknown, not completed. So the sources are narrower than 'stopped before it finished'.",
						},
					],
				},
			),
			codex: stored(
				["event_msg/turn_aborted.reason"],
				{ since: 7, facts: ["aborted"] },
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"Judge ruling. turn_aborted.reason is written when a turn is aborted (interrupted 1550 locally; Replaced, ReviewEnded and BudgetLimited also exist). Witness: 019d3082:286 event_msg/turn_aborted.reason [string] n=1550 v0.107.0..0.162.0-alpha.2 values={'interrupted': 1550}",
				},
			),
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
				"parser 9: keep the interrupt marker's exact variant (`by user`, `by user for tool use`); it is an empty meta row today.",
				{
					relation: {
						kind: "narrower",
					},
					justification:
						"The only source is the '[Request interrupted by user ...]' text marker (10 occurrences in text blocks); its variants (by user, by user for tool use) say why, but only for user interruptions, not for the other reasons a run can end. The catalog's pending plan stores the variant text.",
					notes:
						"Independent disagreement remains unreviewed: Sol=narrower, Sonnet=transform.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/abort_reason/claude_code",
							explanation:
								"The only source is the '[Request interrupted by user ...]' text marker (10 occurrences in text blocks); its variants (by user, by user for tool use) say why, but only for user interruptions, not for the other reasons a run can end. The catalog's pending plan stores the variant text.",
						},
					],
				},
			),
			codex: stored(
				["event_msg/turn_aborted.reason"],
				{ since: 7, facts: ["abort_reason"] },
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"TurnAbortedEvent.reason is the enum for why the turn stopped (Interrupted, Replaced, ReviewEnded, BudgetLimited). Witness: 019d3082:286 event_msg/turn_aborted.reason [string] n=1550 v0.107.0..0.162.0-alpha.2 values={'interrupted': 1550}",
				},
			),
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
				{
					evidence: [],
					relation: { kind: "exact" },
					notes:
						"Parser review: Catalog scope correction: turn_aborted.error (ErrorEvent too, see residue) is also a turn-ending error but is not a source. Residue path event_msg/turn_aborted.error.message is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"TurnComplete.error is an ErrorEvent with message and codex_error_info, written when the turn ended unsuccessfully. Witness: 01a101b9:179 event_msg/task_complete.error.message [string] n=78 v0.146.0..0.160.0",
					gap: {
						sources: ["event_msg/turn_aborted.error.message"],
						plan: "parser 9: read the agreed writer-residue fields separately with their recorded provenance; do not coalesce context with values.",
					},
				},
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
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"codex_error_info is the error kind as Codex names it: a string (server_overloaded, usage_limit_exceeded, cyber_policy...) or an object variant such as http_connection_failed{http_status_code}. Witness: 01a101b9:179 event_msg/task_complete.error.codex_error_info [string] n=75 v0.146.0..0.160.0",
					gap: {
						sources: ["event_msg/turn_aborted.error.codex_error_info"],
						plan: "parser 9: read the agreed writer-residue fields separately with their recorded provenance; do not coalesce context with values.",
					},
					notes:
						"Residue path event_msg/turn_aborted.error.codex_error_info is recorded but unparsed; no local witness and no semantic verification is claimed.",
				},
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
				"parser 9: keep `promptId` and `turnPosition` as recorded. Review constraint: Claude has no per-run id of the sub-agent's own turn; promptId groups a prompt and everything it spawned.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"A sub-agent's records carry the `promptId` of the parent prompt that started it (135 of 136 local sub-agent files), like Codex's `root_turn_id`. Parser review: No parser value is stored for this pending proposal. Claude has no per-run id of the sub-agent's own turn; promptId groups a prompt and everything it spawned.",
					justification:
						"promptId identifies the user prompt and is shared by a sub-agent's records (13044 sidechain user records carry it), so it behaves like Codex's root_turn_id, while turnPosition holds indices, not ids. Witness: 49ead9e1:3 user.promptId [string] n=33845 v2.1.220..2.1.293",
				},
			),
			codex: stored(
				[
					"turn_context/.turn_id",
					"event_msg/task_started.turn_id",
					"event_msg/task_complete.turn_id",
					"event_msg/turn_aborted.turn_id",
					"event_msg/thread_goal_updated.turnId",
					"event_msg/item_completed.turn_id",
					"event_msg/item_completed.thread_id",
					"event_msg/task_started.root_turn_id",
					"turn_context/.root_turn_id",
					"event_msg/task_started.turn_attribution.turn_id",
					"event_msg/entered_review_mode.turn_id",
					"event_msg/exited_review_mode.turn_id",
					"event_msg/mcp_tool_call_end.turn_id",
					"realtime_item/.turn_id",
					"retained_context/delivered_assistant_message.turn_id",
					"retained_context/verified_answer.turn_id",
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
				{ since: 7, facts: ["turn_id"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/entered_review_mode.turn_id; judge2/sonnet/residue.json",
							explanation:
								"event_msg/entered_review_mode.turn_id: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/exited_review_mode.turn_id; judge2/sonnet/residue.json",
							explanation:
								"event_msg/exited_review_mode.turn_id: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/mcp_tool_call_end.turn_id; judge2/sonnet/residue.json",
							explanation:
								"event_msg/mcp_tool_call_end.turn_id: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#realtime_item/.turn_id; judge2/sonnet/residue.json",
							explanation: "realtime_item/* n=0 local records",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#retained_context/delivered_assistant_message.turn_id; judge2/sonnet/residue.json",
							explanation:
								"compacted/.retained_context.assistant_messages[].turn_id n=78",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#retained_context/verified_answer.turn_id; judge2/sonnet/residue.json",
							explanation:
								"retained_context/verified_answer.turn_id: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/turn_id/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/turn_id/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					gap: {
						sources: [
							"event_msg/thread_goal_updated.turnId",
							"event_msg/item_completed.turn_id",
							"event_msg/item_completed.thread_id",
							"event_msg/task_started.root_turn_id",
							"turn_context/.root_turn_id",
							"event_msg/task_started.turn_attribution.turn_id",
							"event_msg/entered_review_mode.turn_id",
							"event_msg/exited_review_mode.turn_id",
							"event_msg/mcp_tool_call_end.turn_id",
							"realtime_item/.turn_id",
							"retained_context/delivered_assistant_message.turn_id",
							"retained_context/verified_answer.turn_id",
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
						plan: "parser 9: read these additional literal sources without treating different meanings or units as interchangeable.",
					},
					notes:
						"Parser review: codexTurnContextFacts/codexTaskFacts copy turn_id only; thread/root IDs are join context, not replacement turn identities. Residue path event_msg/task_started.turn_attribution.turn_id is recorded but unparsed; no local witness and no semantic verification is claimed.",
					justification:
						"Judge round 3: Most PRIMARY turn_id values identify the originating turn. item_completed.thread_id is the session/thread stream, not a turn. root_turn_id is the causal owner and can differ from the current turn. Retained delivered/verified turn_id is original-source attribution, not necessarily the current run.",
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
					evidence: [],
					relation: { kind: "exact" },
					gap: {
						sources: ["assistant.message.stop_details.*"],
						plan: "parser 9: keep a refusal's `stop_details` (category, explanation).",
					},
					notes:
						"Parser review: claudeLineFacts setText drops null intermediate snapshots; run_index selects a nonempty recorded stop_reason, not a null split block.",
					sourceMappings: [
						{
							path: "assistant.message.stop_details.*",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"message.stop_reason holds end_turn, tool_use, stop_sequence or refusal, but it is null on 5529 intermediate content-block lines (set on only one line of 3639 multi-line requests). Witness: 49ead9e1:21 assistant.message.stop_reason [string/null] n=60795 v2.1.220..2.1.293 values={'tool_use': 51447, 'end_turn': 3726, 'stop_sequence': 85, 'refusal': 8}",
						},
					],
					justification:
						"message.stop_reason holds end_turn, tool_use, stop_sequence or refusal, but it is null on 5529 intermediate content-block lines (set on only one line of 3639 multi-line requests). Witness: 49ead9e1:21 assistant.message.stop_reason [string/null] n=60795 v2.1.220..2.1.293 values={'tool_use': 51447, 'end_turn': 3726, 'stop_sequence': 85, 'refusal': 8}",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no stop reason on messages, completions or token counts; a message's `phase` (message_phase) is not one.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no stop reason on messages, completions or token counts; a message's `phase` (message_phase) is not one.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/stop_reason",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for Why the model stopped writing (finished, wanted a tool, hit a limit, refused). Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no stop reason on messages, completions or token counts; a message's `phase` (message_phase) is not one. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
					"retained_context/delivered_assistant_message.phase",
					"event_msg/task_complete.last_agent_message",
				],
				"parser 9: keep each message's phase as recorded. Review constraint: event_msg/task_complete.last_agent_message is message text, not a phase.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#retained_context/delivered_assistant_message.phase; judge2/sonnet/residue.json",
							explanation:
								"compacted/.retained_context.assistant_messages[].phase n=78 values final_answer=48 commentary=30",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/message_phase/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. event_msg/task_complete.last_agent_message is message text, not a phase.",
					justification:
						"Judge round 3: Assistant ResponseItem.phase, AgentMessageItem/Event.phase, and retained assistant phase are the recorded commentary/final-answer classification. Preserve provenance on retained records; phase describes the original assistant message, not its delivery mode.",
					sourceMappings: [
						{
							path: "event_msg/task_complete.last_agent_message",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
				},
			),
		},
	},
	{
		id: "hook_stop_reason",
		view: "runs",
		meaning: "The reason a stop hook gave.",
		runIndex: ["hook_stop_reason"],
		agents: {
			claude_code: stored(
				["system/stop_hook_summary.stopReason"],
				{ since: 7, facts: ["hook_stop_reason"] },
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"stop_hook_summary.stopReason is the field for the stop hook's reason, though it is empty in all 2275 local records. Witness: 49ead9e1:104 system/stop_hook_summary.stopReason [string] n=2273 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/hook_stop_reason",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:108. Checked the 0.162.0 durable schema/policy and candidate paths for The reason a stop hook gave. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
				{
					evidence: [],
					relation: { kind: "narrower" },
					justification:
						"Judge ruling. stop_hook_summary has hookErrors (always empty locally) and hookCount, but it summarises Stop hooks only; PreToolUse hook errors appear as tool_result text ('hook error'). Witness: 49ead9e1:104 system/stop_hook_summary.hookErrors [array] n=2273 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/hook_errors",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:108. Checked the 0.162.0 durable schema/policy and candidate paths for Errors the run's hooks reported, and how many hooks ran. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
		},
	},
	{
		id: "prevented_continuation",
		view: "runs",
		meaning: "A hook stopped the agent from continuing.",
		runIndex: ["prevented_continuation"],
		agents: {
			claude_code: stored(
				["system/stop_hook_summary.preventedContinuation"],
				{ since: 7, facts: ["prevented_continuation"] },
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"preventedContinuation is the boolean on the stop-hook summary (false in all 2275 local records). Witness: 49ead9e1:104 system/stop_hook_summary.preventedContinuation [boolean] n=2273 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"codex-absence-0.162.0.json#runs/prevented_continuation",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:108. Checked the 0.162.0 durable schema/policy and candidate paths for A hook stopped the agent from continuing. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
				{
					evidence: [],
					relation: { kind: "narrower" },
					justification:
						"Judge ruling. hookInfos[] gives command and durationMs for each hook of a Stop-hook summary (2275), not for other hook phases. Witness: 49ead9e1:104 system/stop_hook_summary.hookInfos[].command [string] n=2273 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/hook_runs",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/items.rs:108. Checked the 0.162.0 durable schema/policy and candidate paths for The hooks that ran: command and duration. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no hook records in any rollout. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
					"system/api_error.error.status",
					"system/api_error.error.connection.code",
					"system/api_error.error.message",
					"system/api_error.error.formatted",
					"system/api_error.error.isNetworkDown",
					"system/api_error.error.connection.message",
				],
				{ since: 7, facts: ["api_error", "api_error_status"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/api_errors/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/api_errors/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "broader" },
					gap: {
						sources: [
							"system/api_error.error.status",
							"system/api_error.error.connection.code",
							"system/api_error.error.message",
							"system/api_error.error.formatted",
							"system/api_error.error.isNetworkDown",
							"system/api_error.error.connection.message",
						],
						plan: "parser 9: preserve the literal system/api_error.error.isNetworkDown with its existing api_errors meaning and provenance.",
					},
					notes:
						"Parser review: claudeApiErrorFacts copies assistant.error/apiErrorStatus; these include client transport and synthetic markers, not only provider HTTP errors. Retried system errors remain a gap.",
					justification:
						"Judge round 3: The sources include client-side failures that are not errors the provider returned: connection.code StreamSuspended 10 / ENOTFOUND 2, formatted 'Connection lost while your computer was asleep' 10, isNetworkDown (true 2, false 11), and 90 isApiErrorMessage markers against only 66 error codes (rate_limit 37, invalid_request 20, billing_error 5, authentication_failed 4) and 42 HTTP statuses (429 37, 400 5). Provider-returned errors are a subset.",
				},
			),
			codex: pending(
				[
					"event_msg/task_complete.error.codex_error_info",
					"event_msg/task_complete.error.codex_error_info.**",
					"event_msg/task_complete.error.message",
				],
				"parser 9: count a turn error Codex classifies as a provider error (`server_overloaded` 25, `usage_limit_exceeded` 21, `http_connection_failed` 3 locally) as an API error, with its kind as recorded; it is stored only as turn_error_kind today. Review constraint: Filter provider error kinds and document terminal-only coverage; SandboxError/Other are not automatically API errors.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Codex records a failed request only when it ends the turn; policy.rs:161 excludes standalone Error events from persisted rollouts in 0.162.0, and none occur locally. The parser's support for an error event is not evidence that the writer persists it. Parser review: No parser value is stored for this pending proposal. Filter provider error kinds and document terminal-only coverage; SandboxError/Other are not automatically API errors.",
					justification:
						"A turn-ending error with provider kinds (server_overloaded 25, usage_limit_exceeded 21, http_connection_failed 3) is a provider error, but the same fields also carry policy and other kinds (cyber_policy, other), and non-terminal errors are not persisted. Witness: 01a101b9:179 event_msg/task_complete.error.codex_error_info [string] n=75 v0.146.0..0.160.0",
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
				{
					evidence: [],
					relation: { kind: "exact" },
					notes:
						"Parser review: claudeSystemFacts stores retryAttempt, maxRetries and retryInMs separately; run_index retry_attempts reads retry_attempt only, not the limit or delay.",
					sourceMappings: [
						{
							path: "system/api_error.maxRetries",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "system/api_error.retryInMs",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Judge ruling. system/api_error carries retryAttempt, maxRetries and retryInMs for a retried request (13 local). Witness: 98b5dc67:856 system/api_error.retryAttempt [number] n=13 v2.1.284..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no retry records.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no retry records.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/retry_attempts",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for Retries of failed model requests. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no retry records. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"model_refusal_fallback / model_refusal_no_fallback records carry apiRefusalCategory and originalModel (5 local). Witness: e34d6925:55 system/model_refusal_fallback.apiRefusalCategory [string] n=2 v2.1.284..2.1.284",
				},
			),
			codex: pending(
				[
					"event_msg/task_complete.error.codex_error_info",
					"event_msg/task_complete.error.message",
				],
				"parser 9: count a turn Codex ended for a policy (`cyber_policy` 7, `misalignment_policy_violation` 3 locally) as a refusal, with the kind as its category; it is stored only as turn_error_kind today. Review constraint: The sources are the generic turn error; only two kinds are refusal-like, so a filter on kind is required.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"A refusal ends the turn as an error; Codex records no refusal record or fallback model. Parser review: No parser value is stored for this pending proposal. The sources are the generic turn error; only two kinds are refusal-like, so a filter on kind is required.",
					justification:
						"A policy-ended turn (cyber_policy 7, misalignment_policy_violation 3) is Codex's nearest to a refusal, but there is no refusal record and the listed fields also hold every other error. Witness: 01a101b9:179 event_msg/task_complete.error.codex_error_info [string] n=75 v0.146.0..0.160.0",
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
					evidence: [],
					relation: { kind: "close" },
					gap: {
						sources: [
							"assistant.message.content[fallback].from.model",
							"assistant.message.content[fallback].to.model",
						],
						plan: "parser 9: keep the fallback content block's models.",
					},
					notes:
						"Parser review: claudeSystemFacts reads fallbackModel on system records; it does not join every switch to a refusal.",
					sourceMappings: [
						{
							path: "assistant.message.content[fallback].from.model",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Judge ruling. model_refusal_fallback.fallbackModel explicitly records a refusal fallback, while content[fallback].from/to.model alone does not establish that the switch followed a refusal. Witness: e34d6925-03ea-42a9-af34-77da483add02:55; system/model_refusal_fallback.fallbackModel; type=string; chars=15; version=2.1.284",
						},
						{
							path: "assistant.message.content[fallback].to.model",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Judge ruling. model_refusal_fallback.fallbackModel explicitly records a refusal fallback, while content[fallback].from/to.model alone does not establish that the switch followed a refusal. Witness: e34d6925-03ea-42a9-af34-77da483add02:55; system/model_refusal_fallback.fallbackModel; type=string; chars=15; version=2.1.284",
						},
					],
					justification:
						"Judge ruling. model_refusal_fallback.fallbackModel explicitly records a refusal fallback, while content[fallback].from/to.model alone does not establish that the switch followed a refusal. Witness: e34d6925-03ea-42a9-af34-77da483add02:55; system/model_refusal_fallback.fallbackModel; type=string; chars=15; version=2.1.284",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no fallback records.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no fallback records.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#runs/fallback_model",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for The model the agent switched to after a refusal. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no fallback records. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
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
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"ThreadGoal carries objective, status, tokens_used and time_used_seconds, written on thread_goal_updated events (358, 0.133-0.153.2). Witness: 019e68de:168 event_msg/thread_goal_updated.goal.objective [string] n=358 v0.133.0..0.153.2",
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
				{
					elsewhere:
						"session_git_observations (git extractor, from call outputs)",
				},
				{
					evidence: [],
					relation: { kind: "close" },
					testedIn: "apps/api/src/services/git-observation-parser.test.ts",
					notes:
						"From push output; `gitOperation` records only the pushed branch. Parser review: git-observation-parser.ts:578 parses git-push output conventions, preserving abbreviated push endpoints; not all intermediate commits or arbitrary tool output.",
					justification:
						"The pushed commits are read from `git push` output text, which gives branch and old..new range endpoints, not a recorded list of pushed commits; gitOperation.push has only the branch. Witness: 49ead9e1:23 user.message.content[tool_result].content [string] n=28704 v2.1.220..2.1.293",
				},
			),
			codex: stored(
				[
					"response_item/function_call_output.output",
					"response_item/custom_tool_call_output.output",
				],
				{
					elsewhere:
						"session_git_observations (git extractor, from call outputs)",
				},
				{
					evidence: [],
					relation: { kind: "close" },
					testedIn: "apps/api/src/services/git-observation-parser.test.ts",
					notes:
						"Parser review: git-observation-parser.ts:578 parses git-push output conventions, preserving abbreviated push endpoints; not all intermediate commits or arbitrary call output.",
					justification:
						"The pushed commits are read from `git push` output text (old..new range), not recorded as a list. Witness: 019cb44a:18 response_item/function_call_output.output [string] n=342010 v0.100.0..0.162.0-alpha.2",
				},
			),
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
					evidence: [],
					relation: { kind: "close" },
					gap: {
						sources: ["assistant.message.content[tool_use:mcp__{*}].input"],
						plan: "git extractor: record a pull request a tool linked (`mcp__t3-code__link_pull_request`, 35 calls locally) as linked, not created.",
					},
					notes:
						"Parser review: claudePrLinkFacts reads explicit pr-link fields and gitOperation.pr; the git extractor parses PR URL/result conventions. Repeated reference rows are not distinct PR creations.",
					sourceMappings: [
						{
							path: "assistant.message.content[tool_use:mcp__{*}].input",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"pr-link records give prNumber, prRepository and prUrl but repeat (2302 records for 131 distinct PRs in the same files) and do not say whether the run created or only named the PR; gitOperation.pr.action says created (98), ready, draft or closed. Witness: 49ead9e1:1080 pr-link.prNumber [number] n=2302 v2.1.220..2.1.293",
						},
					],
					justification:
						"pr-link records give prNumber, prRepository and prUrl but repeat (2302 records for 131 distinct PRs in the same files) and do not say whether the run created or only named the PR; gitOperation.pr.action says created (98), ready, draft or closed. Witness: 49ead9e1:1080 pr-link.prNumber [number] n=2302 v2.1.220..2.1.293",
				},
			),
			codex: stored(
				[
					"response_item/function_call_output.output",
					"response_item/custom_tool_call_output.output",
				],
				{
					elsewhere:
						"session_git_observations (git extractor, from call outputs)",
				},
				{
					evidence: [],
					relation: { kind: "close" },
					testedIn: "apps/api/src/services/git-observation-parser.test.ts",
					gap: {
						sources: ["response_item/function_call:*.namespace"],
						plan: "git extractor: match connector tools by namespace and name (43 `_create_pull_request` calls locally produce no observation); needs tool_namespace.",
					},
					notes:
						"Parser review: git-observation-parser parses PR URLs and supported connector result schemas from call results; generic output and namespace are not PR number values.",
					sourceMappings: [
						{
							path: "response_item/function_call:*.namespace",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"PR numbers are read from call output text and connector tool results, a derived text convention rather than a recorded PR field. Witness: 019cb44a:18 response_item/function_call_output.output [string] n=342010 v0.100.0..0.162.0-alpha.2",
						},
					],
					justification:
						"PR numbers are read from call output text and connector tool results, a derived text convention rather than a recorded PR field. Witness: 019cb44a:18 response_item/function_call_output.output [string] n=342010 v0.100.0..0.162.0-alpha.2",
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
				"L1 edges: join pushed commits to `github_ci_runs` (inputs stored, join not built) Review constraint: This is an external cross-system enrichment, not a literal fact written by the agent.",
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: [
							"runs/pushed_shas",
							"runs/repository_id",
							"calls/tool_name",
							"calls/input_text",
						],
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. This is an external cross-system enrichment, not a literal fact written by the agent.",
					justification:
						"Opaline computation, not an agent-written value. The mapping has no transcript source and depends on a planned join to github_ci_runs, whose data and join semantics are not supplied. Witness: fact-mapping-census.json; Read-only local transcript census, 2026-10-09: claude_code: 301 files, 171295 records; codex: 2702 files, 3056337 records; claude_code; no agent source listed for this fact; matching-path observations=0",
				},
			),
			codex: pending(
				[],
				"L1 edges: join pushed commits to `github_ci_runs` (inputs stored, join not built) Review constraint: Separate externally observed CI runs from literal agent CI checks and specify the commit/time join.",
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: [
							"runs/pushed_shas",
							"runs/repository_id",
							"calls/tool_name",
							"calls/input_text",
						],
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. Separate externally observed CI runs from literal agent CI checks and specify the commit/time join.",
					justification:
						"Opaline computation, not an agent-written value. No transcript source directly supplies the CI-after-push edge, and the proposed external github_ci_runs join cannot be verified from these artifacts. Witness: fact-mapping-census.json; Read-only local transcript census, 2026-10-09: claude_code: 301 files, 171295 records; codex: 2702 files, 3056337 records; codex; no agent source listed for this fact; matching-path observations=0",
				},
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
				{
					evidence: [],
					relation: { kind: "provenance" },
					testedIn: "apps/api/src/services/analysis/git-links.test.ts",
					notes:
						"Parser review: The repository identity is CLI git-remote/evidence-index provenance; no Claude transcript field supplies it.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: The repository identity is CLI git-remote/evidence-index provenance; no Claude transcript field supplies it.",
				},
			),
			codex: stored(
				["session_meta/.git.repository_url", "session_meta/.git.commit_hash"],
				{
					elsewhere:
						"Codex git metadata, the git remote from the CLI and the repository evidence index",
				},
				{
					evidence: [],
					relation: { kind: "exact" },
					testedIn: "apps/api/src/services/analysis/git-links.test.ts",
					notes:
						"Parser review: session_meta.git.repository_url is the primary literal remote (2235/2899 reviewer sessions); branch/commit hash are identity context, not repository IDs.",
					sourceMappings: [
						{
							path: "session_meta/.git.commit_hash",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Judge ruling. session_meta.git.repository_url is the git remote of the session's repository (2235 of 2899 sessions); commit_hash is the HEAD commit, not the repository. Witness: 019cb44a:1 session_meta/.git.repository_url [string] n=2235 v0.100.0..0.162.0-alpha.2",
				},
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
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Prompt kinds are still told apart by their wrappers; prompt_origin holds what the agent recorded. Parser review: classifyUserText applies explicit injected/compaction/meta wrappers and queued-prompt deduplication before classifying a prompt; user role alone is not human authorship.",
					justification:
						"Whether a user-role record is a person's prompt, injected context, queued prompt or delegated task is derived from wrappers; the agent records only isMeta (534) and the queued_command attachment. Witness: 49ead9e1:502 user.isMeta [boolean] n=534 v2.1.220..2.1.293",
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
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Prompt kinds are still told apart by their wrappers; prompt_origin holds what the agent recorded. Parser review: userTextItems applies AGENTS/skill/environment and inter-agent conventions and mirror deduplication; user role alone is not human authorship.",
					justification:
						"Kind is derived from message text wrappers and, for inter-agent messages, author/recipient; Codex has no field naming a prompt kind. Witness: 019cb44a:3 response_item/message:user.content[input_text].text [string] n=42652 v0.100.0..0.162.0-alpha.2",
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
		runIndex: ["turn_origin", "prompt_source", "origin_kind"],
		agents: {
			claude_code: stored(
				[
					"user.turnOrigin",
					"user.promptSource",
					"user.origin.kind",
					"attachment/queued_command.attachment.origin.{*}",
					"attachment/queued_command.attachment.origin.from",
					"attachment/queued_command.attachment.origin.fromMode",
					"attachment/queued_command.attachment.origin.hopChain[]",
					"attachment/queued_command.attachment.origin.name",
					"attachment/queued_command.attachment.origin.producer",
					"attachment/queued_command.attachment.origin.senderTaskId",
					"attachment/queued_command.attachment.origin.verifiedPeerPid",
					"user.origin.{*}",
					"user.origin.verifiedPeerPid",
				],
				{ since: 8, facts: ["turn_origin", "prompt_source", "origin_kind"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/prompt_origin/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					gap: {
						sources: [
							"user.origin.producer",
							"user.origin.from",
							"user.origin.fromMode",
							"user.origin.name",
							"user.origin.senderTaskId",
							"user.origin.runId",
							"attachment/queued_command.attachment.origin.kind",
							"attachment/queued_command.attachment.origin.{*}",
							"attachment/queued_command.attachment.origin.from",
							"attachment/queued_command.attachment.origin.fromMode",
							"attachment/queued_command.attachment.origin.hopChain[]",
							"attachment/queued_command.attachment.origin.name",
							"attachment/queued_command.attachment.origin.producer",
							"attachment/queued_command.attachment.origin.senderTaskId",
							"attachment/queued_command.attachment.origin.verifiedPeerPid",
							"user.origin.{*}",
							"user.origin.verifiedPeerPid",
						],
						plan: "parser 9: keep the origin's producer, sender and task id.",
					},
					sourceMappings: [
						{
							path: "user.origin.producer",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"turnOrigin (sdk, task_notification, peer, scheduled, system), promptSource and origin.kind (task-notification, coordinator, peer) are the agent's own recorded prompt origin. Witness: 49ead9e1:3 user.turnOrigin [string] n=2308 v2.1.280..2.1.293",
						},
						{
							path: "user.origin.from",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"turnOrigin (sdk, task_notification, peer, scheduled, system), promptSource and origin.kind (task-notification, coordinator, peer) are the agent's own recorded prompt origin. Witness: 49ead9e1:3 user.turnOrigin [string] n=2308 v2.1.280..2.1.293",
						},
						{
							path: "user.origin.fromMode",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"turnOrigin (sdk, task_notification, peer, scheduled, system), promptSource and origin.kind (task-notification, coordinator, peer) are the agent's own recorded prompt origin. Witness: 49ead9e1:3 user.turnOrigin [string] n=2308 v2.1.280..2.1.293",
						},
						{
							path: "user.origin.name",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"turnOrigin (sdk, task_notification, peer, scheduled, system), promptSource and origin.kind (task-notification, coordinator, peer) are the agent's own recorded prompt origin. Witness: 49ead9e1:3 user.turnOrigin [string] n=2308 v2.1.280..2.1.293",
						},
						{
							path: "user.origin.senderTaskId",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"turnOrigin (sdk, task_notification, peer, scheduled, system), promptSource and origin.kind (task-notification, coordinator, peer) are the agent's own recorded prompt origin. Witness: 49ead9e1:3 user.turnOrigin [string] n=2308 v2.1.280..2.1.293",
						},
						{
							path: "user.origin.runId",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"turnOrigin (sdk, task_notification, peer, scheduled, system), promptSource and origin.kind (task-notification, coordinator, peer) are the agent's own recorded prompt origin. Witness: 49ead9e1:3 user.turnOrigin [string] n=2308 v2.1.280..2.1.293",
						},
						{
							path: "attachment/queued_command.attachment.origin.kind",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"turnOrigin (sdk, task_notification, peer, scheduled, system), promptSource and origin.kind (task-notification, coordinator, peer) are the agent's own recorded prompt origin. Witness: 49ead9e1:3 user.turnOrigin [string] n=2308 v2.1.280..2.1.293",
						},
					],
					relation: { kind: "exact" },
					justification:
						"turnOrigin (sdk, task_notification, peer, scheduled, system), promptSource and origin.kind (task-notification, coordinator, peer) are the agent's own recorded prompt origin. Witness: 49ead9e1:3 user.turnOrigin [string] n=2308 v2.1.280..2.1.293",
				},
			),
			codex: pending(
				["inter_agent_communication/.author"],
				"parser 9: preserve inter-agent author and turn_trigger as literal prompt-origin components; trigger_turn is a turn-trigger flag and thread_source belongs to entrypoint, not origin.",
				{
					relation: {
						kind: "close",
					},
					notes:
						"Remove trigger_turn and thread_source as prompt_origin sources (track trigger_turn as inter_agent_triggers_turn and thread_source under entrypoint) and leave prompt_origin with author/turn_trigger as pending sources. Parser stores the literals correctly: 7,929 inter_agent_communication_metadata records (trigger_turn true 1,111, false 6,818) and 1,470 session_meta with thread_source (user 580, subagent 578, guardian_review 311, realtime_voice 1; 1,436 session_meta have none). trigger_turn is a delivery flag and thread_source a thread classification; the actual origin field inter_agent_communication/.author is not parsed and occurs 0 times locally.",
					justification:
						"Only inter_agent_communication/.author names an origin (writer: protocol.rs:826, AgentPath) and it has no local record and no parser. The other two primary sources are not origins: inter_agent_communication_metadata.trigger_turn is a delivery flag (7,929 records: true 1,111, false 6,818) and session_meta.thread_source classifies how a thread was created (user 580, subagent 578, guardian_review 311, realtime_voice 1; 1,436 session_meta have none). The parser stores trigger_turn and thread_source under their own names, so the mismatch is in the catalog mapping.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/wrong.json#prompts/prompt_origin/codex",
							explanation:
								"Parser stores the literals correctly: 7,929 inter_agent_communication_metadata records (trigger_turn true 1,111, false 6,818) and 1,470 session_meta with thread_source (user 580, subagent 578, guardian_review 311, realtime_voice 1; 1,436 session_meta have none). trigger_turn is a delivery flag and thread_source a thread classification; the actual origin field inter_agent_communication/.author is not parsed and occurs 0 times locally.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#prompts/prompt_origin/codex",
							explanation:
								"Only inter_agent_communication/.author names an origin (writer: protocol.rs:826, AgentPath) and it has no local record and no parser. The other two primary sources are not origins: inter_agent_communication_metadata.trigger_turn is a delivery flag (7,929 records: true 1,111, false 6,818) and session_meta.thread_source classifies how a thread was created (user 580, subagent 578, guardian_review 311, realtime_voice 1; 1,436 session_meta have none). The parser stores trigger_turn and thread_source under their own names, so the mismatch is in the catalog mapping.",
						},
					],
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
				{
					evidence: [],
					relation: {
						kind: "transform",
						transform:
							"decoded prompt text → Unicode code-point character count",
					},
					justification:
						"Judge ruling. User message content records prompt text whose length requires extraction from text blocks or a string. Witness: cb81a350-1d8c-482f-8cf7-d73bffb49715:97; user.message.content; type=string; chars=728; version=2.1.293",
				},
			),
			codex: stored(
				[
					"response_item/message:user.content[input_text].text",
					"event_msg/user_message.message",
				],
				{ since: 1, record: ["text", "textChars"] },
				{
					evidence: [],
					relation: {
						kind: "transform",
						transform:
							"decoded prompt text → Unicode code-point character count",
					},
					justification:
						"Judge ruling. User response-message text or legacy user_message.message records prompt text, with length obtained from the text representation. Witness: rollout-2026-10-09T13-34-17-01a12071-4831-7cb0-8b51-ac8840bb0c3f:4; response_item/message:user.content[input_text].text; type=string; chars=794; version=0.156.0",
					gap: {
						sources: ["inter_agent_communication/.content"],
						plan: "parser 9: read the agreed writer-residue fields separately with their recorded provenance; do not coalesce context with values.",
					},
					notes:
						"Residue path inter_agent_communication/.content is recorded but unparsed; no local witness and no semantic verification is claimed.",
				},
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
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"The instructions attachment lists each loaded file's path and type (Project 188, AutoMem 64, User 16) and nested_memory gives the path of nested ones. Witness: 49ead9e1:12 attachment/instructions.attachment.files[].path [string] n=268 v2.1.280..2.1.293",
				},
			),
			codex: pending(
				[
					"response_item/message:user.content[input_text].text~AGENTS.md instructions",
					"world_state/.state.agents_md.directory",
				],
				"parser 9: keep the directory Codex names for its AGENTS.md instructions (about 3,500 injections locally). Review constraint: Directory plus convention is not a complete file list; do not invent per-file paths absent explicit file provenance.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Codex names the directory, not the file; no file name is invented. Parser review: No parser value is stored for this pending proposal. Directory plus convention is not a complete file list; do not invent per-file paths absent explicit file provenance.",
					justification:
						"Codex names the directory of its AGENTS.md instructions (world_state agents_md.directory 2940) and wraps the text in a user message; no file name is recorded. Witness: 01a1009d:5 world_state/.state.agents_md.directory [string] n=2940 v0.144.1..0.162.0-alpha.2",
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
				"parser 9 or the repository configuration index (order of work step 9), after the decision Review constraint: This is an application-generated hash of injected content, not a claim about byte-identical raw file contents or a hash emitted by Claude.",
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["prompts/instruction_text", "prompts/instruction_path"],
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. This is an application-generated hash of injected content, not a claim about byte-identical raw file contents or a hash emitted by Claude.",
					sourceMappings: [
						{
							path: "attachment/instructions.attachment.files[].content",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "attachment/nested_memory.attachment.content.content",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Opaline computation, not an agent-written value. The loaded instruction content can be hashed deterministically to identify that recorded version, although the agent writes content rather than a hash. Witness: cb81a350-1d8c-482f-8cf7-d73bffb49715:13; attachment/instructions.attachment.files[].content; type=string; chars=116; version=2.1.293",
				},
			),
			codex: pending(
				[
					"world_state/.state.agents_md.text",
					"response_item/message:user.content[input_text].text~AGENTS.md instructions",
				],
				"parser 9 or the repository configuration index (order of work step 9), after the decision Review constraint: A hash of an aggregate/wrapper is not a per-file version hash without explicit file boundaries and a declared framing-removal policy.",
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["prompts/instruction_text", "prompts/instruction_path"],
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. A hash of an aggregate/wrapper is not a per-file version hash without explicit file boundaries and a declared framing-removal policy.",
					sourceMappings: [
						{
							path: "world_state/.state.agents_md.text",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "response_item/message:user.content[input_text].text~AGENTS.md instructions",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Opaline computation, not an agent-written value. A hash is computed from the recorded AGENTS.md text (world_state 2953, injection 3508); Codex writes no hash. Witness: 01a1009d:5 world_state/.state.agents_md.text [string] n=2953 v0.144.1..0.162.0-alpha.2",
				},
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
					evidence: [],
					relation: { kind: "close" },
					gap: {
						sources: ["attachment/prompt_snapshot.attachment.systemPrompt[]"],
						plan: "parser 9: keep the system prompt of `prompt_snapshot` attachments as injected context (493 locally).",
					},
					notes:
						"Parser review: readAttachment stores recognized instructions fragments; prompt_snapshot systemPrompt remains a gap. Stored text is not a complete effective instruction snapshot.",
					sourceMappings: [
						{
							path: "attachment/prompt_snapshot.attachment.systemPrompt[]",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Instruction-file content (268 files), skill listings (314) and MCP instruction blocks (300) are recorded, but the system prompt itself is only in prompt_snapshot.systemPrompt[] (549, gap). Witness: 49ead9e1:12 attachment/instructions.attachment.files[].content [string] n=268 v2.1.280..2.1.293",
						},
					],
					justification:
						"Instruction-file content (268 files), skill listings (314) and MCP instruction blocks (300) are recorded, but the system prompt itself is only in prompt_snapshot.systemPrompt[] (549, gap). Witness: 49ead9e1:12 attachment/instructions.attachment.files[].content [string] n=268 v2.1.280..2.1.293",
				},
			),
			codex: stored(
				[
					"response_item/message:developer.content[input_text].text",
					"response_item/message:user.content[input_text].text~AGENTS.md instructions",
					"session_meta/.base_instructions.text",
					"turn_context/.user_instructions",
					"world_state/.state.agents_md.text",
					"event_msg/item_completed:HookPrompt.fragments[].text",
				],
				{ since: 5, record: ["text"] },
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:HookPrompt.fragments[].text; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:HookPrompt.fragments[].text: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/instruction_text/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "narrower" },
					legacySources: ["turn_context/.user_instructions"],
					gap: {
						sources: [
							"session_meta/.base_instructions.text",
							"turn_context/.user_instructions",
							"world_state/.state.agents_md.text",
							"event_msg/item_completed:HookPrompt.fragments[].text",
						],
						plan: "parser 9: read these additional literal sources without treating different meanings or units as interchangeable.",
					},
					notes:
						"Parser review: readResponseMessage stores recognized injected/developer fragments; session_meta.base_instructions remains a gap, not already stored text.",
					justification:
						"Judge round 3: Each source is one category of the instructions the agent received: developer message text (16,099), the AGENTS.md block inside a user message (a convention match on 189,064 user texts), session base_instructions.text (2,908; 25 distinct), turn_context.user_instructions (4,134) and world_state agents_md.text (2,960). Together they cover the meaning; none covers it alone.",
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
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Parser review: readAttachment extracts edited-file path separately from its snippet; external change notification does not independently identify a human editor.",
					justification:
						"Judge ruling. edited_text_file.filename names a file the agent was told had external edits, whereas snippet is content rather than a path and the notice alone does not identify the editor. Witness: cb81a350-1d8c-482f-8cf7-d73bffb49715:515; attachment/edited_text_file.attachment.filename; type=string; chars=126; version=2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no notice of files edited outside the agent; the 8 `<external_codex_apps_writing_block_edits>` notices (the user edited an app's writing blocks) name no file.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no notice of files edited outside the agent; the 8 `<external_codex_apps_writing_block_edits>` notices (the user edited an app's writing blocks) name no file.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"codex-absence-0.162.0.json#prompts/edited_by_user_path",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for A file the user edited outside the agent, which the agent was told about. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no notice of files edited outside the agent; the 8 `<external_codex_apps_writing_block_edits>` notices (the user edited an app's writing blocks) name no file. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				{
					since: 1,
					record: ["text"],
				},
				{
					relation: {
						kind: "transform",
						transform:
							"extract the name from the '<command-name>...</command-name>' wrapper in the user message text",
					},
					testedIn: "apps/api/src/__tests__/run-index.integration.ts",
					notes:
						"run_index reads the command name from the prompt's `<command-name>` wrapper. Parser review: classifyUserText recognizes command-name/command-message wrappers as injected slash_command records; arbitrary leading-slash text is not that convention.",
					justification:
						"The harness records a slash command as a wrapper in the user message string: '<command-name>/x</command-name>' at the start of message.content (7 string messages locally, all starting with the tag; first 218df37a-f7b3-4546-b045-f236394e2b9d:3), and run_index reads the name from that tag. Arbitrary leading-slash text is not this convention. Local volume is small (7 of 2,606 string user messages; toolUseResult.commandName 49 is a separate Skill/command result field).",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#prompts/slash_command/claude_code",
							explanation:
								"The harness records a slash command as a wrapper in the user message string: '<command-name>/x</command-name>' at the start of message.content (7 string messages locally, all starting with the tag; first 218df37a-f7b3-4546-b045-f236394e2b9d:3), and run_index reads the name from that tag. Arbitrary leading-slash text is not this convention. Local volume is small (7 of 2,606 string user messages; toolUseResult.commandName 49 is a separate Skill/command result field).",
						},
					],
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no slash-command record or wrapper; a prompt can start with typed text such as `/goal`, which cannot be told apart from a path.",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no slash-command record or wrapper; a prompt can start with typed text such as `/goal`, which cannot be told apart from a path.",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#prompts/slash_command",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3324, codex-rs/protocol/src/protocol.rs:3152. Checked the 0.162.0 durable schema/policy and candidate paths for A slash command the user ran. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no slash-command record or wrapper; a prompt can start with typed text such as `/goal`, which cannot be told apart from a path. Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
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
				"parser 9: keep the operation and its ids; pair queue and delivery only by recorded ids. Review constraint: Claude's vocabulary is enqueue/dequeue/remove, not queued/delivered/removed; dequeue is not documented as delivery.",
				{
					evidence: [],
					relation: { kind: "exact" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Claude's vocabulary is enqueue/dequeue/remove, not queued/delivered/removed; dequeue is not documented as delivery.",
					justification:
						"queue-operation records give operation (enqueue 3223, dequeue 2379, remove 804), reason (absorbed_mid_turn, delivered_to_agent), content and ids for a queued prompt. Witness: 49ead9e1:1 queue-operation.operation [string] n=6406 v2.1.220..2.1.293 values={'enqueue': 3223, 'dequeue': 2379, 'remove': 804}",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no queue records.",
				{
					justification:
						"0.162.0 filters ThreadQueueChanged as transient (policy.rs:162). Its notification carries only thread_id (protocol.rs:4145-4147), not queued/delivered/removed operations. Persisted user_input_order is acceptance/delivery order, explicitly independent of queued input recording (history/src/lib.rs:111-114), so it is not a queue-operation counterpart. The snapshot contains no durable queue-operation lifecycle field.",
					relation: {
						kind: "not_emitted",
					},
					notes:
						"Writer absence proof is scoped to Codex 0.162.0; the historical bounded corpus search is retained separately.",
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#prompts/queue_operation",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:162, codex-rs/protocol/src/protocol.rs:4145, codex-rs/history/src/lib.rs:114. 0.162.0 filters ThreadQueueChanged as transient (policy.rs:162). Its notification carries only thread_id (protocol.rs:4145-4147), not queued/delivered/removed operations. Persisted user_input_order is acceptance/delivery order, explicitly independent of queued input recording (history/src/lib.rs:111-114), so it is not a queue-operation counterpart. The snapshot contains no durable queue-operation lifecycle field.",
						},
						{
							kind: "writer_source",
							path: "event_msg/thread_queue_changed",
							file: "codex-rs/rollout/src/policy.rs",
							line: 162,
							version: "0.162.0",
							supportsMeaning: true,
							explanation:
								"0.162.0 filters ThreadQueueChanged as transient (policy.rs:162). Its notification carries only thread_id (protocol.rs:4145-4147), not queued/delivered/removed operations. Persisted user_input_order is acceptance/delivery order, explicitly independent of queued input recording (history/src/lib.rs:111-114), so it is not a queue-operation counterpart. The snapshot contains no durable queue-operation lifecycle field.",
						},
					],
				},
			),
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
					evidence: [],
					gap: {
						sources: [
							"cost-state.modelUsage",
							"cost-state.modelUsage.{*}.*",
							"cost-state.startTime",
						],
						plan: "parser 9: keep the per-model totals.",
					},
					sourceMappings: [
						{
							path: "cost-state.modelUsage",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"The cost-state record holds totalCostUSD, lines added/removed and the tool/API/total durations (303 local records). Witness: 49ead9e1:240 cost-state.totalCostUSD [number] n=303 v2.1.220..2.1.293",
						},
						{
							path: "cost-state.modelUsage.{*}.*",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"The cost-state record holds totalCostUSD, lines added/removed and the tool/API/total durations (303 local records). Witness: 49ead9e1:240 cost-state.totalCostUSD [number] n=303 v2.1.220..2.1.293",
						},
						{
							path: "cost-state.startTime",
							role: "primary",
							relation: { kind: "exact" },
							justification:
								"The cost-state record holds totalCostUSD, lines added/removed and the tool/API/total durations (303 local records). Witness: 49ead9e1:240 cost-state.totalCostUSD [number] n=303 v2.1.220..2.1.293",
						},
					],
					relation: { kind: "exact" },
					justification:
						"The cost-state record holds totalCostUSD, lines added/removed and the tool/API/total durations (303 local records). Witness: 49ead9e1:240 cost-state.totalCostUSD [number] n=303 v2.1.220..2.1.293",
				},
			),
			codex: notRecorded(
				"275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no cumulative cost record; token counts are usage (cost_usd).",
				{
					justification:
						"Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no cumulative cost record; token counts are usage (cost_usd).",
					relation: {
						kind: "not_found",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#session/cost_state",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:2270. Checked the 0.162.0 durable schema/policy and candidate paths for The agent's own running totals for the session: cost, lines changed, time. Census of the local transcripts, 2026-10-09: 275 Claude Code files (2.1.220–2.1.293, 163,945 records) and 2,694 Codex files (0.100–0.162, 3,055,210 records): no cumulative cost record; token counts are usage (cost_usd). Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
				},
			),
		},
	},
	{
		id: "title",
		view: "session",
		meaning: "The session's title.",
		runIndex: ["title"],
		agents: {
			claude_code: stored(
				["ai-title.aiTitle"],
				{ since: 8, facts: ["title"] },
				{
					evidence: [],
					relation: { kind: "exact" },
					justification:
						"ai-title.aiTitle is the session title Claude generates (6779 records across 305 files, so it is rewritten). Witness: 49ead9e1:20 ai-title.aiTitle [string] n=6779 v2.1.220..2.1.293",
				},
			),
			codex: pending(
				[],
				"CLI: read the thread's title from ~/.codex/state_5.sqlite (`threads.title`, 2,153 of 2,634 threads locally) or ~/.codex/session_index.jsonl (404 thread names) and send it with the upload Review constraint: Note says titles live in ~/.codex/state_5.sqlite, so this is not_found in rollouts, not not_emitted.",
				{
					relation: {
						kind: "not_found",
					},
					notes:
						"Not in rollouts: Codex keeps titles in its local state, which is not uploaded today. Parser review: No parser value is stored for this pending proposal. Note says titles live in ~/.codex/state_5.sqlite, so this is not_found in rollouts, not not_emitted.",
					justification:
						"Codex rollouts carry no session title: no top-level title field exists, and the only title paths belong to review targets and ask-user questions. Witness: no session-level title path in the Codex census; event_msg/entered_review_mode.target.title and agent_message.questions[].title are unrelated",
					evidence: [
						{
							kind: "llm_audit",
							reference: "codex-absence-0.162.0.json#session/title",
							explanation:
								"Writer checked: codex-rs/rollout/src/policy.rs:22, codex-rs/protocol/src/models.rs:1014, codex-rs/protocol/src/protocol.rs:3152, codex-rs/state/src/model/thread_metadata.rs:165. Checked the 0.162.0 durable schema/policy and candidate paths for The session's title. Codex rollouts carry no session title: no top-level title field exists, and the only title paths belong to review targets and ask-user questions. Witness: no session-level title path in the Codex census; event_msg/entered_review_mode.target.title and agent_message.questions[].title are unrelated Field-list absence alone is not a persistence exclusion: open tool results, opaque metadata or text conventions prevent a universal writer-absence proof. Candidate fields of different scope/unit are not substituted. Retain not_found.",
						},
					],
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
				"CLI: send the upload mode with the request (not a transcript fact) Review constraint: Move upload provenance out of the agent-literal catalog or explicitly mark its external source.",
				{
					evidence: [],
					relation: { kind: "provenance" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Move upload provenance out of the agent-literal catalog or explicitly mark its external source.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: No parser value is stored for this pending proposal. Move upload provenance out of the agent-literal catalog or explicitly mark its external source.",
				},
			),
			codex: pending(
				[],
				"CLI: send the upload mode with the request (not a transcript fact) Review constraint: Uploader mode is external metadata, not a Codex-written transcript fact.",
				{
					evidence: [],
					relation: { kind: "provenance" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Uploader mode is external metadata, not a Codex-written transcript fact.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: No parser value is stored for this pending proposal. Uploader mode is external metadata, not a Codex-written transcript fact.",
				},
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
				"join of session ownership and workspace membership (not a transcript fact) Review constraint: This workspace aggregate is outside the scope of agent-written L1 facts.",
				{
					evidence: [],
					relation: { kind: "provenance" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. This workspace aggregate is outside the scope of agent-written L1 facts.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: No parser value is stored for this pending proposal. This workspace aggregate is outside the scope of agent-written L1 facts.",
				},
			),
			codex: pending(
				[],
				"join of session ownership and workspace membership (not a transcript fact) Review constraint: Keep this workspace-level aggregate separate from session transcript facts.",
				{
					evidence: [],
					relation: { kind: "provenance" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. Keep this workspace-level aggregate separate from session transcript facts.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: No parser value is stored for this pending proposal. Keep this workspace-level aggregate separate from session transcript facts.",
				},
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
				"repository configuration index (order of work step 9), with instruction_sha256 Review constraint: Specify the path/content/hash grouping and loading boundaries; the empty-source planned index is not a literal version source.",
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["prompts/instruction_path", "prompts/instruction_sha256"],
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. Specify the path/content/hash grouping and loading boundaries; the empty-source planned index is not a literal version source.",
					justification:
						"Opaline computation, not an agent-written value. The entry lists no source and relies on a future configuration index, so per-file session version attribution cannot be verified from the supplied mapping. Witness: cb81a350-1d8c-482f-8cf7-d73bffb49715:13; attachment/instructions.attachment.files[].path; type=string; chars=97; version=2.1.293",
				},
			),
			codex: pending(
				[],
				"repository configuration index (order of work step 9), with instruction_sha256 Review constraint: Require explicit file boundaries and session-loading provenance before assigning individual instruction versions.",
				{
					evidence: [],
					relation: {
						kind: "derived",
						from: ["prompts/instruction_path", "prompts/instruction_sha256"],
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. Require explicit file boundaries and session-loading provenance before assigning individual instruction versions.",
					justification:
						"Opaline computation, not an agent-written value. The empty-source planned configuration index does not demonstrate per-file versions for the aggregate Codex instruction injections. Witness: rollout-2026-10-09T12-47-47-01a12046-b5d8-7690-aeb6-509765d7bec3:4; response_item/message:user.content[input_text].text~AGENTS.md instructions; type=string; chars=1084; version=0.156.0",
				},
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
				"parser 9: counted from permission_decision once its decision is made (the spec said this is not in transcripts; it is). Review constraint: Count only accept with the human decision source; config acceptance is not a user-approved prompt and dialog presence is not independently recorded.",
				{
					evidence: [],
					relation: { kind: "close" },
					notes:
						"Only 5 local decisions were a person's (`user_temporary`); the rest were accepted by the permission mode or rejected by a hook. Parser review: No parser value is stored for this pending proposal. Count only accept with the human decision source; config acceptance is not a user-approved prompt and dialog presence is not independently recorded.",
					justification:
						"Approved prompts are the permissionDecision records with decision accept and a person as source (user_temporary, 5 local); the rest are mode- or hook-made, so the fact is a filtered count. Witness: 06b5ee0c:26 user.permissionDecision.decision [string] n=6471 v2.1.293..2.1.293 values={'accept': 6449, 'reject': 22}",
				},
			),
			codex: notRecorded(
				"ExecApprovalRequest, RequestPermissions and ApplyPatchApprovalRequest are transient events (rollout/src/policy.rs:195-199), and nothing records that the user approved. The listed sources are requests (sandbox_permissions=require_escalated on 555 calls, prefix_rule 450), and the call may simply have run. An approval can only be inferred, not read.",
				{
					relation: {
						kind: "not_emitted",
					},
					notes:
						"Parser review: No parser value is stored for this pending proposal. Listed sources are requests (553 sandbox_permissions=require_escalated), not approvals; an approval is only inferable when a request was not rejected.",
					justification:
						"The Codex writer does not persist approval outcomes: ExecApprovalRequest, RequestPermissions and ApplyPatchApprovalRequest are transient events (rollout/src/policy.rs:195-199), and nothing records that the user approved. The listed sources are requests (sandbox_permissions=require_escalated on 555 calls, prefix_rule 450), and the call may simply have run. An approval can only be inferred, not read.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#session/approved_permission_prompts/codex",
							explanation:
								"The Codex writer does not persist approval outcomes: ExecApprovalRequest, RequestPermissions and ApplyPatchApprovalRequest are transient events (rollout/src/policy.rs:195-199), and nothing records that the user approved. The listed sources are requests (sandbox_permissions=require_escalated on 555 calls, prefix_rule 450), and the call may simply have run. An approval can only be inferred, not read.",
						},
						{
							kind: "writer_source",
							path: "event_msg/exec_approval_request",
							file: "codex-rs/rollout/src/policy.rs",
							line: 160,
							version: "0.162.0",
							supportsMeaning: true,
							explanation:
								"Judge-verified policy.rs:160-199 excludes ExecApprovalRequest, RequestPermissions and ApplyPatchApprovalRequest as transient; request arguments are not approval decisions.",
						},
					],
					sourceMappings: [
						{
							path: "response_item/function_call:exec_command.arguments.sandbox_permissions",
							role: "context",
							relation: {
								kind: "not_emitted",
							},
							justification:
								"The Codex writer does not persist approval outcomes: ExecApprovalRequest, RequestPermissions and ApplyPatchApprovalRequest are transient events (rollout/src/policy.rs:195-199), and nothing records that the user approved. The listed sources are requests (sandbox_permissions=require_escalated on 555 calls, prefix_rule 450), and the call may simply have run. An approval can only be inferred, not read.",
						},
						{
							path: "response_item/function_call:exec_command.arguments.prefix_rule[]",
							role: "context",
							relation: {
								kind: "not_emitted",
							},
							justification:
								"The Codex writer does not persist approval outcomes: ExecApprovalRequest, RequestPermissions and ApplyPatchApprovalRequest are transient events (rollout/src/policy.rs:195-199), and nothing records that the user approved. The listed sources are requests (sandbox_permissions=require_escalated on 555 calls, prefix_rule 450), and the call may simply have run. An approval can only be inferred, not read.",
						},
					],
					sources: [
						"response_item/function_call:exec_command.arguments.sandbox_permissions",
						"response_item/function_call:exec_command.arguments.prefix_rule[]",
					],
				},
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
				{
					elsewhere:
						"Parent session identity comes from the containing transcript stream/ingest lineage; agentId is the child, not the parent.",
				},
				{
					evidence: [],
					relation: { kind: "provenance" },
					testedIn:
						"packages/api-routes/src/session-transcript/transcript-records/split-transcript.test.ts",
					notes:
						"Sub-agent transcripts are streams of their parent's session. Each sub-agent also has an `agent-*.meta.json` beside its transcript (135 locally: `agentType`, `spawnDepth`, the parent call's `toolUseId`, often `model`, a worktree branch for isolated ones), which the CLI does not upload; the depth is Codex's `depth`. Parser review: Stream layout supplies the parent session; agentId identifies the child and isSidechain is context. Neither literal child field is a parent ID.",
					sourceMappings: [
						{
							path: "*.agentId",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "*.isSidechain",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Sub-agent transcripts are streams of their parent's session. Each sub-agent also has an `agent-*.meta.json` beside its transcript (135 locally: `agentType`, `spawnDepth`, the parent call's `toolUseId`, often `model`, a worktree branch for isolated ones), which the CLI does not upload; the depth is Codex's `depth`. Parser review: Stream layout supplies the parent session; agentId identifies the child and isSidechain is context. Neither literal child field is a parent ID.",
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
				"parser 9: keep the parent and fork thread ids and depth of a sub-agent rollout (session lineage links them today, outside transcript records), and drop the tool calls a fork replays from its parent so they are not counted twice (locally 1 of 333 forks replays 137 of its parent's calls, matched by call_id; usage extraction already skips the replayed tokens). Review constraint: session_meta.source.subagent.other is a marker string (guardian), not a parent link.",
				{
					evidence: [],
					relation: { kind: "exact" },
					notes:
						"Parser review: No parser value is stored for this pending proposal. session_meta.source.subagent.other is a marker string (guardian), not a parent link.",
					sourceMappings: [
						{
							path: "session_meta/.source.subagent.thread_spawn.depth",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "session_meta/.source.subagent.thread_spawn.agent_path",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "session_meta/.agent_path",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
						{
							path: "session_meta/.source.subagent.other",
							role: "context",
							relation: { kind: "unreviewed" },
							justification:
								"Context only; not the fact value and not counted as its source.",
						},
					],
					justification:
						"Judge ruling. session_meta.parent_thread_id (881) and forked_from_id (337) name the source thread of a sub-agent or fork, with thread_spawn depth/agent_path as context. Witness: 01a102de:1 session_meta/.parent_thread_id [string] n=881 v0.137.0-alpha.4..0.162.0-alpha.2",
				},
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
			claude_code: stored(
				[],
				{ since: 6, facts: ["facts_truncated"] },
				{
					evidence: [],
					relation: { kind: "provenance" },
					notes:
						"Parser review: Catalog scope correction: Not an agent fact; mapping per agent is N/A.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: Catalog scope correction: Not an agent fact; mapping per agent is N/A.",
				},
			),
			codex: stored(
				[],
				{ since: 6, facts: ["facts_truncated"] },
				{
					evidence: [],
					relation: { kind: "provenance" },
					notes:
						"Parser review: Catalog scope correction: Not an agent fact; mapping per agent is N/A.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: Catalog scope correction: Not an agent fact; mapping per agent is N/A.",
				},
			),
		},
	},
	{
		id: "facts_clipped",
		view: "session",
		meaning: "Which of a record's fact values were cut at their length cap.",
		agents: {
			claude_code: stored(
				[],
				{ since: 7, facts: ["facts_clipped"] },
				{
					evidence: [],
					relation: { kind: "provenance" },
					notes:
						"Parser review: Catalog scope correction: Not an agent fact; mapping per agent is N/A.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: Catalog scope correction: Not an agent fact; mapping per agent is N/A.",
				},
			),
			codex: stored(
				[],
				{ since: 7, facts: ["facts_clipped"] },
				{
					evidence: [],
					relation: { kind: "provenance" },
					notes:
						"Parser review: Catalog scope correction: Not an agent fact; mapping per agent is N/A.",
					justification:
						"Opaline ingest/parser/workspace bookkeeping; N/A per agent. Parser review: Catalog scope correction: Not an agent fact; mapping per agent is N/A.",
				},
			),
		},
	},
	{
		id: "memory_citation_location",
		view: "runs",
		meaning:
			"The recorded memory source path and cited line interval on an assistant message.",
		agents: {
			claude_code: notRecorded(
				"regex /memory/ matches only attachment/nested_memory.* (instruction files, 42 records), none is a citation of a memory source with a line interval. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /memory/ matches only attachment/nested_memory.* (instruction files, 42 records), none is a citation of a memory source with a line interval. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/memory_citation_location/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /memory/ matches only attachment/nested_memory.* (instruction files, 42 records), none is a citation of a memory source with a line interval. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/agent_message.memory_citation.entries[].lineEnd",
					"event_msg/agent_message.memory_citation.entries[].lineStart",
					"event_msg/agent_message.memory_citation.entries[].path",
					"event_msg/item_completed:AgentMessage.memory_citation.entries[].lineEnd",
					"event_msg/item_completed:AgentMessage.memory_citation.entries[].lineStart",
					"event_msg/item_completed:AgentMessage.memory_citation.entries[].path",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. A citation location is explicit provenance for the answer, not a tool-read file path.",
					justification:
						"MemoryCitationEntry carries path, line_start and line_end (camelCase on the wire: lineStart/lineEnd) for each cited memory span, exactly the 'memory source path and cited line interval'. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/memory_citation_location/codex",
							explanation:
								"MemoryCitationEntry carries path, line_start and line_end (camelCase on the wire: lineStart/lineEnd) for each cited memory span, exactly the 'memory source path and cited line interval'. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "memory_citation_rollout_id",
		view: "runs",
		meaning:
			"The rollout identifiers explicitly cited as memory sources by an assistant message.",
		agents: {
			claude_code: notRecorded(
				"regex /memory|citation/ matches nothing that lists rollout ids. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /memory|citation/ matches nothing that lists rollout ids. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/memory_citation_rollout_id/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /memory|citation/ matches nothing that lists rollout ids. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/agent_message.memory_citation.rolloutIds[]",
					"event_msg/item_completed:AgentMessage.memory_citation.rolloutIds[]",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. These are cited-source rollouts, not the current session or its parent; retain their citation relationship.",
					justification:
						"MemoryCitation.rollout_ids (rolloutIds[] on the wire) lists the rollouts a memory citation came from, the fact. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/memory_citation_rollout_id/codex",
							explanation:
								"MemoryCitation.rollout_ids (rolloutIds[] on the wire) lists the rollouts a memory citation came from, the fact. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "review_target",
		view: "runs",
		meaning:
			"The recorded review target kind and its branch or commit identifier when applicable.",
		agents: {
			claude_code: notRecorded(
				"regex /review/ matches 0 of 1,089 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /review/ matches 0 of 1,089 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_target/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /review/ matches 0 of 1,089 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/entered_review_mode.target.branch",
					"event_msg/entered_review_mode.target.sha",
					"event_msg/entered_review_mode.target.type",
					"event_msg/item_completed:EnteredReviewMode.target.branch",
					"event_msg/item_completed:EnteredReviewMode.target.sha",
					"event_msg/item_completed:EnteredReviewMode.target.type",
					"event_msg/entered_review_mode.target.title",
					"event_msg/item_completed:EnteredReviewMode.target.title",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_target/codex",
							explanation:
								"ReviewTarget is a tagged enum with type uncommittedChanges | baseBranch | commit | custom plus branch (BaseBranch) and sha (Commit), exactly the 'review target kind and its branch or commit identifier'. The Commit title and Custom.instructions are other fields. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/entered_review_mode.target.title; judge2/sonnet/residue.json",
							explanation:
								"event_msg/entered_review_mode.target.title: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:EnteredReviewMode.target.title; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:EnteredReviewMode.target.title: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/review_target/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					notes:
						"Independent new_fact residue agreement; zero local path observations. The target explicitly scopes a review and is not evidence that a git operation was executed.",
					justification:
						"Judge round 3: ReviewTarget.type plus BaseBranch.branch or Commit.sha exactly identifies the review scope. Commit.title is an optional human-readable UI label, expressly not the target kind or branch/commit identity.",
				},
			),
		},
	},
	{
		id: "review_finding_location",
		view: "runs",
		meaning:
			"The file path and inclusive start/end line interval explicitly attached to a review finding.",
		agents: {
			claude_code: notRecorded(
				"regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_finding_location/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/exited_review_mode.review_output.findings[].code_location.absolute_file_path",
					"event_msg/exited_review_mode.review_output.findings[].code_location.line_range.end",
					"event_msg/exited_review_mode.review_output.findings[].code_location.line_range.start",
					"event_msg/item_completed:ExitedReviewMode.review_output.findings[].code_location.absolute_file_path",
					"event_msg/item_completed:ExitedReviewMode.review_output.findings[].code_location.line_range.end",
					"event_msg/item_completed:ExitedReviewMode.review_output.findings[].code_location.line_range.start",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. Review finding location is distinct from a file the agent actually read or changed.",
					justification:
						"ReviewCodeLocation.absolute_file_path with ReviewLineRange{start,end} (inclusive) is the finding's file and line interval. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_finding_location/codex",
							explanation:
								"ReviewCodeLocation.absolute_file_path with ReviewLineRange{start,end} (inclusive) is the finding's file and line interval. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "review_finding_confidence",
		view: "runs",
		meaning:
			"The numeric confidence score explicitly reported for a review finding.",
		agents: {
			claude_code: notRecorded(
				"regex /review|confidence/ matches 0 Claude paths about reviews. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /review|confidence/ matches 0 Claude paths about reviews. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_finding_confidence/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /review|confidence/ matches 0 Claude paths about reviews. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/exited_review_mode.review_output.findings[].confidence_score",
					"event_msg/item_completed:ExitedReviewMode.review_output.findings[].confidence_score",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. This is a recorded review assessment, not confidence inferred by the catalog judge.",
					justification:
						"ReviewFinding.confidence_score: f32 is the reviewer's own confidence for the finding. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_finding_confidence/codex",
							explanation:
								"ReviewFinding.confidence_score: f32 is the reviewer's own confidence for the finding. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "review_finding_priority",
		view: "runs",
		meaning: "The numeric priority explicitly assigned to a review finding.",
		agents: {
			claude_code: notRecorded(
				"regex /review|priority/ matches 0 Claude paths about reviews. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /review|priority/ matches 0 Claude paths about reviews. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_finding_priority/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /review|priority/ matches 0 Claude paths about reviews. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/exited_review_mode.review_output.findings[].priority",
					"event_msg/item_completed:ExitedReviewMode.review_output.findings[].priority",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. Finding priority is directly emitted and has no existing catalog fact.",
					justification:
						"ReviewFinding.priority: i32 is the numeric priority the finding was given. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_finding_priority/codex",
							explanation:
								"ReviewFinding.priority: i32 is the numeric priority the finding was given. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "review_overall_confidence",
		view: "runs",
		meaning:
			"The overall numeric confidence score explicitly reported by a completed review.",
		agents: {
			claude_code: notRecorded(
				"regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_overall_confidence/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/exited_review_mode.review_output.overall_confidence_score",
					"event_msg/item_completed:ExitedReviewMode.review_output.overall_confidence_score",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. Overall confidence has review scope rather than per-finding scope.",
					justification:
						"ReviewOutputEvent.overall_confidence_score: f32 is the review-level confidence (finding level is separate). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_overall_confidence/codex",
							explanation:
								"ReviewOutputEvent.overall_confidence_score: f32 is the review-level confidence (finding level is separate). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "review_correctness",
		view: "runs",
		meaning:
			"The overall correctness verdict explicitly reported by a completed review.",
		agents: {
			claude_code: notRecorded(
				"regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_correctness/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /review/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/exited_review_mode.review_output.overall_correctness",
					"event_msg/item_completed:ExitedReviewMode.review_output.overall_correctness",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. This is an explicit verdict, not an inference from explanatory prose.",
					justification:
						"ReviewOutputEvent.overall_correctness: String is the review's overall verdict, written by the reviewer (not inferred). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/review_correctness/codex",
							explanation:
								"ReviewOutputEvent.overall_correctness: String is the review's overall verdict, written by the reviewer (not inferred). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "audio_input",
		view: "prompts",
		meaning:
			"A user prompt explicitly includes audio, with remote/local reference type but never encoded audio bytes.",
		agents: {
			claude_code: notRecorded(
				"regex /audio/ matches 0 Claude paths; the only content-block shapes seen are text, image, tool_use/result. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /audio/ matches 0 Claude paths; the only content-block shapes seen are text, image, tool_use/result. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#prompts/audio_input/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /audio/ matches 0 Claude paths; the only content-block shapes seen are text, image, tool_use/result. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:UserMessage.content[audio].audio_url",
					"event_msg/item_completed:UserMessage.content[local_audio].path",
					"event_msg/user_message.audio[]",
					"event_msg/user_message.local_audio[]",
					"response_item/message:*.content[input_audio].audio_url",
					"event_msg/user_message.audio",
					"event_msg/user_message.local_audio",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#prompts/audio_input/codex",
							explanation:
								"UserInput::Audio{audio_url} is a pre-encoded audio data URI and LocalAudio{path} a local path (user_input.rs:43-46), so the sources carry the audio payload or its location; the fact wants presence and reference type only, never bytes. Source meaning includes the fact. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/user_message.audio; judge2/sonnet/residue.json",
							explanation:
								"event_msg/user_message.audio: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/user_message.local_audio; judge2/sonnet/residue.json",
							explanation:
								"event_msg/user_message.local_audio: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/audio_input/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "broader" },
					notes:
						"Independent new_fact residue agreement; zero local path observations. Typed audio/local-audio input establishes presence; on wildcard message paths require role=user and retain no audio URL data payload.",
					justification:
						"Judge round 3: InputAudio carries the audio payload or URL (audio_url) and the local variant a file path; the fact keeps only that audio was included and whether the reference is remote or local, never the payload, so the sources are wider than the meaning.",
				},
			),
		},
	},
	{
		id: "rolled_back_turns",
		view: "runs",
		meaning:
			"The explicit number of turns rolled back by a thread rollback event.",
		agents: {
			claude_code: notRecorded(
				"regex /rollback|rewind|revert|undo|rolled/ matches 0 Claude paths. Claude Code rewinds are visible only as parentUuid branching (1,104 parents with several children), not as an event with a count; the SDK has rewindFiles (sdk.d.ts:3120-3123) as a control request, not a transcript field. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /rollback|rewind|revert|undo|rolled/ matches 0 Claude paths. Claude Code rewinds are visible only as parentUuid branching (1,104 parents with several children), not as an event with a count; the SDK has rewindFiles (sdk.d.ts:3120-3123) as a control request, not a transcript field. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/rolled_back_turns/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /rollback|rewind|revert|undo|rolled/ matches 0 Claude paths. Claude Code rewinds are visible only as parentUuid branching (1,104 parents with several children), not as an event with a count; the SDK has rewindFiles (sdk.d.ts:3120-3123) as a control request, not a transcript field. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				["event_msg/thread_rolled_back.num_turns"],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. The writer records an actual rollback count rather than a count inferred from surviving history.",
					justification:
						"ThreadRolledBackEvent.num_turns: u32 is documented 'Number of user turns that were removed from context', the explicit rollback count. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/rolled_back_turns/codex",
							explanation:
								"ThreadRolledBackEvent.num_turns: u32 is documented 'Number of user turns that were removed from context', the explicit rollback count. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "file_input",
		view: "prompts",
		meaning:
			"A user prompt explicitly carries provider file attachments, recording attachment presence/reference metadata rather than file contents.",
		agents: {
			claude_code: notRecorded(
				"regex /document|file_id|attachments/ matches only user.queueSkipAttachments (616, a queue flag); no document or file content block exists in 175,336 records. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /document|file_id|attachments/ matches only user.queueSkipAttachments (616, a queue flag); no document or file content block exists in 175,336 records. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#prompts/file_input/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /document|file_id|attachments/ matches only user.queueSkipAttachments (616, a queue flag); no document or file content block exists in 175,336 records. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"event_msg/user_message.file_id_details[]",
					"event_msg/user_message.file_ids[]",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "narrower",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. File attachments are a separate input modality from images and audio; retain only reference metadata, never attachment bytes.",
					justification:
						"file_ids and file_id_details are not generic file attachments: protocol.rs:2584-2592 says 'File IDs sourced from UserInput::Image', and the writer test builds them from an image input (protocol.rs:6083-6093). UserInput has no file variant (user_input.rs:16-58: Text, Image, LocalImage, Audio, LocalAudio, Skill, Mention). So they are file-backed images, a subset of 'provider file references'. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#prompts/file_input/codex",
							explanation:
								"file_ids and file_id_details are not generic file attachments: protocol.rs:2584-2592 says 'File IDs sourced from UserInput::Image', and the writer test builds them from an image input (protocol.rs:6083-6093). UserInput has no file variant (user_input.rs:16-58: Text, Image, LocalImage, Audio, LocalAudio, Skill, Mention). So they are file-backed images, a subset of 'provider file references'. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "realtime_session_outcome",
		view: "runs",
		meaning:
			"The explicitly recorded outcome enum when a realtime conversation session closes.",
		agents: {
			claude_code: notRecorded(
				"regex /realtime|voice|speech/ matches only user.queueTranscriptOnly (26, a queue flag). The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /realtime|voice|speech/ matches only user.queueTranscriptOnly (26, a queue flag). The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/realtime_session_outcome/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /realtime|voice|speech/ matches only user.queueTranscriptOnly (26, a queue flag). The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				["realtime_item/.outcome"],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. Realtime feature-session ended/failed status has a different scope from a coding turn abort.",
					justification:
						"RealtimeItemContent::RealtimeSessionClosed{outcome} with outcome ended | failed is the explicit outcome of a realtime session (realtime.rs:30-32, 38-42). Realtime items are persisted only in paginated mode (rollout/src/policy.rs:38-40). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/realtime_session_outcome/codex",
							explanation:
								"RealtimeItemContent::RealtimeSessionClosed{outcome} with outcome ended | failed is the explicit outcome of a realtime session (realtime.rs:30-32, 38-42). Realtime items are persisted only in paginated mode (rollout/src/policy.rs:38-40). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "realtime_transcript_role",
		view: "runs",
		meaning:
			"The recorded user/assistant speaker role of a realtime transcript segment.",
		agents: {
			claude_code: notRecorded(
				"regex /realtime|voice|speech/ matches nothing relevant. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /realtime|voice|speech/ matches nothing relevant. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/realtime_transcript_role/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /realtime|voice|speech/ matches nothing relevant. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				["realtime_item/.role"],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. Speaker role in realtime speech is not an inference from message content or a permission decision.",
					justification:
						"TranscriptSegment{role: user | assistant, text} gives the speaker role (realtime.rs:21-24, 46-50). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/realtime_transcript_role/codex",
							explanation:
								"TranscriptSegment{role: user | assistant, text} gives the speaker role (realtime.rs:21-24, 46-50). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "realtime_event_kind",
		view: "runs",
		meaning:
			"The explicit realtime record kind, such as transcript segment, session start or session close.",
		agents: {
			claude_code: notRecorded(
				"regex /realtime|voice|speech/ matches nothing relevant. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /realtime|voice|speech/ matches nothing relevant. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/realtime_event_kind/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /realtime|voice|speech/ matches nothing relevant. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				["realtime_item/.type"],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. The event discriminator records a realtime lifecycle event, separate from ordinary turn completion.",
					justification:
						"RealtimeItemContent is tagged by type (snake_case): realtime_session_started | transcript_segment | bem_item_promoted | realtime_session_closed (realtime.rs:19-35), which is the record kind of the fact. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/realtime_event_kind/codex",
							explanation:
								"RealtimeItemContent is tagged by type (snake_case): realtime_session_started | transcript_segment | bem_item_promoted | realtime_session_closed (realtime.rs:19-35), which is the record kind of the fact. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "security_risk_score",
		view: "runs",
		meaning:
			"The security classifier name and numeric score explicitly recorded in a risk snapshot.",
		agents: {
			claude_code: notRecorded(
				"regex /risk|classif|score/ matches no classifier score; auto_mode attachments (280) carry mode flags only. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /risk|classif|score/ matches no classifier score; auto_mode attachments (280) carry mode flags only. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/security_risk_score/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /risk|classif|score/ matches no classifier score; auto_mode attachments (280) carry mode flags only. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				["security_risk_score/.scores.{*}", "security_risk_score/.sampled_at"],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. These are classifier scores, not the automatic reviewer’s allow/deny verdict.",
					justification:
						"SecurityRiskScore.scores is a BTreeMap<classifier name, f64>; the key is the classifier and the value its score, which is what the fact says. The record type is persisted (rollout/src/policy.rs:47). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/security_risk_score/codex",
							explanation:
								"SecurityRiskScore.scores is a BTreeMap<classifier name, f64>; the key is the classifier and the value its score, which is what the fact says. The record type is persisted (rollout/src/policy.rs:47). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#security_risk_score/.sampled_at; judge2/sonnet/residue.json",
							explanation: "security_risk_score/* n=0 local records",
						},
					],
					sourceMappings: [
						{
							path: "security_risk_score/.sampled_at",
							role: "context",
							relation: {
								kind: "unreviewed",
							},
							justification:
								"sampled_at is when risk sampling started (security_risk.rs:21-25), a field of the same snapshot whose scores are the agreed runs/security_risk_score. A timestamp of that snapshot, not identity bookkeeping; keep it with the scores so a score can be placed in time. The record type is persisted (rollout/src/policy.rs:47).",
						},
					],
				},
			),
		},
	},
	{
		id: "session_memory_mode",
		view: "session",
		meaning: "The memory mode explicitly selected for a session.",
		agents: {
			claude_code: notRecorded(
				"regex /memoryMode|memory_mode|autoMemory/ matches nothing in the transcript; autoMemoryEnabled exists only as an SDK settings option (sdk.d.ts:9114). The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /memoryMode|memory_mode|autoMemory/ matches nothing in the transcript; autoMemoryEnabled exists only as an SDK settings option (sdk.d.ts:9114). The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#session/session_memory_mode/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /memoryMode|memory_mode|autoMemory/ matches nothing in the transcript; autoMemoryEnabled exists only as an SDK settings option (sdk.d.ts:9114). The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				["session_meta/.memory_mode"],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					relation: {
						kind: "exact",
					},
					notes:
						"Independent new_fact residue agreement; zero local path observations. Session memory configuration is literal context policy and not compaction occurrence or prompt-cache behavior.",
					justification:
						"SessionMeta.memory_mode: Option<String> records the memory mode set for the thread (ThreadMemoryMode is enabled | disabled, protocol.rs:786-789, set through SetThreadMemoryMode, protocol.rs:748). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#session/session_memory_mode/codex",
							explanation:
								"SessionMeta.memory_mode: Option<String> records the memory mode set for the thread (ThreadMemoryMode is enabled | disabled, protocol.rs:786-789, set through SetThreadMemoryMode, protocol.rs:748). 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
					],
				},
			),
		},
	},
	{
		id: "selected_capability_roots",
		view: "runs",
		meaning:
			"The capability-root identifiers and typed environment/path locations explicitly selected for a session.",
		agents: {
			claude_code: notRecorded(
				"regex /capabilit|roots|additionalDirectories/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
				{
					relation: {
						kind: "not_found",
					},
					justification:
						"Bounded census search over the Claude corpus found no field for this: regex /capabilit|roots|additionalDirectories/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/selected_capability_roots/claude_code",
							explanation:
								"Bounded census search over the Claude corpus found no field for this: regex /capabilit|roots|additionalDirectories/ matches 0 Claude paths. The SDK types (sdk.d.ts, sdk-tools.d.ts) define no equivalent either. Absence is not_found (census only), not not_emitted, because no Claude Code writer source is available.",
						},
					],
				},
			),
			codex: pending(
				[
					"session_meta/.selected_capability_roots[].id",
					"session_meta/.selected_capability_roots[].location.path",
					"session_meta/.selected_capability_roots",
					"session_meta/.selected_capability_roots[].location.environmentId",
					"session_meta/.selected_capability_roots[].location.type",
				],
				"parser 9: retain these explicit writer fields with record provenance and separate payload components; add a real-data witness before judging their relation.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sonnet/mappings.json#runs/selected_capability_roots/codex",
							explanation:
								"SelectedCapabilityRoot{id, location} with location tagged environment{environmentId, path} (camelCase) is the fact. 0 of 3,059,068 Codex records locally (no writer-produced instance), so judged from the writer struct only.",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.selected_capability_roots; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.selected_capability_roots: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.selected_capability_roots[].location.environmentId; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.selected_capability_roots[].location.environmentId: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.selected_capability_roots[].location.type; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.selected_capability_roots[].location.type: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/selected_capability_roots/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					notes:
						"Independent new_fact residue agreement; zero local path observations. Capability selection is distinct from executed cwd or compiled filesystem permissions.",
					justification:
						"Judge round 3: SelectedCapabilityRoot has a stable platform ID and a typed environment location consisting of environmentId and an absolute path. The source components have exactly the defined selection meaning; an empty selected roots container means an empty selection, not a new root.",
				},
			),
		},
	},

	{
		id: "model_provider",
		view: "session",
		meaning: "The provider explicitly selected for the session's model.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/model_provider/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"session_meta/.model_provider",
					"event_msg/thread_settings_applied.thread_settings.model_provider_id",
				],
				"parser 9: retain model_provider with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/model_provider/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: SessionMeta.model_provider is the session provider selection; ThreadSettings.model_provider_id is the explicitly updated selection. Keep initialization/update provenance without asserting either is a response billing provider.",
				},
			),
		},
	},
	{
		id: "command_source",
		view: "calls",
		meaning:
			"Who initiated a command: agent, user shell, unified-exec startup or interaction.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/command_source/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CommandExecution.source",
					"event_msg/exec_command_end.source",
				],
				"parser 9: retain command_source with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference: "docs/l1-judge-round2.md#watch-follow-up",
							explanation:
								"event_msg/exec_command_end.source: 65 observed records; same meaning and unit as this pending fact, not ignored as generic bookkeeping.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/command_source/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					legacySources: ["event_msg/exec_command_end.source"],
					justification:
						"Judge round 3: ExecCommandSource explicitly defines agent, user_shell, unified_exec_startup and unified_exec_interaction. Both CommandExecution and exec_command_end carry that typed source.",
				},
			),
		},
	},
	{
		id: "message_created_at",
		view: "runs",
		meaning:
			"The literal creation time of a message or call, not a timestamp inside a compaction history.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/message_created_at/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"response_item/*.internal_chat_message_metadata_passthrough.create_time",
				],
				"parser 9: retain message_created_at with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/message_created_at/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: InternalChatMessageMetadataPassthrough.create_time is explicitly message creation time in fractional Unix seconds. The source is not an ordinal or a compaction timestamp; preserve fractional-second units as recorded.",
				},
			),
		},
	},
	{
		id: "message_provenance",
		view: "prompts",
		meaning:
			"The retained source turn id, inherited-user-message marker and client-authored developer-message flag, kept independently as message-origin components.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/message_provenance/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"response_item/message:*@metadata.retained_source.id.turn_id",
					"response_item/message:user@metadata.inherited_user_message",
					"response_item/message:*@metadata.client_authored",
					"response_item/message:assistant@metadata.inherited_user_message",
				],
				"parser 9: retain message_provenance as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference: "docs/l1-judge-round2.md#watch-follow-up",
							explanation:
								"response_item/message:*@metadata.client_authored: 53034 observed records; same meaning and unit as this pending fact, not ignored as generic bookkeeping.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/message_provenance/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/message_provenance/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: Retained-source turn attribution, inherited parent-message context and client-authored developer-message provenance are distinct recorded origin components. The writer documents each; retain them independently and never treat inherited parent context as child-local authorization.",
				},
			),
		},
	},
	{
		id: "offered_tools",
		view: "runs",
		meaning:
			"The names and MCP servers of tools offered to the model; never their schemas or descriptions.",
		agents: {
			claude_code: pending(
				[
					"attachment/prompt_snapshot.attachment.tools[].name",
					"attachment/prompt_snapshot.attachment.tools[].server",
					"user.toolUseResult.matches[]",
					"attachment/deferred_tools_delta.attachment.addedNames[]",
					"attachment/deferred_tools_delta.attachment.readdedNames[]",
					"attachment/deferred_tools_delta.attachment.removedNames[]",
					"attachment/deferred_tools_delta.attachment.surfacedDefinitions[].definition.name",
					"attachment/deferred_tools_delta.attachment.surfacedDefinitions[].name",
					"attachment/deferred_tools_delta.attachment.surfacedNames[]",
					"attachment/deferred_tools_record.attachment.entries[].name",
					"attachment/deferred_tools_record.attachment.nameOnlyAnnouncements[]",
				],
				"parser 9: retain offered_tools with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/offered_tools/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Definition name/server and discovery result name references identify offered tools, conditional on attachment/result schema provenance. Added/re-added/current names describe availability while removed names describe withdrawal; the fact must not mark all primary names currently offered.",
				},
			),
			codex: pending(
				[
					"response_item/tool_search_output.tools[].tools[].name",
					"session_meta/.dynamic_tools[].tools[].name",
					"session_meta/.dynamic_tools[].name",
				],
				"parser 9: retain offered_tools as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/offered_tools/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/offered_tools/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Namespace-contained function names identify offered functions, but ToolSearchOutput.tools[].name can instead be the name of a namespace. The writer represents Function and Namespace as different definition kinds, and namespace names are not individual tool names.",
				},
			),
		},
	},
	{
		id: "thinking_drop",
		view: "runs",
		meaning:
			"The counts of thinking messages and turns explicitly dropped from the model context.",
		agents: {
			claude_code: pending(
				[
					"attachment/thinking_drop.attachment.newlyDropped.blockCount",
					"attachment/thinking_drop.attachment.newlyDropped.turnCount",
					"attachment/thinking_drop.attachment.thinkingBlocksSent",
					"attachment/thinking_drop.attachment.thinkingTurnsSent",
				],
				"parser 9: retain thinking_drop with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/thinking_drop/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: newlyDropped.blockCount / turnCount are the counts of thinking blocks and turns dropped in that report (14 reports; 1 to 126 blocks); thinkingBlocksSent / thinkingTurnsSent are the counts still sent (complement), so two sources are exactly the fact and two are its opposite.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/thinking_drop/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
		},
	},
	{
		id: "patch_hunks",
		view: "calls",
		meaning:
			"Each patch hunk's old/new start line and line count, preserving hunk order.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.structuredPatch[].oldStart",
					"user.toolUseResult.structuredPatch[].oldLines",
					"user.toolUseResult.structuredPatch[].newStart",
					"user.toolUseResult.structuredPatch[].newLines",
					"user.toolUseResult.bashEditDiff.files[].hunks[].newLines",
					"user.toolUseResult.bashEditDiff.files[].hunks[].newStart",
					"user.toolUseResult.bashEditDiff.files[].hunks[].oldLines",
					"user.toolUseResult.bashEditDiff.files[].hunks[].oldStart",
				],
				"parser 9: retain patch_hunks as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].oldStart",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3409 (FileEditOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileEditOutput explicitly declares oldStart as number.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].oldStart",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3457 (FileWriteOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileWriteOutput explicitly declares oldStart as number.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].oldLines",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3410 (FileEditOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileEditOutput explicitly declares oldLines as number.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].oldLines",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3458 (FileWriteOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileWriteOutput explicitly declares oldLines as number.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].newStart",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3411 (FileEditOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileEditOutput explicitly declares newStart as number.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].newStart",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3459 (FileWriteOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileWriteOutput explicitly declares newStart as number.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].newLines",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3412 (FileEditOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileEditOutput explicitly declares newLines as number.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.structuredPatch[].newLines",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3460 (FileWriteOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"FileWriteOutput explicitly declares newLines as number.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/patch_hunks/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Published SDK 0.3.287 declares these named literal components; preserve each component's own unit rather than combining values.",
				},
			),
			codex: pending(
				["event_msg/item_completed:FileChange.changes.{*}.unified_diff"],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/patch_hunks/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: {
						kind: "transform",
						transform:
							"parse numbered unified-diff hunk headers into ordered old/new start/count components",
					},
					justification:
						"Judge round 3: Codex does not write hunk start/count as fields, but item_completed FileChange changes.{*}.unified_diff holds unified-diff hunk headers: 62,748 of 62,823 diffs contain numbered '@@ -a,b +c,d @@' headers (173,724 hunks), so the old/new start and counts can be parsed in hunk order.",
				},
			),
		},
	},
	{
		id: "task_status_change",
		view: "calls",
		meaning:
			"The task status before and after a TaskUpdate, kept as separate transition endpoints.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.statusChange.from",
					"user.toolUseResult.statusChange.to",
				],
				"parser 9: retain task_status_change with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					relation: {
						kind: "exact",
					},
					justification:
						"Published SDK 0.3.287 declares these named literal components; preserve each component's own unit rather than combining values.",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.statusChange.from",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3996 (TaskUpdateOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"TaskUpdateOutput explicitly declares from as string.",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.statusChange.to",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3997 (TaskUpdateOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "TaskUpdateOutput explicitly declares to as string.",
						},
					],
				},
			),
			codex: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/task_status_change/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
		},
	},
	{
		id: "read_extent",
		view: "calls",
		meaning:
			"The returned file start line, returned and total line counts, and image dimensions, kept as separate extent components.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.file.totalLines",
					"user.toolUseResult.file.numLines",
					"user.toolUseResult.file.startLine",
					"user.toolUseResult.file.dimensions.**",
				],
				"parser 9: retain read_extent with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					relation: {
						kind: "exact",
					},
					justification:
						"Published SDK 0.3.287 declares these named literal components; preserve each component's own unit rather than combining values.",
					evidence: [
						{
							kind: "published_types",
							path: "user.toolUseResult.file.totalLines",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:229 (FileReadOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Total number of lines in the file",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.file.numLines",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:221 (FileReadOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Number of lines in the returned content",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.file.startLine",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:225 (FileReadOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "The starting line number",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.file.dimensions.displayHeight",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:277 (FileReadOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Displayed image height in pixels (after resizing)",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.file.dimensions.displayWidth",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:273 (FileReadOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Displayed image width in pixels (after resizing)",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.file.dimensions.originalHeight",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:269 (FileReadOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Original image height in pixels",
						},
						{
							kind: "published_types",
							path: "user.toolUseResult.file.dimensions.originalWidth",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:265 (FileReadOutput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation: "Original image width in pixels",
						},
					],
				},
			),
			codex: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/read_extent/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
		},
	},
	{
		id: "stale_read_recovered",
		view: "calls",
		meaning: "Whether a stale file read was recovered before the edit.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.staleRecovered"],
				"parser 9: retain stale_read_recovered with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/stale_read_recovered/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "unreviewed" },
					justification:
						"Judge round 3: The boolean has local witnesses, but staleRecovered is absent from the supplied FileEditOutput/FileWriteOutput declarations. An allowed writer/type definition of the recovery flag and when it is set is missing; the name alone cannot establish recovery-before-edit semantics.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/stale_read_recovered/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
		},
	},
	{
		id: "record_uuid",
		view: "session",
		meaning:
			"The literal record UUID and parent UUID links of the conversation tree, not physical line order.",
		agents: {
			claude_code: pending(
				[
					"*.uuid",
					"*.parentUuid",
					"*.logicalParentUuid",
					"user.sourceToolAssistantUUID",
					"*.refusedUserMessageUuid",
				],
				"parser 9: retain record_uuid with record/call provenance and independently named components; 1,943 of 142,961 parent links (1.4%) are not the preceding line; preserve the tree, including branches.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/record_uuid/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: uuid, parentUuid and logicalParentUuid represent record identity/tree edges. sourceToolAssistantUUID and refusedUserMessageUuid are cross-record provenance references rather than the own UUID or parent of this record. The broad *.uuid also covers metadata-bearing records outside conversation messages.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/record_uuid/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
		},
	},
	{
		id: "applied_file_changes",
		view: "calls",
		meaning:
			"The file-change type and completed patch outcome, joined to identify changes that actually applied.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.type",
					"user.toolUseResult.structuredPatch[]",
					"user.message.content[tool_result].is_error",
				],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/applied_file_changes/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: {
						kind: "derived",
						from: ["calls/file_op", "calls/is_error"],
					},
					justification:
						"Judge round 3: Claude has no single applied-changes field but both parts exist: Write results state the change type (type create 386 / update 57 on 443 Write results) and Edit results carry a structuredPatch, and the outcome is the result's is_error; joining type and outcome gives the fact.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:FileChange.changes.{*}.type",
					"event_msg/item_completed:FileChange.status",
				],
				"parser 9: retain applied_file_changes with record/call provenance and independently named components; Join the literal change type to status; file_op is the requested operation, not proof of application.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/applied_file_changes/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: {
						kind: "derived",
						from: ["calls/file_op", "calls/is_error"],
					},
					justification:
						"Judge round 3: A changes entry type says add/update/delete while FileChange.status supplies whether application completed. A joined interpretation is required to call a requested change actually applied; neither primary alone establishes the conjunction.",
				},
			),
		},
	},
	{
		id: "disabled_plugin_ids",
		view: "session",
		meaning:
			"The plugin identifiers explicitly disabled in turn/thread configuration.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/disabled_plugin_ids/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"turn_context/.disabled_plugin_ids[]",
					"event_msg/thread_settings_applied.thread_settings.disabled_plugin_ids[]",
				],
				"parser 9: retain disabled_plugin_ids with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#turn_context/.disabled_plugin_ids[]; judge2/sonnet/residue.json",
							explanation:
								"turn_context/.disabled_plugin_ids n=4990 array, 0 element paths; thread_settings_applied.thread_settings.disabled_plugin_ids n=4590",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/disabled_plugin_ids/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: TurnContextItem and thread settings explicitly record disabled plugin identifiers. These are literal selections, not all installed plugins or inferred failed tool calls.",
				},
			),
		},
	},
	{
		id: "permission_profile_parent",
		view: "calls",
		meaning:
			"The parent permission-profile identifier explicitly recorded by the extends setting.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/permission_profile_parent/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["turn_context/.active_permission_profile.extends"],
				"parser 9: retain permission_profile_parent with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#turn_context/.active_permission_profile.extends; judge2/sonnet/residue.json",
							explanation:
								"turn_context/.active_permission_profile.extends n=0 (the catalogued .id exists locally)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/permission_profile_parent/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: The active permission profile extends setting names the explicit parent profile. It is a profile inheritance reference, not a session or thread parent.",
				},
			),
		},
	},
	{
		id: "thread_source",
		view: "session",
		meaning:
			"The literal analytics/source classification explicitly recorded for the thread.",
		runIndex: ["thread_source"],
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/thread_source/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: stored(
				["session_meta/.thread_source"],
				{
					since: 8,
					facts: ["thread_source"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"record-facts.ts:473 preserves the literal session_meta thread_source; this is thread identity/entrypoint, not prompt origin.",
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.thread_source.Feature; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.thread_source n=1470 values user=580 subagent=578 guardian_review=311 realtime_voice=1",
						},
					],
				},
			),
		},
	},
	{
		id: "runtime_workspace_roots",
		view: "session",
		meaning:
			"The runtime workspace roots explicitly selected at session creation, with absent versus empty preserved.",
		agents: {
			claude_code: pending(
				[
					"attachment/environment.attachment.snapshot.additionalWorkingDirectories[]",
					"attachment/environment.attachment.snapshot.workingDirectory",
				],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/runtime_workspace_roots/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Claude records the directories a session may use: the environment attachment's snapshot.additionalWorkingDirectories[] (122 values, 15 distinct, empty on 2,301 of 2,423 snapshots) plus the per-record cwd; together they play the role of runtime workspace roots, but per snapshot, not 'at session creation'.",
				},
			),
			codex: pending(
				[
					"session_meta/.runtime_workspace_roots",
					"session_meta/.runtime_workspace_roots[]",
				],
				"parser 9: retain runtime_workspace_roots as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.runtime_workspace_roots; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.runtime_workspace_roots[] n=663 type string (ignored: 'workspace roots (see cwd)')",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/runtime_workspace_roots/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/runtime_workspace_roots/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: SessionMeta documents creation-selected runtime workspace roots, excluding explicit environment selections and permission-profile roots; absent means unknown and empty means no roots. Preserve those states and the selected native paths.",
				},
			),
		},
	},
	{
		id: "fork_point",
		view: "session",
		meaning:
			"The exclusive parent rollout ordinal at which a fork starts, used for fork-replay deduplication.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/fork_point/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["session_meta/.forked_from_ordinal_exclusive"],
				"parser 9: retain fork_point with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.forked_from_ordinal_exclusive; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.forked_from_id n=338; forked_from_ordinal_exclusive n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/fork_point/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: forked_from_ordinal_exclusive is explicitly the exclusive ordinal inherited from the logical parent, independent of physical history_base and physical record order. That is exactly the definition, not an @ordinal alias.",
				},
			),
		},
	},
	{
		id: "creator_user_id",
		view: "session",
		meaning: "The user explicitly recorded as having created the thread.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/creator_user_id/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["session_meta/.creator_user_id"],
				"parser 9: retain creator_user_id with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.creator_user_id; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.creator_user_id n=0 of 2,906 session_meta records",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/creator_user_id/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: SessionMeta.creator_user_id is documented as the ChatGPT user that created this thread, absent when unavailable or older.",
				},
			),
		},
	},
	{
		id: "creator_account_id",
		view: "session",
		meaning: "The account explicitly selected when the thread was created.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/creator_account_id/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["session_meta/.creator_account_id"],
				"parser 9: retain creator_account_id with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#session_meta/.creator_account_id; judge2/sonnet/residue.json",
							explanation:
								"session_meta/.creator_account_id n=0 of 2,906 session_meta records",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#session/creator_account_id/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: SessionMeta.creator_account_id is the ChatGPT account selected at thread creation and is never updated on resume; exactly the fact meaning.",
				},
			),
		},
	},
	{
		id: "assistant_delivery_origin",
		view: "runs",
		meaning:
			"The explicit origin classification on a retained delivered assistant message.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/assistant_delivery_origin/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["retained_context/delivered_assistant_message.origin"],
				"parser 9: retain assistant_delivery_origin with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#retained_context/delivered_assistant_message.origin; judge2/sonnet/residue.json",
							explanation:
								"compacted/.retained_context.user_messages[].origin n=7 (ignored with the compaction subtree)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/assistant_delivery_origin/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: RetainedContextEvent::DeliveredAssistantMessage flattens a RetainedUserMessage whose origin is the UserInputOrigin enum (user or heartbeat), so origin classifies the retained message, which the writer builds from a delivered assistant message; the classification is exact but is the origin of the retained input, not an assistant-side origin.",
				},
			),
		},
	},
	{
		id: "local_shell_status",
		view: "calls",
		meaning: "The literal lifecycle status of a local shell call.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/local_shell_status/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["response_item/local_shell_call.status"],
				"parser 9: retain local_shell_status with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/local_shell_call.status; judge2/sonnet/residue.json",
							explanation: "response_item/local_shell_call.* n=0 local records",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/local_shell_status/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: ResponseItem::LocalShellCall.status is the literal LocalShellStatus enum with completed/in_progress/incomplete; its presence does not imply a returned exit code.",
				},
			),
		},
	},
	{
		id: "execution_user",
		view: "calls",
		meaning:
			"The execution user explicitly requested for a local shell action.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/execution_user/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["response_item/local_shell_call.action.user"],
				"parser 9: retain execution_user with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/local_shell_call.action.user; judge2/sonnet/residue.json",
							explanation: "response_item/local_shell_call.* n=0 local records",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/execution_user/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: LocalShellExecAction.user is the optional requested execution user. It is not the human session owner and not an assertion of successful execution under that account.",
				},
			),
		},
	},
	{
		id: "execution_environment_id",
		view: "calls",
		meaning:
			"The execution environment identifier explicitly selected for a tool call.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/execution_environment_id/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["response_item/function_call:exec_command.arguments.environment_id"],
				"parser 9: retain execution_environment_id with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.environment_id; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.workdir n=266186 (separate field)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/execution_environment_id/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: exec_command environment_id explicitly selects the execution environment. Preserve it as a request target, not as an observed backend or cwd.",
				},
			),
		},
	},
	{
		id: "requested_additional_permissions",
		view: "calls",
		meaning:
			"The literal per-command permission overlay requested, including typed filesystem entries and network flags.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/requested_additional_permissions/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
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
				],
				"parser 9: retain requested_additional_permissions with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].access; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].missing_path_behavior; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.path; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.pattern; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.type; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.value.kind; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.value.path; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.entries[].path.value.subpath; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.glob_scan_max_depth; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.read[]; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.file_system.write[]; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/function_call:exec_command.arguments.additional_permissions.network.enabled; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:exec_command.arguments.sandbox_permissions n=555 (rg: 2,537 string occurrences of require_escalated, with_additional_permissions never as a value); additional_permissions argument path n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/requested_additional_permissions/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: The argument subtree is the literal additional permissions request: typed filesystem entries/path choices, legacy read/write paths, depth limit and network enabled flag. Components have different units and are preserved independently under the request overlay, not executed permission outcomes.",
				},
			),
		},
	},
	{
		id: "prompt_triggers_turn",
		view: "runs",
		meaning:
			"Whether a recorded communication explicitly requests triggering a new turn.",
		runIndex: ["trigger_turn"],
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/prompt_triggers_turn/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: stored(
				["inter_agent_communication_metadata/.trigger_turn"],
				{
					since: 8,
					facts: ["trigger_turn"],
				},
				{
					relation: {
						kind: "exact",
					},
					justification:
						"codex-records.ts:97-98 stores the literal trigger_turn boolean, not a prompt-origin value.",
					gap: {
						sources: ["inter_agent_communication/.trigger_turn"],
						plan: "parser 9: preserve the same literal flag on the newer communication record.",
					},
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#inter_agent_communication/.trigger_turn; judge2/sonnet/residue.json",
							explanation:
								"inter_agent_communication_metadata/.trigger_turn n=7929 type boolean",
						},
					],
				},
			),
		},
	},
	{
		id: "communication_recipient",
		view: "runs",
		meaning:
			"The explicitly recorded primary recipient of an inter-agent communication.",
		agents: {
			claude_code: pending(
				[
					"assistant.message.content[tool_use:SendMessage].input.recipient",
					"assistant.message.content[tool_use:SendMessage].input.to",
					"user.toolUseResult.pin.id",
					"user.toolUseResult.pin.name",
					"user.toolUseResult.pin.ref",
				],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/communication_recipient/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: SendMessage is Claude's inter-agent communication and its input names the recipient twice: recipient (101) and to (101), 49 distinct values; recipient_kind (14, 'agent') qualifies it. Stored today only inside the input JSON text. A concrete same-scope/unit witness is insufficient for exact; retain the scope caveat.",
				},
			),
			codex: pending(
				["inter_agent_communication/.recipient"],
				"parser 9: retain communication_recipient with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#inter_agent_communication/.recipient; judge2/sonnet/residue.json",
							explanation:
								"inter_agent_communication/.recipient: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/communication_recipient/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: InterAgentCommunication.recipient is the explicit primary recipient alongside separately recorded author and other recipients.",
				},
			),
		},
	},
	{
		id: "communication_other_recipients",
		view: "runs",
		meaning:
			"The other recipients explicitly recorded for an inter-agent communication.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/communication_other_recipients/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["inter_agent_communication/.other_recipients[]"],
				"parser 9: retain communication_other_recipients with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#inter_agent_communication/.other_recipients[]; judge2/sonnet/residue.json",
							explanation:
								"inter_agent_communication_metadata/.trigger_turn n=7929; inter_agent_communication/* n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/communication_other_recipients/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: InterAgentCommunication.other_recipients is the separate literal list of additional recipients; preserve list order and an empty list without treating it as the primary recipient.",
				},
			),
		},
	},
	{
		id: "turn_error_http_status",
		view: "runs",
		meaning:
			"The literal HTTP status code attached to a turn-ending transport or retry error.",
		agents: {
			claude_code: pending(
				["assistant.apiErrorStatus", "system/api_error.error.status"],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/turn_error_http_status/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: assistant.apiErrorStatus (42: 429 on 37, 400 on 5) and system/api_error.error.status (1: 401) are the literal HTTP status of an API error that ended or retried a request. A concrete same-scope/unit witness is insufficient for exact; retain the scope caveat.",
				},
			),
			codex: pending(
				[
					"event_msg/turn_aborted.error.codex_error_info.http_connection_failed.http_status_code",
					"event_msg/turn_aborted.error.codex_error_info.response_stream_connection_failed.http_status_code",
					"event_msg/turn_aborted.error.codex_error_info.response_stream_disconnected.http_status_code",
					"event_msg/turn_aborted.error.codex_error_info.response_too_many_failed_attempts.http_status_code",
					"event_msg/task_complete.error.codex_error_info.http_connection_failed.http_status_code",
				],
				"parser 9: retain turn_error_http_status with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/turn_aborted.error.codex_error_info.HttpConnectionFailed.http_status_code; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_complete.error.codex_error_info.http_connection_failed.http_status_code n=3 files=2 type number",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/turn_aborted.error.codex_error_info.ResponseStreamConnectionFailed.http_status_code; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_complete.error.codex_error_info.http_connection_failed.http_status_code n=3 files=2 type number",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/turn_aborted.error.codex_error_info.ResponseStreamDisconnected.http_status_code; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_complete.error.codex_error_info.http_connection_failed.http_status_code n=3 files=2 type number",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/turn_aborted.error.codex_error_info.ResponseTooManyFailedAttempts.http_status_code; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_complete.error.codex_error_info.http_connection_failed.http_status_code n=3 files=2 type number",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/turn_error_http_status/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: The named CodexErrorInfo variants explicitly carry optional http_status_code for connection/stream/disconnection/retry exhaustion errors. The code is HTTP status, not process exit code or the variant name.",
				},
			),
		},
	},
	{
		id: "non_steerable_turn_kind",
		view: "runs",
		meaning:
			"The explicit turn kind reported when same-turn steering is rejected.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/non_steerable_turn_kind/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/turn_aborted.error.codex_error_info.active_turn_not_steerable.turn_kind",
				],
				"parser 9: retain non_steerable_turn_kind with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/turn_aborted.error.codex_error_info.ActiveTurnNotSteerable.turn_kind; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_complete.error.codex_error_info.http_connection_failed.http_status_code n=3 files=2 type number",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/non_steerable_turn_kind/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: ActiveTurnNotSteerable carries the explicit turn_kind for a rejected same-turn steering request; it is not the generic abort reason.",
				},
			),
		},
	},
	{
		id: "goal_token_budget",
		view: "runs",
		meaning: "The explicitly configured token budget of the thread goal.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/goal_token_budget/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["event_msg/thread_goal_updated.goal.tokenBudget"],
				"parser 9: retain goal_token_budget with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/thread_goal_updated.goal.tokenBudget; judge2/sonnet/residue.json",
							explanation:
								"event_msg/thread_goal_updated.goal.tokensUsed n=358; goal.tokenBudget n=0",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/goal_token_budget/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: ThreadGoal is serialized camelCase and its optional token_budget becomes tokenBudget. It is the explicit configured token budget, not tokens_used, usage cap, elapsed time or a dollar budget.",
				},
			),
		},
	},
	{
		id: "turn_attribution",
		view: "runs",
		meaning:
			"The recorded root and parent turn ids, initiating agent path and trigger label, kept as separate attribution components.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/turn_attribution/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/task_complete.root_turn_id",
					"event_msg/task_started.turn_attribution.initiating_agent_path",
					"event_msg/task_started.turn_attribution.parent_turn_id",
					"event_msg/task_started.turn_attribution.root_turn_id",
					"event_msg/task_started.turn_attribution.turn_trigger",
					"event_msg/turn_aborted.root_turn_id",
				],
				"parser 9: retain turn_attribution with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/task_complete.root_turn_id; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_started.root_turn_id n=4521 files=554 (catalogued under runs/turn_id)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/task_started.turn_attribution.initiating_agent_path; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_started.turn_attribution.initiating_agent_path: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/task_started.turn_attribution.parent_turn_id; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_started.turn_attribution.parent_turn_id: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/task_started.turn_attribution.root_turn_id; judge2/sonnet/residue.json",
							explanation: "event_msg/task_started.root_turn_id n=4521",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/task_started.turn_attribution.turn_trigger; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_started.turn_attribution.turn_trigger: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/turn_aborted.root_turn_id; judge2/sonnet/residue.json",
							explanation:
								"event_msg/task_started.root_turn_id n=4521 files=554 (catalogued under runs/turn_id)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/turn_attribution/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: TurnStartedEvent.turn_attribution uses the explicit TurnAttribution type: initiating_agent_path, parent_turn_id, root_turn_id and turn_trigger. Completion/abort root_turn_id is documented as the same resolved causal root. These match the named attribution components, not the current turn ID.",
				},
			),
		},
	},
	{
		id: "subagent_activity_at_ms",
		view: "calls",
		meaning:
			"The explicitly recorded occurrence time of a sub-agent activity in epoch milliseconds.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_activity_at_ms/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["event_msg/sub_agent_activity.occurred_at_ms"],
				"parser 9: retain subagent_activity_at_ms with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/sub_agent_activity.occurred_at_ms; judge2/sonnet/residue.json",
							explanation:
								"event_msg/sub_agent_activity.occurred_at_ms: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_activity_at_ms/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: SubAgentActivityEvent.occurred_at_ms is the explicit epoch-millisecond occurrence time. Preserve that unit; it is not tool duration or the enclosing record timestamp.",
				},
			),
		},
	},
	{
		id: "tool_result_content",
		view: "calls",
		meaning: "The literal typed content blocks returned by a tool.",
		agents: {
			claude_code: pending(
				["user.message.content[tool_result].content[*]"],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/tool_result_content/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Claude's tool_result content is a list of typed blocks (text, image, tool_reference), stored as the result text (images as labels). A concrete same-scope/unit witness is insufficient for exact; retain the scope caveat.",
				},
			),
			codex: pending(
				[
					"event_msg/mcp_tool_call_end.result.content",
					"event_msg/item_completed:McpToolCall.result.content[*]",
					"event_msg/item_completed:McpToolCall.result.content[resource_link].mimeType",
					"event_msg/item_completed:McpToolCall.result.content[resource_link].name",
					"event_msg/item_completed:McpToolCall.result.content[resource_link].uri",
				],
				"parser 9: retain tool_result_content as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/mcp_tool_call_end.result.content; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:McpToolCall.result.content[text].text n=29298",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/tool_result_content/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/tool_result_content/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: McpToolCallEndEvent.result.content is the list of typed content blocks an MCP tool returned. A concrete same-scope/unit witness is insufficient for exact; retain the scope caveat.",
				},
			),
		},
	},
	{
		id: "mcp_result_metadata",
		view: "calls",
		meaning: "The literal tool-defined metadata returned with an MCP result.",
		agents: {
			claude_code: pending(
				["user.mcpMeta._meta"],
				"parser 9: retain mcp_result_metadata as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/mcp_result_metadata/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/mcp_result_metadata/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: user.mcpMeta._meta is the tool-defined metadata object of an MCP result. A concrete same-scope/unit witness is insufficient for exact; retain the scope caveat.",
				},
			),
			codex: pending(
				[
					"event_msg/mcp_tool_call_end.result._meta",
					"event_msg/item_completed:McpToolCall.result._meta",
					"event_msg/item_completed:McpToolCall.result.content[image]._meta",
					"event_msg/item_completed:McpToolCall.result.content[resource_link]._meta",
				],
				"parser 9: retain mcp_result_metadata as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/mcp_tool_call_end.result._meta; judge2/sonnet/residue.json",
							explanation:
								'rg over ~/.codex/sessions: 74 occurrences of unescaped \'"_meta":{"_codex_apps":{"connector_auth_failure"\', 42 escaped',
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/mcp_result_metadata/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/mcp_result_metadata/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: result._meta is the tool-defined metadata of an MCP result (keys such as codex/nodeReplExecutionDurationMs 13,688, codex/toolSurface 14,993, browser_use 6,456). A concrete same-scope/unit witness is insufficient for exact; retain the scope caveat.",
				},
			),
		},
	},
	{
		id: "mcp_app_resource_uri",
		view: "calls",
		meaning:
			"The UI resource URI explicitly associated with an MCP app tool call.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/mcp_app_resource_uri/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:McpToolCall.mcpAppUi.resourceUri",
					"event_msg/mcp_tool_call_end.mcp_app_resource_uri",
					"event_msg/mcp_tool_call_end.mcp_app_ui.resourceUri",
					"event_msg/item_completed:McpToolCall.mcpAppResourceUri",
				],
				"parser 9: retain mcp_app_resource_uri with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:McpToolCall.mcpAppUi.resourceUri; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:McpToolCall.mcpAppResourceUri n=54 (ignored)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/mcp_tool_call_end.mcp_app_resource_uri; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:McpToolCall.mcpAppResourceUri n=54",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/mcp_tool_call_end.mcp_app_ui.resourceUri; judge2/sonnet/residue.json",
							explanation:
								"event_msg/mcp_tool_call_end.mcp_app_ui.resourceUri: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference: "docs/l1-judge-round2.md#watch-follow-up",
							explanation:
								"event_msg/item_completed:McpToolCall.mcpAppResourceUri: 54 observed records; same meaning and unit as this pending fact, not ignored as generic bookkeeping.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/mcp_app_resource_uri/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: McpAppUi.resourceUri identifies the UI resource and the legacy mcpAppResourceUri/mcp_app_resource_uri fields carry that same explicit UI resource reference. The writer says prefer the typed UI field when both are present.",
				},
			),
		},
	},
	{
		id: "mcp_app_display_mode",
		view: "calls",
		meaning:
			"The explicitly requested inline/fullscreen display mode of an MCP app UI.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/mcp_app_display_mode/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:McpToolCall.mcpAppUi.preferredModelDisplayMode",
					"event_msg/mcp_tool_call_end.mcp_app_ui.preferredModelDisplayMode",
				],
				"parser 9: retain mcp_app_display_mode with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:McpToolCall.mcpAppUi.preferredModelDisplayMode; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:McpToolCall.mcpAppResourceUri n=54 files=12 v0.124.0..0.160.0 (ignored)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/mcp_tool_call_end.mcp_app_ui.preferredModelDisplayMode; judge2/sonnet/residue.json",
							explanation:
								"event_msg/mcp_tool_call_end.mcp_app_ui.preferredModelDisplayMode: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/mcp_app_display_mode/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: McpAppUi.preferredModelDisplayMode is the literal app display-mode preference, kept separately from URI and result success.",
				},
			),
		},
	},
	{
		id: "tool_result_text",
		view: "calls",
		meaning: "The literal decoded text block of a tool result.",
		agents: {
			claude_code: pending(
				[
					"user.message.content[tool_result].content",
					"user.message.content[tool_result].content[text].text",
				],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/tool_result_text/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: The text of a tool result is the string content or the text blocks of tool_result.content, stored as the result text.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:FunctionCallOutput.output[input_text].text",
					"response_item/function_call_output.output",
					"response_item/custom_tool_call_output.output",
				],
				"parser 9: retain tool_result_text with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:FunctionCallOutput.output[input_text].text; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call_output.call_id n=363217 (same result texts in the response-item form)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/tool_result_text/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: FunctionCallOutput.output[input_text].text is the text block of a tool result; the same text appears in response_item/function_call_output outputs (363,446) which the parser stores as the result text, so the item_completed form is a mirror with a typed block path.",
				},
			),
		},
	},
	{
		id: "dynamic_tool_error",
		view: "calls",
		meaning: "The explicit error text recorded for a dynamic tool call.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/dynamic_tool_error/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				["event_msg/item_completed:DynamicToolCall.error"],
				"parser 9: retain dynamic_tool_error with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:DynamicToolCall.error; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:McpToolCall.error.message n=401 (kept as result text)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/dynamic_tool_error/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: DynamicToolCallItem.error is an optional explicit error string, separately recorded from status, content items, and success. It is not an error inferred from returned text.",
				},
			),
		},
	},
	{
		id: "subagent_thread_ids",
		view: "calls",
		meaning:
			"The explicitly referenced sub-agent thread identifiers, with their activity/recipient provenance.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.agentId",
					"user.toolUseResult.resumedAgentId",
					"user.toolUseResult.pin.id",
				],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_thread_ids/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Agent results give the sub-agent id (agentId, already spawned_agent_id), SendMessage results add the addressed agent's id in pin.id and resumedAgentId (54); these identify referenced sub-agents but without the activity/recipient provenance the fact asks for.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CollabAgentToolCall.receiver_agents[].thread_id",
					"event_msg/sub_agent_activity.agent_thread_id",
					"event_msg/item_completed:CollabAgentToolCall.receiver_agents",
				],
				"parser 9: retain subagent_thread_ids as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CollabAgentToolCall.receiver_agents[].thread_id; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:SubAgentActivity.agent_thread_id n=7552; SubAgentActivity.kind started=521 of 7552",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/sub_agent_activity.agent_thread_id; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:SubAgentActivity.agent_thread_id n=7552 files=466",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_thread_ids/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/subagent_thread_ids/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: CollabAgentRef.thread_id identifies the receiver/new agent; SubAgentActivityEvent.agent_thread_id identifies the affected sub-agent. Preserve recipient/activity provenance rather than treating them as the current stream thread.",
				},
			),
		},
	},
	{
		id: "subagent_role",
		view: "calls",
		meaning: "The role explicitly assigned to a referenced sub-agent.",
		agents: {
			claude_code: pending(
				[
					"assistant.message.content[tool_use:Agent].input.subagent_type",
					"user.toolUseResult.agentType",
				],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_role/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Agent input.subagent_type (121 calls; 3 values) and the result's agentType (7) name the type (role) assigned to the sub-agent, which is catalogued as subagent_type; the SDK documents it as 'The type of specialized agent to use'.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CollabAgentToolCall.receiver_agents[].agent_role",
				],
				"parser 9: retain subagent_role with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CollabAgentToolCall.receiver_agents[].agent_role; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:CollabAgentToolCall.receiver_agents n=3278 all empty",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_role/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: CollabAgentRef.agent_role is explicitly the role assigned to the receiver/new sub-agent, with agent_type retained as a legacy alias.",
				},
			),
		},
	},
	{
		id: "subagent_nickname",
		view: "calls",
		meaning: "The explicitly recorded nickname of a referenced sub-agent.",
		agents: {
			claude_code: pending(
				["assistant.message.content[tool_use:Agent].input.name"],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_nickname/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Agent input.name is the name given to the spawned agent to address it with SendMessage; it is chosen by the agent, whereas the Codex nickname is assigned by the system. No local Agent call sets it.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CollabAgentToolCall.receiver_agents[].agent_nickname",
				],
				"parser 9: retain subagent_nickname with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CollabAgentToolCall.receiver_agents[].agent_nickname; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:CollabAgentToolCall.receiver_agents n=3278 all type array, 0 element paths",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_nickname/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: CollabAgentRef.agent_nickname is explicitly the optional assigned nickname of an AgentControl-spawned recipient; not the role or a prompt description.",
				},
			),
		},
	},
	{
		id: "subagent_resolved_effort",
		view: "calls",
		meaning:
			"The reasoning effort explicitly resolved for a sub-agent at creation.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_resolved_effort/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CollabAgentToolCall.reasoning_effort",
					"event_msg/item_completed:SubAgentActivity.reasoning_effort",
					"event_msg/sub_agent_activity.reasoning_effort",
				],
				"parser 9: retain subagent_resolved_effort with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CollabAgentToolCall.reasoning_effort; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:CollabAgentToolCall.reasoning_effort: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:SubAgentActivity.reasoning_effort; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:SubAgentActivity.reasoning_effort: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/sub_agent_activity.reasoning_effort; judge2/sonnet/residue.json",
							explanation:
								"event_msg/sub_agent_activity.reasoning_effort: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_resolved_effort/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: SubAgentActivityItem/Event.reasoning_effort is resolved at creation. The v2 collab producer uses a spawned-agent snapshot, but the v1 producer falls back to the requested/default effort when spawn fails. The combined PRIMARY set therefore includes both resolved and unresolved/requested values.",
				},
			),
		},
	},
	{
		id: "subagent_resolved_model",
		view: "calls",
		meaning: "The model explicitly resolved for a sub-agent at creation.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.resolvedModel"],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_resolved_model/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Agent results carry resolvedModel (150 locally): 'Model in use at the backgrounding transition' for async launches and the resolved model on completion, with modelsUsed listing swaps. It is the nearest equivalent of the model resolved at creation.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CollabAgentToolCall.model",
					"event_msg/item_completed:SubAgentActivity.model",
					"event_msg/sub_agent_activity.model",
				],
				"parser 9: retain subagent_resolved_model with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CollabAgentToolCall.model; judge2/sonnet/residue.json",
							explanation:
								"response_item/function_call:spawn_agent.arguments.model n=302 (the requested model, already catalogued)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:SubAgentActivity.model; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:SubAgentActivity.* n=7552 records, none has model",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/sub_agent_activity.model; judge2/sonnet/residue.json",
							explanation:
								"event_msg/sub_agent_activity.model: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_resolved_model/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: SubAgentActivityItem/Event.model is resolved at creation. The v2 collab producer uses the created-agent snapshot; the v1 producer explicitly falls back to args.model (or empty) on failed spawn. Thus the primary set is only conditionally a resolved model.",
				},
			),
		},
	},
	{
		id: "subagent_states",
		view: "calls",
		meaning:
			"The keyed literal lifecycle states of recipient sub-agents, including explicit completion or error payloads.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.status"],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_states/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "narrower" },
					justification:
						"Judge round 3: Agent results report status async_launched (143) or completed (6); a keyed per-agent state with completion/error payloads does not exist.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:CollabAgentToolCall.agents_states.{*}",
					"event_msg/item_completed:CollabAgentToolCall.agents_states.{*}.completed",
					"event_msg/item_completed:CollabAgentToolCall.agents_states.{*}.errored",
					"event_msg/item_completed:CollabAgentToolCall.agents_states",
				],
				"parser 9: retain subagent_states as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CollabAgentToolCall.agents_states.{*}; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:CollabAgentToolCall.agents_states n=3278 all type object, 0 child paths",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CollabAgentToolCall.agents_states.{*}.completed; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:CollabAgentToolCall.agents_states.{*}.completed: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:CollabAgentToolCall.agents_states.{*}.errored; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:CollabAgentToolCall.agents_states.{*}.errored: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/subagent_states/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/subagent_states/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: CollabAgentToolCall.agents_states is a ThreadId-keyed AgentStatus map. Completion and error variants can carry literal payload text; retain keyed state, variant and payload separately without interpreting an empty map as completion.",
				},
			),
		},
	},
	{
		id: "image_generation",
		view: "calls",
		meaning:
			"The recorded image-generation status, failure type and transparency request, kept as separate components.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/image_generation/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/image_generation_end.failure.type",
					"event_msg/image_generation_end.status",
					"event_msg/image_generation_end.transparent_background",
					"response_item/image_generation_call.status",
					"event_msg/item_completed:Extension.failure",
					"event_msg/item_completed:Extension.transparentBackground",
				],
				"parser 9: retain image_generation as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/image_generation_end.failure.type; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:Extension.failure n=4, all null (no failure seen locally)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/image_generation_end.status; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:Extension.status n=4 values completed=4; Extension.kind image_gen.generation n=4",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/image_generation_end.transparent_background; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:Extension.transparentBackground n=4 types null:3 boolean:1 (ignored under 'web search query and results')",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#response_item/image_generation_call.status; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:Extension.status n=4 completed",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#calls/image_generation/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/image_generation/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: ImageGenerationEndEvent and hosted ResponseItem image generation record explicit status, optional failure type and transparency request. These are separate components; a requested transparency flag is not evidence about generated pixels.",
				},
			),
		},
	},
	{
		id: "review_finding_title",
		view: "runs",
		meaning: "The literal title of an individual structured review finding.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/review_finding_title/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/exited_review_mode.review_output.findings[].title",
					"event_msg/item_completed:ExitedReviewMode.review_output.findings[].title",
				],
				"parser 9: retain review_finding_title with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/exited_review_mode.review_output.findings[].title; judge2/sonnet/residue.json",
							explanation:
								"event_msg/exited_review_mode.review_output.findings[].title: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:ExitedReviewMode.review_output.findings[].title; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:ExitedReviewMode.review_output.findings[].title: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/review_finding_title/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: ReviewFinding.title is explicitly the literal title of one observed issue/recommendation, aligned with each structured finding rather than the overall review explanation.",
				},
			),
		},
	},
	{
		id: "memory_citation_note",
		view: "runs",
		meaning:
			"The literal explanatory note attached to a memory citation entry.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/memory_citation_note/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/agent_message.memory_citation.entries[].note",
					"event_msg/item_completed:AgentMessage.memory_citation.entries[].note",
				],
				"parser 9: retain memory_citation_note with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/agent_message.memory_citation.entries[].note; judge2/sonnet/residue.json",
							explanation:
								"event_msg/agent_message.memory_citation.entries[].note: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/item_completed:AgentMessage.memory_citation.entries[].note; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:AgentMessage.memory_citation.entries[].note: 0 of 3,059,068 local Codex records (2,710 files, 0.100-0.162)",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/memory_citation_note/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: MemoryCitationEntry.note is the literal note of one cited memory entry, kept independently of source path and line interval.",
				},
			),
		},
	},
	{
		id: "assistant_message_delivery",
		view: "runs",
		meaning:
			"Explicit delivery mode of an assistant message, such as asynchronous delivery.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify and preserve the counterpart's literal fields; a missing local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/assistant_message_delivery/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"event_msg/agent_message.delivery",
					"event_msg/item_completed:AgentMessage.delivery",
				],
				"parser 9: retain assistant_message_delivery with record/call provenance and independently named components; Judge round 2: keep separate named literal components and provenance, never infer success or conflate units.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"judge2/rulings.md; judge2/sol/residue.json#event_msg/agent_message.delivery; judge2/sonnet/residue.json",
							explanation:
								"event_msg/item_completed:AgentMessage.delivery n=189 files=52 v0.148.0-alpha.21..0.160.0 (currently ignored)",
						},
						{
							kind: "llm_audit",
							reference: "docs/l1-judge-round2.md#watch-follow-up",
							explanation:
								"event_msg/item_completed:AgentMessage.delivery: 189 observed records; same meaning and unit as this pending fact, not ignored as generic bookkeeping.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#runs/assistant_message_delivery/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: AgentMessageDelivery is an explicit assistant delivery-mode enum (currently Async); AgentMessageEvent/Item delivery carry it, distinct from phase and retained origin.",
				},
			),
		},
	},
	{
		id: "attachment_rendered_role",
		view: "prompts",
		meaning:
			"The explicit role used to render a Claude attachment into model context, not the user's conversational role.",
		agents: {
			claude_code: pending(
				["attachment/*.renderedRole"],
				"parser 9: retain each literal value with record provenance; preserve array order and component names; do not reinterpret roles or classification tags.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference: "docs/l1-judge-round2.md#watch-follow-up",
							explanation:
								"11,388 system and 440 user values; not a corpus constant and not rendered text.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/attachment_rendered_role/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "close" },
					justification:
						"Judge round 3: Many renderedRole witnesses exist, but the allowed published SDK does not declare the private attachment renderer or its role field. A writer/type contract distinguishing model-context rendering role from conversational user role is missing; field spelling alone is insufficient.",
				},
			),
			codex: pending(
				[],
				"parser 9: preserve a literal counterpart if discovered; no local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/attachment_rendered_role/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
		},
	},
	{
		id: "message_content_kinds",
		view: "prompts",
		meaning:
			"The harness-owned classification tags aligned with a message item's content entries, preserving literal tags and order.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: preserve a literal counterpart if discovered; no local witness is not writer absence.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/message_content_kinds/claude_code",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "not_found" },
					justification:
						"Judge round 3: No PRIMARY source is declared for this agent and no native normalized source for this fact was established in the complete current corpus. This is observational absence, not a claim that the agent never emits it; counterpart-agent sources are not evidence for this row.",
				},
			),
			codex: pending(
				[
					"response_item/*.internal_chat_message_metadata_passthrough.content_item_kinds[]",
				],
				"parser 9: retain each literal value with record provenance; preserve array order and component names; do not reinterpret roles or classification tags.",
				{
					evidence: [
						{
							kind: "llm_audit",
							reference: "docs/l1-judge-round2.md#watch-follow-up",
							explanation:
								"26 distinct literal tags; user.text 127,636, unknown 16,384, and other instruction/image/heartbeat tags. Codex protocol/src/models.rs:970-976 declares classifications aligned with content entries.",
						},
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#prompts/message_content_kinds/codex",
							explanation:
								"Binding round-3 placement and scope decision; independent reviewer witnesses are not writer meaning proof.",
						},
					],
					relation: { kind: "exact" },
					justification:
						"Judge round 3: InternalChatMessageMetadataPassthrough.content_item_kinds is explicitly harness-owned classification aligned with each content entry. Preserve literal tags and order, not an inferred conversational role or boolean content summary.",
				},
			),
		},
	},
	{
		id: "command_description",
		view: "calls",
		meaning:
			"The agent's own description of what a shell command does, distinct from the command text.",
		agents: {
			claude_code: pending(
				["assistant.message.content[tool_use:Bash].input.description"],
				"parser 9: retain command_description as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/command_description/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
						{
							kind: "published_types",
							path: "assistant.message.content[tool_use:Bash].input.description",
							reference:
								"@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:825 (BashInput)",
							version: "0.3.287 / Claude Code 2.1.287",
							supportsMeaning: true,
							explanation:
								"BashInput describes this as the agent's clear description of what the command does, explicitly not an echo of command text, flags or paths.",
						},
					],
					justification:
						"Judge round 3 B: The agent's own description of what a shell command does, distinct from the command text. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "input_transformations",
		view: "runs",
		meaning:
			"The input transformation's type, affected path and reason, kept as ordered provider-context components.",
		agents: {
			claude_code: pending(
				[
					"assistant.message.input_transformations[].path",
					"assistant.message.input_transformations[].reason",
					"assistant.message.input_transformations[].type",
				],
				"parser 9: retain input_transformations as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/input_transformations/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The input transformation's type, affected path and reason, kept as ordered provider-context components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "session_slug",
		view: "session",
		meaning:
			"The session's literal display slug that names its plan file, not a session identifier.",
		agents: {
			claude_code: pending(
				[
					"assistant.slug",
					"attachment/agent_listing_delta.slug",
					"attachment/date_change.slug",
					"attachment/deferred_tools_delta.slug",
					"attachment/skill_listing.slug",
					"attachment/task_reminder.slug",
					"system/stop_hook_summary.slug",
					"user.slug",
				],
				"parser 9: retain session_slug as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/session_slug/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 F: The session's literal display slug that names its plan file, not a session identifier. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "offered_agent_types",
		view: "runs",
		meaning:
			"The agent types offered by the harness, preserving added versus built-in inventory provenance.",
		agents: {
			claude_code: pending(
				[
					"attachment/agent_listing_delta.attachment.addedTypes[]",
					"attachment/agent_listing_delta.attachment.builtInTypes[]",
				],
				"parser 9: retain offered_agent_types as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/offered_agent_types/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The agent types offered by the harness, preserving added versus built-in inventory provenance. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "context_configuration",
		view: "session",
		meaning:
			"The harness's explicitly recorded configuration and capability flags, modes and versions, preserving each component and its scope.",
		agents: {
			claude_code: pending(
				[
					"attachment/batching_reminder_sent.attachment.clearAt",
					"attachment/prompt_snapshot.attachment.inlineTools",
					"attachment/skill_listing.attachment.isInitial",
				],
				"parser 9: retain context_configuration as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					sourceMappings: [
						{
							path: "attachment/prompt_snapshot.attachment.inlineTools",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Judge round 3 C: The harness's explicitly recorded configuration and capability flags, modes and versions, preserving each component and its scope. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
						},
						{
							path: "attachment/skill_listing.attachment.isInitial",
							role: "primary",
							relation: { kind: "close" },
							justification:
								"Judge round 3 C: The harness's explicitly recorded configuration and capability flags, modes and versions, preserving each component and its scope. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
						},
					],
					relation: { kind: "unreviewed" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/context_configuration/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_pending: The harness's explicitly recorded configuration and capability flags, modes and versions, preserving each component and its scope. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[
					"event_msg/thread_settings_applied.thread_settings.collaboration_mode.settings.developer_instructions",
					"event_msg/thread_settings_applied.thread_settings.personality",
					"event_msg/thread_settings_applied.thread_settings.reasoning_summary",
					"session_meta/.history_mode",
					"session_meta/.multi_agent_version",
					"turn_context/.collaboration_mode.settings.developer_instructions",
					"turn_context/.cyber_access_program",
					"turn_context/.multi_agent_mode",
					"turn_context/.multi_agent_version",
					"turn_context/.personality",
					"turn_context/.realtime_active",
					"turn_context/.sandbox_policy.exclude_slash_tmp",
					"turn_context/.sandbox_policy.exclude_tmpdir_env_var",
					"turn_context/.summary",
					"world_state/.state.apps_instructions",
					"world_state/.state.environments_instructions",
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
				"parser 9: retain context_configuration as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/context_configuration/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 C: The harness's explicitly recorded configuration and capability flags, modes and versions, preserving each component and its scope. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "context_model_identity",
		view: "session",
		meaning:
			"The model identity, marketing name, knowledge cutoff and model-specific context configuration reported by the harness, not proof of an executed model.",
		agents: {
			claude_code: pending(
				[
					"attachment/batching_reminder_sent.attachment.model",
					"attachment/model.attachment.identity.knowledgeCutoff",
					"attachment/model.attachment.identity.marketingName",
					"attachment/thinking_drop.attachment.model",
				],
				"parser 9: retain context_model_identity as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/context_model_identity/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 C: The model identity, marketing name, knowledge cutoff and model-specific context configuration reported by the harness, not proof of an executed model. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				["world_state/.state.collaboration_mode.model"],
				"parser 9: retain context_model_identity as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/context_model_identity/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 C: The model identity, marketing name, knowledge cutoff and model-specific context configuration reported by the harness, not proof of an executed model. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "account_context",
		view: "session",
		meaning:
			"The account, organization or user identity explicitly injected into the session context, subject to identifier/PII policy.",
		agents: {
			claude_code: pending(
				[
					"attachment/credential_org.attachment.organizationUuid",
					"attachment/session_context.attachment.context.userEmail",
				],
				"parser 9: retain account_context as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Apply identifier/PII handling; do not persist authentication secrets.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/account_context/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 C: The account, organization or user identity explicitly injected into the session context, subject to identifier/PII policy. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "current_date",
		view: "prompts",
		meaning:
			"The calendar date explicitly supplied in model context, not the transcript event timestamp.",
		agents: {
			claude_code: pending(
				[
					"attachment/date_change.attachment.newDate",
					"attachment/date.attachment.date",
				],
				"parser 9: retain current_date as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/current_date/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The calendar date explicitly supplied in model context, not the transcript event timestamp. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[
					"turn_context/.current_date",
					"world_state/.state.environments.current_date",
				],
				"parser 9: retain current_date as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/current_date/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The calendar date explicitly supplied in model context, not the transcript event timestamp. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "offered_tool_options",
		view: "runs",
		meaning:
			"The tool inventory's loading, eager-streaming, strict-schema, availability, removed-name and listing-count components, not definition bodies or calls made.",
		agents: {
			claude_code: pending(
				[
					"attachment/deferred_tools_delta.attachment.removedByBlock[]",
					"attachment/deferred_tools_delta.attachment.toolSearchAbsent",
					"attachment/deferred_tools_record.attachment.entries[].defer_loading",
					"attachment/deferred_tools_record.attachment.entries[].eager_input_streaming",
					"attachment/skill_listing.attachment.names[]",
					"attachment/skill_listing.attachment.skillCount",
				],
				"parser 9: retain offered_tool_options as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/offered_tool_options/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The tool inventory's loading, eager-streaming, strict-schema, availability, removed-name and listing-count components, not definition bodies or calls made. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[
					"response_item/tool_search_output.tools[].tools[].defer_loading",
					"response_item/tool_search_output.tools[].tools[].strict",
					"session_meta/.dynamic_tools[].tools[].deferLoading",
					"session_meta/.dynamic_tools[].type",
				],
				"parser 9: retain offered_tool_options as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/offered_tool_options/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 C: The tool inventory's loading, eager-streaming, strict-schema, availability, removed-name and listing-count components, not definition bodies or calls made. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "environment_changes",
		view: "session",
		meaning:
			"The environment field that changed and its previous value, preserving change order and field/from components.",
		agents: {
			claude_code: pending(
				["attachment/environment.attachment.changes[].{*}"],
				"parser 9: retain environment_changes as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/environment_changes/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 F: The environment field that changed and its previous value, preserving change order and field/from components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "environment_snapshot",
		view: "session",
		meaning:
			"The environment snapshot's OS/version, platform, shell, timezone, directories, git status and repository/worktree flags as independently named components.",
		agents: {
			claude_code: pending(
				[
					"attachment/environment.attachment.snapshot.additionalWorkingDirectories[]",
					"attachment/environment.attachment.snapshot.isGitRepo",
					"attachment/environment.attachment.snapshot.isWorktree",
					"attachment/environment.attachment.snapshot.osVersion",
					"attachment/environment.attachment.snapshot.platform",
					"attachment/environment.attachment.snapshot.shell",
					"attachment/session_context.attachment.context.gitStatus",
				],
				"parser 9: retain environment_snapshot as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/environment_snapshot/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The environment snapshot's OS/version, platform, shell, timezone, directories, git status and repository/worktree flags as independently named components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[
					"turn_context/.timezone",
					"world_state/.state.environments.environments.local.shell",
					"world_state/.state.environments.environments.local.status",
					"world_state/.state.environments.timezone",
				],
				"parser 9: retain environment_snapshot as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/environment_snapshot/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The environment snapshot's OS/version, platform, shell, timezone, directories, git status and repository/worktree flags as independently named components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "context_source_details",
		view: "prompts",
		meaning:
			"The explicit memory display path, remote commit or context provenance details supplied to the model, not the content body.",
		agents: {
			claude_code: pending(
				[
					"attachment/nested_memory.attachment.displayPath",
					"attachment/remote_session_change.attachment.commit",
				],
				"parser 9: retain context_source_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/context_source_details/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 F: The explicit memory display path, remote commit or context provenance details supplied to the model, not the content body. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "prompt_delivery_options",
		view: "prompts",
		meaning:
			"The queued prompt's delivery, visibility and producer flags, identifiers and timestamp, kept independently from its text and the receiving run.",
		agents: {
			claude_code: pending(
				[
					"attachment/queued_command.attachment.delivery_id",
					"attachment/queued_command.attachment.runId",
					"attachment/queued_command.attachment.source_uuid",
					"attachment/queued_command.attachment.timestamp",
					"user.queueSkipAttachments",
					"user.queueTranscriptOnly",
				],
				"parser 9: retain prompt_delivery_options as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/prompt_delivery_options/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_map: The queued prompt's delivery, visibility and producer flags, identifiers and timestamp, kept independently from its text and the receiving run. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "queued_producer_usage",
		view: "prompts",
		meaning:
			"A queued notification producer's reported duration in milliseconds, total tokens and tool uses, not the receiving run's usage.",
		agents: {
			claude_code: pending(
				[
					"attachment/queued_command.attachment.usage.durationMs",
					"attachment/queued_command.attachment.usage.toolUses",
					"attachment/queued_command.attachment.usage.totalTokens",
				],
				"parser 9: retain queued_producer_usage as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/queued_producer_usage/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 D: A queued notification producer's reported duration in milliseconds, total tokens and tool uses, not the receiving run's usage. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "source_call_id",
		view: "prompts",
		meaning:
			"The tool-call identifier explicitly linked to an injected prompt or context notification.",
		agents: {
			claude_code: pending(
				[
					"attachment/read_truncation_notice.attachment.toolUseID",
					"user.sourceToolUseID",
				],
				"parser 9: retain source_call_id as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/source_call_id/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The tool-call identifier explicitly linked to an injected prompt or context notification. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "system_event_details",
		view: "runs",
		meaning:
			"The system event's explicitly recorded severity, source, scope and request or hook identifiers, kept as distinct event components.",
		agents: {
			claude_code: pending(
				[
					"attachment/thinking_drop.attachment.querySource",
					"attachment/thinking_drop.attachment.requestId",
					"system/api_error.level",
					"system/api_error.source",
					"system/informational.level",
					"system/model_refusal_fallback.level",
					"system/model_refusal_fallback.scope",
					"system/model_refusal_no_fallback.level",
					"system/stop_hook_summary.level",
					"system/stop_hook_summary.toolUseID",
				],
				"parser 9: retain system_event_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/system_event_details/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The system event's explicitly recorded severity, source, scope and request or hook identifiers, kept as distinct event components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "mcp_structured_content",
		view: "calls",
		meaning:
			"The structured result content explicitly returned by an MCP tool, preserving tool-defined keys separately from text blocks.",
		agents: {
			claude_code: pending(
				["user.mcpMeta.structuredContent"],
				"parser 9: retain mcp_structured_content as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/mcp_structured_content/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The structured result content explicitly returned by an MCP tool, preserving tool-defined keys separately from text blocks. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				["event_msg/item_completed:McpToolCall.result.structuredContent"],
				"parser 9: retain mcp_structured_content as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/mcp_structured_content/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The structured result content explicitly returned by an MCP tool, preserving tool-defined keys separately from text blocks. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "skill_allowed_tools",
		view: "calls",
		meaning:
			"The tool names a loaded skill explicitly allows, not tools invoked by that skill.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.allowedTools[]"],
				"parser 9: retain skill_allowed_tools as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/skill_allowed_tools/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The tool names a loaded skill explicitly allows, not tools invoked by that skill. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "fetch_response_details",
		view: "calls",
		meaning:
			"The web fetch result's byte count, numeric HTTP status and status text, preserved as separate response components.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.bytes",
					"user.toolUseResult.code",
					"user.toolUseResult.codeText",
				],
				"parser 9: retain fetch_response_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/fetch_response_details/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The web fetch result's byte count, numeric HTTP status and status text, preserved as separate response components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "wakeup_details",
		view: "calls",
		meaning:
			"The scheduled wakeup's epoch-millisecond time, actual delay in seconds, clamping and cancelled-count components.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.cancelledWakeups",
					"user.toolUseResult.clampedDelaySeconds",
					"user.toolUseResult.scheduledFor",
					"user.toolUseResult.wasClamped",
				],
				"parser 9: retain wakeup_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/wakeup_details/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 agreed_map: The scheduled wakeup's epoch-millisecond time, actual delay in seconds, clamping and cancelled-count components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "background_task_details",
		view: "calls",
		meaning:
			"The background task or monitor's identifiers, kind, persistence and output-readability flags, kept as distinct result components.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.canReadOutputFile",
					"user.toolUseResult.persistent",
					"user.toolUseResult.task_type",
					"user.toolUseResult.task.id",
					"user.toolUseResult.taskId",
				],
				"parser 9: retain background_task_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/background_task_details/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The background task or monitor's identifiers, kind, persistence and output-readability flags, kept as distinct result components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "file_result_details",
		view: "calls",
		meaning:
			"The file result's kind, media type, original byte size, image flag and token-cap pagination flag, kept as distinct components.",
		agents: {
			claude_code: pending(
				[
					"user.toolUseResult.file.originalSize",
					"user.toolUseResult.file.truncatedByTokenCap",
					"user.toolUseResult.isImage",
					"user.toolUseResult.type",
				],
				"parser 9: retain file_result_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/file_result_details/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The file result's kind, media type, original byte size, image flag and token-cap pagination flag, kept as distinct components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[
					"event_msg/item_completed:McpToolCall.result.content[image].mimeType",
					"response_item/custom_tool_call_output.output[input_image].detail",
					"response_item/function_call_output.output[input_image].detail",
				],
				"parser 9: retain file_result_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/file_result_details/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The file result's kind, media type, original byte size, image flag and token-cap pagination flag, kept as distinct components. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "search_result_lines",
		view: "calls",
		meaning:
			"The returned and total search line counts, distinguished from the number of matching results.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.numLines", "user.toolUseResult.totalLines"],
				"parser 9: retain search_result_lines as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/search_result_lines/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The returned and total search line counts, distinguished from the number of matching results. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "tool_result_details",
		view: "calls",
		meaning:
			"The tool result's named structured controls and outcome metadata, preserving their tool-specific meaning rather than treating them as prose.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.success", "user.toolUseResult.updatedFields[]"],
				"parser 9: retain tool_result_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/tool_result_details/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_map: The tool result's named structured controls and outcome metadata, preserving their tool-specific meaning rather than treating them as prose. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "tool_inventory_counts",
		view: "calls",
		meaning:
			"The explicitly returned total of deferred tools, not the number of executed calls.",
		agents: {
			claude_code: pending(
				["user.toolUseResult.total_deferred_tools"],
				"parser 9: retain tool_inventory_counts as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/tool_inventory_counts/claude_code",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The explicitly returned total of deferred tools, not the number of executed calls. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
			codex: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
		},
	},
	{
		id: "tool_lifecycle",
		view: "calls",
		meaning:
			"The tool operation's literal lifecycle status and client/server execution location, not a success inferred from an exit code.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"event_msg/exec_command_end.status",
					"event_msg/patch_apply_end.status",
					"response_item/custom_tool_call:apply_patch.status",
					"response_item/custom_tool_call:exec.status",
					"response_item/tool_search_call.execution",
					"response_item/tool_search_call.status",
					"response_item/tool_search_output.execution",
					"response_item/tool_search_output.status",
					"response_item/web_search_call.status",
				],
				"parser 9: retain tool_lifecycle as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/tool_lifecycle/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_map: The tool operation's literal lifecycle status and client/server execution location, not a success inferred from an exit code. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "command_script_path",
		view: "calls",
		meaning:
			"The plugin script path explicitly recorded for a completed command, not its requested command text.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				["event_msg/item_completed:CommandExecution.script_path"],
				"parser 9: retain command_script_path as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/command_script_path/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The plugin script path explicitly recorded for a completed command, not its requested command text. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "web_action_details",
		view: "calls",
		meaning:
			"The web operation's explicit action kind, source URL and find pattern, not the returned page body.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"event_msg/item_completed:Extension.action.type",
					"event_msg/item_completed:WebSearch.action.type",
					"event_msg/web_search_end.action.type",
				],
				"parser 9: retain web_action_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/web_action_details/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The web operation's explicit action kind, source URL and find pattern, not the returned page body. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "web_result_details",
		view: "calls",
		meaning:
			"The web result's reference identifier, domain, URL and thumbnail reference, preserving each result's provenance.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"event_msg/item_completed:Extension.results[].domain",
					"event_msg/item_completed:Extension.results[].ref_id",
					"event_msg/item_completed:Extension.results[].thumbnail_url",
					"event_msg/item_completed:WebSearch.results[].domain",
					"event_msg/item_completed:WebSearch.results[].ref_id",
					"event_msg/item_completed:WebSearch.results[].thumbnail_url",
				],
				"parser 9: retain web_result_details as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/web_result_details/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_map: The web result's reference identifier, domain, URL and thumbnail reference, preserving each result's provenance. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "image_generation_prompt",
		view: "calls",
		meaning:
			"The revised prompt text explicitly recorded for an image-generation call, distinct from its original requested prompt.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				["event_msg/item_completed:Extension.revisedPrompt"],
				"parser 9: retain image_generation_prompt as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/image_generation_prompt/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_map: The revised prompt text explicitly recorded for an image-generation call, distinct from its original requested prompt. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "connector_link_id",
		view: "calls",
		meaning:
			"The connector link identifier explicitly recorded on an MCP tool call, not the server or tool name.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				["event_msg/item_completed:McpToolCall.linkId"],
				"parser 9: retain connector_link_id as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/connector_link_id/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_map: The connector link identifier explicitly recorded on an MCP tool call, not the server or tool name. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "prompt_mentions",
		view: "prompts",
		meaning:
			"The mention's explicitly supplied display name and target path, not an executed tool target.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"event_msg/item_completed:UserMessage.content[mention].name",
					"event_msg/item_completed:UserMessage.content[mention].path",
				],
				"parser 9: retain prompt_mentions as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/prompt_mentions/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The mention's explicitly supplied display name and target path, not an executed tool target. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "goal_timestamps",
		view: "runs",
		meaning:
			"The goal's explicitly recorded creation and update timestamps in epoch seconds, not a run timestamp.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"event_msg/thread_goal_updated.goal.createdAt",
					"event_msg/thread_goal_updated.goal.updatedAt",
				],
				"parser 9: retain goal_timestamps as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/goal_timestamps/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The goal's explicitly recorded creation and update timestamps in epoch seconds, not a run timestamp. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "filesystem_policy",
		view: "runs",
		meaning:
			"The configured filesystem policy's kind and ordered access/path/missing-path components, not the backend a command actually used.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].missing_path_behavior",
					"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].path.path",
					"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].path.type",
					"event_msg/thread_settings_applied.thread_settings.permission_profile.file_system.entries[].path.value.kind",
					"turn_context/.file_system_sandbox_policy.entries[].missing_path_behavior",
					"turn_context/.file_system_sandbox_policy.entries[].path.path",
					"turn_context/.file_system_sandbox_policy.entries[].path.type",
					"turn_context/.file_system_sandbox_policy.entries[].path.value.kind",
					"turn_context/.file_system_sandbox_policy.entries[].path.value.subpath",
					"turn_context/.file_system_sandbox_policy.kind",
					"turn_context/.permission_profile.file_system.entries[].missing_path_behavior",
					"turn_context/.permission_profile.file_system.entries[].path.path",
					"turn_context/.permission_profile.file_system.entries[].path.type",
					"turn_context/.permission_profile.file_system.entries[].path.value.kind",
					"turn_context/.permission_profile.file_system.entries[].path.value.subpath",
					"turn_context/.permission_profile.file_system.type",
				],
				"parser 9: retain filesystem_policy as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:runs/filesystem_policy/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The configured filesystem policy's kind and ordered access/path/missing-path components, not the backend a command actually used. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "workspace_roots",
		view: "session",
		meaning:
			"The explicit filesystem/workspace roots in a configuration snapshot, preserving creation versus later-snapshot provenance.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"event_msg/thread_settings_applied.thread_settings.runtime_workspace_roots[]",
					"turn_context/.sandbox_policy.writable_roots[]",
					"turn_context/.workspace_roots[]",
				],
				"parser 9: retain workspace_roots as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/workspace_roots/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The explicit filesystem/workspace roots in a configuration snapshot, preserving creation versus later-snapshot provenance. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "mcp_attribution",
		view: "calls",
		meaning:
			"The cumulative MCP attribution's status, error and source server/tool/plugin/first-turn identifiers, not a current call's target.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"response_item/agent_message@metadata.mcp_attribution.error_reason",
					"response_item/agent_message@metadata.mcp_attribution.status",
					"response_item/custom_tool_call_output@metadata.mcp_attribution.error_reason",
					"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].first_turn_id",
					"response_item/custom_tool_call_output@metadata.mcp_attribution.sources[].plugin_id",
					"response_item/custom_tool_call_output@metadata.mcp_attribution.status",
					"response_item/custom_tool_call:exec@metadata.mcp_attribution.sources[].first_turn_id",
					"response_item/custom_tool_call:exec@metadata.mcp_attribution.sources[].plugin_id",
					"response_item/custom_tool_call:exec@metadata.mcp_attribution.sources[].server_name",
					"response_item/custom_tool_call:exec@metadata.mcp_attribution.sources[].tool_name",
					"response_item/custom_tool_call:exec@metadata.mcp_attribution.status",
					"response_item/function_call_output@metadata.mcp_attribution.error_reason",
					"response_item/function_call_output@metadata.mcp_attribution.sources[].first_turn_id",
					"response_item/function_call_output@metadata.mcp_attribution.sources[].plugin_id",
					"response_item/function_call_output@metadata.mcp_attribution.status",
					"response_item/function_call:untrusted_input@metadata.mcp_attribution.sources[].first_turn_id",
					"response_item/function_call:untrusted_input@metadata.mcp_attribution.sources[].plugin_id",
					"response_item/function_call:untrusted_input@metadata.mcp_attribution.sources[].server_name",
					"response_item/function_call:untrusted_input@metadata.mcp_attribution.sources[].tool_name",
					"response_item/function_call:untrusted_input@metadata.mcp_attribution.status",
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
				"parser 9: retain mcp_attribution as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/mcp_attribution/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The cumulative MCP attribution's status, error and source server/tool/plugin/first-turn identifiers, not a current call's target. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "output_truncation",
		view: "calls",
		meaning:
			"The tool-output truncation policy, original token count and limits, preserving token versus character units.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"response_item/custom_tool_call_output@metadata.fallback_token_limit_override",
					"response_item/function_call_output.output~Original token count",
					"response_item/function_call_output@metadata.fallback_token_limit_override",
					"turn_context/.truncation_policy.limit",
					"turn_context/.truncation_policy.mode",
				],
				"parser 9: retain output_truncation as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/output_truncation/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_map: The tool-output truncation policy, original token count and limits, preserving token versus character units. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "call_exec_options",
		view: "calls",
		meaning:
			"The explicitly requested non-command execution options, preserving option names, boolean flags and millisecond/token units separately.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"response_item/function_call:exec_command.arguments.{*}",
					"response_item/function_call:exec_command.arguments.login",
					"response_item/function_call:exec_command.arguments.max_output_tokens",
					"response_item/function_call:exec_command.arguments.shell",
					"response_item/function_call:exec_command.arguments.tty",
					"response_item/function_call:exec_command.arguments.yield_time_ms",
					"response_item/function_call:exec_command.arguments.prefix_rule[]",
				],
				"parser 9: retain allowlisted non-command execution options as individually named components and units; never store env or unknown secret-bearing values.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:calls/call_exec_options/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 B: The explicitly requested non-command execution options, preserving option names, boolean flags and millisecond/token units separately. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "base_instruction_provenance",
		view: "prompts",
		meaning:
			"The model and origin kind explicitly attached to base instructions, not their definition text.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				[
					"session_meta/.base_instructions.provenance.model",
					"session_meta/.base_instructions.provenance.type",
				],
				"parser 9: retain base_instruction_provenance as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:prompts/base_instruction_provenance/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The model and origin kind explicitly attached to base instructions, not their definition text. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "lineage_session_id",
		view: "session",
		meaning:
			"The explicit root or parent session identifier linking related threads, not the identity of each current stream.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				["session_meta/.session_id", "token_usage_record/.session_id"],
				"parser 9: retain lineage_session_id as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/lineage_session_id/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
						{
							kind: "writer_source",
							path: "session_meta/.session_id",
							file: "codex-rs/protocol/src/protocol.rs",
							line: 3159,
							version: "0.162.0",
							supportsMeaning: true,
							explanation:
								"SessionMeta documents session_id as the root thread ID; it is lineage, not the current child stream's identity.",
						},
						{
							kind: "writer_source",
							path: "token_usage_record/.session_id",
							file: "codex-rs/core/src/session/mod.rs",
							line: 4739,
							version: "0.162.0",
							supportsMeaning: true,
							explanation:
								"The durable TokenUsageRecord writer passes self.session_id(), independently of thread_id; protocol.rs:3159 documents the shared SessionMeta session_id as the root thread ID, matching the judge's 81,054/81,054 root-lineage witnesses.",
						},
					],
					justification:
						"Judge round 3 map_vs_map: The explicit root or parent session identifier linking related threads, not the identity of each current stream. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
					notes:
						"Judge: token_usage_record.session_id equals the root session ID on 81,054/81,054 records, including parent sessions in 420/568 affected files. Do not apply stream-identity mismatch alerts to this lineage field.",
				},
			),
		},
	},
	{
		id: "subagent_history_start_ordinal",
		view: "session",
		meaning:
			"The explicitly recorded start ordinal of a sub-agent's inherited history, not the parent's exclusive fork ordinal.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				["session_meta/.subagent_history_start_ordinal"],
				"parser 9: retain subagent_history_start_ordinal as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/subagent_history_start_ordinal/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 H_map: The explicitly recorded start ordinal of a sub-agent's inherited history, not the parent's exclusive fork ordinal. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
		},
	},
	{
		id: "session_created_at",
		view: "session",
		meaning:
			"The session metadata's explicit creation timestamp, not a run's start time.",
		agents: {
			claude_code: pending(
				[],
				"parser 9: identify a literal counterpart if one is recorded; no local witness is not writer absence.",
				{ relation: { kind: "unreviewed" }, evidence: [] },
			),
			codex: pending(
				["session_meta/.timestamp"],
				"parser 9: retain session_created_at as named literal components with record/call provenance; preserve order and absent versus empty, milliseconds versus seconds and bytes versus tokens. Never infer these values from prose.",
				{
					relation: { kind: "close" },
					evidence: [
						{
							kind: "llm_audit",
							reference:
								"docs/l1-judge-round3-decisions.json#ignored:session/session_created_at/codex",
							explanation:
								"Binding round-3 ignored-path placements; the ledger preserves both proposals and each path's ruling. Family components retain separate names, units and provenance; no writer meaning proof is inferred from agreement alone.",
						},
					],
					justification:
						"Judge round 3 agreed_map: The session metadata's explicit creation timestamp, not a run's start time. Preserve the named component and its unit; the two proposals are retained in the decision ledger.",
				},
			),
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
		return fact.sourceMappings
			.filter((source) => source.role === "primary")
			.map((source) => source.path);
	});
}
