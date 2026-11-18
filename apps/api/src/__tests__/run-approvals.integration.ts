import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import { runSql, type SqlCaller } from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	hashTranscriptContent,
	writeTranscriptRecords,
} from "../services/transcript-records-ingest.service.js";

/**
 * Who approved a run's calls and what limits held it up, against real
 * ClickHouse, through the build and the runs view: Claude Code permission
 * decisions by who made them and the prompts a person answered, Codex
 * rate-limit windows and usage-limit errors, and every effort of a run.
 */

setDefaultTimeout(180_000);

const RUN = `run_approvals_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const member = `${RUN}_member`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;
const sessionDate = new Date(baseMs).toISOString();

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};
const caller: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: member, role: "member", ownSessionsOnly: false },
};

/** A Claude Code stream of one version: lines one second apart. */
function claude(version: string) {
	let second = 0;
	const line = (body: Record<string, unknown>) =>
		JSON.stringify({
			sessionId: "s",
			cwd: "/repo",
			gitBranch: "main",
			version,
			entrypoint: "cli",
			timestamp: new Date(baseMs + ++second * 1_000).toISOString(),
			...body,
		});
	return {
		prompt: (text: string) =>
			line({ type: "user", message: { role: "user", content: text } }),
		/** A Bash call and its result, with the result's permissionDecision and denial. */
		bash: (
			id: string,
			result: {
				decision?: Record<string, string>;
				denial?: string;
				effort?: string;
			} = {},
		) => [
			line({
				type: "assistant",
				...(result.effort === undefined ? {} : { effort: result.effort }),
				message: {
					role: "assistant",
					model: "claude-opus-5-5",
					content: [
						{ type: "tool_use", id, name: "Bash", input: { command: "ls" } },
					],
				},
			}),
			line({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: id,
							content:
								result.denial === undefined
									? "README.md"
									: "The user doesn't want to proceed with this tool use.",
							is_error: result.denial !== undefined,
						},
					],
				},
				...(result.denial === undefined
					? { toolUseResult: { stdout: "README.md", stderr: "" } }
					: { toolUseResult: "User rejected tool use" }),
				...(result.decision === undefined
					? {}
					: { permissionDecision: result.decision }),
				...(result.denial === undefined
					? {}
					: { toolDenialKind: result.denial }),
			}),
		],
		rateLimited: () =>
			line({
				type: "assistant",
				isApiErrorMessage: true,
				error: "rate_limit",
				apiErrorStatus: 429,
				quotaLimits: {
					status: "rejected",
					rateLimitType: "five_hour",
					resetsAt: 1_792_000_000,
				},
				message: {
					role: "assistant",
					model: "<synthetic>",
					content: [{ type: "text", text: "API Error: rate limited" }],
				},
			}),
		say: (text: string, effort = "high") =>
			line({
				type: "assistant",
				effort,
				message: {
					role: "assistant",
					model: "claude-opus-5-5",
					content: [{ type: "text", text }],
				},
			}),
	};
}

/** A Codex rollout: lines one second apart. */
function codex() {
	let second = 0;
	const line = (type: string, payload: Record<string, unknown>) =>
		JSON.stringify({
			timestamp: new Date(baseMs + ++second * 1_000).toISOString(),
			type,
			payload,
		});
	const window = (usedPercent: number | null, minutes: number) =>
		usedPercent === null
			? null
			: {
					used_percent: usedPercent,
					window_minutes: minutes,
					resets_at: 1_792_000_000,
				};
	return {
		meta: () =>
			line("session_meta", {
				id: "codex-approvals",
				cli_version: "0.159.2",
				originator: "codex_cli_rs",
				source: "cli",
				cwd: "/repo",
			}),
		turn: (turnId: string, effort: string) => [
			line("event_msg", { type: "task_started", turn_id: turnId }),
			line("turn_context", {
				turn_id: turnId,
				cwd: "/repo",
				approval_policy: "on-request",
				model: "gpt-6.1-sol",
				effort,
			}),
		],
		prompt: (text: string) =>
			line("response_item", {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text }],
			}),
		say: (text: string) =>
			line("response_item", {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text }],
			}),
		tokens: (primary: number | null, secondary: number | null) =>
			line("event_msg", {
				type: "token_count",
				info: null,
				rate_limits: {
					limit_id: "codex",
					primary: window(primary, 300),
					secondary: window(secondary, 10_080),
					credits: null,
					plan_type: "pro",
					rate_limit_reached_type: null,
				},
			}),
		complete: (turnId: string, error?: string) =>
			line("event_msg", {
				type: "task_complete",
				turn_id: turnId,
				last_agent_message: "done",
				...(error === undefined
					? {}
					: { error: { message: "limit", codex_error_info: error } }),
			}),
	};
}

async function upload(
	source: "claude_code" | "codex",
	sessionId: string,
	content: string,
) {
	const stats = createSplitStats();
	await writeTranscriptRecords(clickhouse, {
		organizationId: workspace,
		userId: member,
		sessionId,
		source,
		revision: "1",
		sessionDate,
		contentSha256: hashTranscriptContent(content),
		assertWritable: async () => {},
		drafts: splitSessionTranscript({ content, sessionDate, source }, stats),
		summary: () => summarizeSplit(stats),
	});
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: workspace,
				user_id: member,
				session_id: sessionId,
				source,
				session_date: sessionDate.replace("T", " ").replace("Z", ""),
				last_interaction_date: sessionDate.replace("T", " ").replace("Z", ""),
				project_path: "/repo",
				git_remote: "github.com/acme/shop",
				git_branch: "main",
				model_used: source === "codex" ? "gpt-6.1-sol" : "claude-opus-5-5",
				revision: "1",
			},
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId: member, source, sessionId },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

async function sql(query: string): Promise<string[]> {
	const outcome = await runSql(
		caller,
		{ query, title: "test" },
		{
			executor: clickhouse,
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
			limiter: unlimited,
			githubRepositories: async () => [],
		},
	);
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result.table.split("\n");
}

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.run_requests",
		"rudel.run_setup",
		"rudel.setup_texts",
		"rudel.session_analytics",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

const config = { decision: "accept", source: "config", reasonType: "mode" };

test("a run counts who accepted its calls and the prompts a person answered; a version that records no decision is unknown", async () => {
	const current = claude("2.1.296");
	const session = `${RUN}_claude`;
	await upload(
		"claude_code",
		session,
		[
			current.prompt("tidy the repo"),
			...current.bash("toolu_1", { decision: config, effort: "high" }),
			...current.bash("toolu_2", { decision: config }),
			// Allowed once at a prompt, then by the rule a person saved at one.
			...current.bash("toolu_3", {
				decision: { decision: "accept", source: "user_temporary" },
			}),
			...current.bash("toolu_4", {
				decision: { decision: "accept", source: "user_permanent" },
			}),
			...current.bash("toolu_5", {
				decision: {
					decision: "accept",
					source: "user_permanent",
					reasonType: "rule",
				},
			}),
			...current.bash("toolu_6", {
				decision: { decision: "accept", source: "hook", reasonType: "hook" },
			}),
			// A hook's rejection is no approval and asked nobody.
			...current.bash("toolu_7", {
				decision: { decision: "reject", source: "hook", reasonType: "hook" },
				denial: "permission-rule",
			}),
			// A person's rejection at the prompt carries no decision.
			...current.bash("toolu_8", { denial: "user-rejected" }),
			current.say("Tidied.", "medium"),
			current.prompt("now the docs"),
			current.rateLimited(),
			current.say("Waiting on the limit."),
		].join("\n"),
	);
	const old = claude("2.1.292");
	const oldSession = `${RUN}_claude_old`;
	await upload(
		"claude_code",
		oldSession,
		[
			old.prompt("tidy the repo"),
			...old.bash("toolu_1"),
			old.say("Tidied."),
			old.prompt("and this"),
			// A version without decisions still records a person's rejection.
			...old.bash("toolu_2", { denial: "user-rejected" }),
		].join("\n"),
	);
	expect(
		await sql(
			`SELECT session_id = '${oldSession}' AS old, turn_idx, approvals_by_user, approvals_by_hook, approvals_by_config,
				permission_prompts, has(unrecorded_facts, 'permission_prompts') AS unknown, rate_limited,
				rate_limit_max_used_percent, efforts, model, models
			FROM runs WHERE session_id IN ('${session}', '${oldSession}') ORDER BY old, turn_idx`,
		),
	).toEqual([
		"old | turn_idx | approvals_by_user | approvals_by_hook | approvals_by_config | permission_prompts | unknown | rate_limited | rate_limit_max_used_percent | efforts | model | models",
		'0 | 1 | 3 | 1 | 2 | 3 | 0 | false | null | ["high","medium"] | claude-opus-5-5 | ["claude-opus-5-5"]',
		'0 | 2 | 0 | 0 | 0 | 0 | 0 | true | null | ["high"] | claude-opus-5-5 | ["claude-opus-5-5"]',
		// Its reply records effort high; the run's one result records no decision.
		'1 | 1 | null | null | null | null | 1 | false | null | ["high"] | claude-opus-5-5 | ["claude-opus-5-5"]',
		'1 | 2 | 0 | 0 | 0 | 1 | 0 | false | null | [] | claude-opus-5-5 | ["claude-opus-5-5"]',
	]);
});

test("a Codex run keeps its highest rate-limit window use, says when a usage limit refused it, and every effort", async () => {
	const rollout = codex();
	const session = `${RUN}_codex`;
	await upload(
		"codex",
		session,
		[
			rollout.meta(),
			...rollout.turn("t1", "high"),
			rollout.prompt("check the build"),
			rollout.say("Checking."),
			rollout.tokens(40, 12),
			rollout.say("Built."),
			rollout.tokens(97.5, 13),
			rollout.complete("t1"),
			...rollout.turn("t2", "xhigh"),
			rollout.prompt("ship it"),
			// A response ends the turn's prompts: without one, the next prompt
			// would join this run.
			rollout.say("Shipping."),
			// A full window is not a refusal: the run goes on.
			rollout.tokens(100, null),
			rollout.complete("t2", "usage_limit_exceeded"),
			...rollout.turn("t3", "low"),
			rollout.prompt("one more"),
			rollout.say("No limits reported."),
			rollout.complete("t3"),
		].join("\n"),
	);
	expect(
		await sql(
			`SELECT turn_idx, rate_limit_max_used_percent, rate_limited, effort, efforts,
				has(unrecorded_facts, 'approvals_by_user') AS approvals_unknown, permission_prompts
			FROM runs WHERE session_id = '${session}' ORDER BY turn_idx`,
		),
	).toEqual([
		"turn_idx | rate_limit_max_used_percent | rate_limited | effort | efforts | approvals_unknown | permission_prompts",
		'1 | 97.5 | false | high | ["high"] | 1 | null',
		'2 | 100 | true | xhigh | ["xhigh"] | 1 | null',
		'3 | null | false | low | ["low"] | 1 | null',
	]);
});
