import { createHash } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import { workspaceList } from "../analysis-log/config.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import {
	type AskedQuestion,
	type RunQuestionProvider,
	RunQuestionProviderBusy,
} from "../run-questions/provider.js";
import { momentKey } from "./observation-store.js";

const logger = getLogger(["rudel", "api", "compass", "frustration"]);

/**
 * Compass's frustration check: SubQ answers one yes/no question, "Is the
 * user frustrated?", about each member prompt that follows a run, with the
 * agent's last message for context, in workspaces with the
 * `frustration_check` switch (and Compass). The answer is stored per run and
 * prompt text hash (`prompt_frustration`, migration 0068), so a re-upload
 * never asks again; the User frustrated flag reads it. Only the prompt and
 * the agent's last message are sent.
 */

export const FRUSTRATION_QUESTION: AskedQuestion = {
	id: "user_frustrated",
	question: "Is the user frustrated?",
	criteria: {
		true: "The member's message pushes back on what the agent did: frustration, annoyance or impatience, complaining, repeating an instruction the agent ignored, correcting the agent (calmly or not), swearing, shouting, or saying it still does not work.",
		false:
			"A neutral or positive message: a new task, a plain follow-up, a question, praise, or a short approval like ok or good.",
	},
};

/** Days back the check looks for prompts without an answer. */
export const FRUSTRATION_LOOKBACK_DAYS = 14;
/** Prompts one workspace's pass reads at most. */
const PROMPTS_PER_WORKSPACE = 200;
/** Characters of the member's prompt and of the agent's last message sent at most. */
const PROMPT_MAX_CHARS = 3_000;
const MESSAGE_MAX_CHARS = 2_000;
/** Calls to SubQ at once. */
const CONCURRENCY = 4;

export interface FrustrationEnv {
	readonly executor: ClickHouseExecutor;
	readonly sql: postgres.Sql;
	readonly provider: RunQuestionProvider | null;
	featureEnabled(
		feature: "moments" | "frustration_check",
		workspaceId: string,
	): Promise<boolean>;
}

/** SubQ's newest answer for each run (by `momentKey`) in these sessions. */
export async function readFrustration(
	sql: postgres.Sql,
	workspaceId: string,
	sessionIds: readonly string[],
): Promise<Map<string, number>> {
	const found = new Map<string, number>();
	if (sessionIds.length === 0) return found;
	const rows = await sql<
		{
			user_id: string;
			session_id: string;
			agent_id: string;
			turn_idx: number;
			probability: number;
		}[]
	>`
		SELECT DISTINCT ON (user_id, session_id, agent_id, turn_idx)
			user_id, session_id, agent_id, turn_idx, probability
		FROM prompt_frustration
		WHERE organization_id = ${workspaceId}
			AND session_id = ANY(${[...new Set(sessionIds)]}::text[])
		ORDER BY user_id, session_id, agent_id, turn_idx, created_at DESC
	`;
	for (const row of rows)
		found.set(
			momentKey({
				userId: row.user_id,
				sessionId: row.session_id,
				agentId: row.agent_id,
				turn: row.turn_idx,
			}),
			row.probability,
		);
	return found;
}

/** Workspaces whose prompts the check may send: the switch's list or rows, then both switches on. */
export async function frustrationWorkspaces(
	env: Pick<FrustrationEnv, "sql" | "featureEnabled">,
): Promise<string[]> {
	const listed = workspaceList("FRUSTRATION_CHECK_WORKSPACES");
	const candidates = new Set<string>(listed.error ? [] : listed.ids);
	if (listed.all && !listed.error)
		for (const row of await env.sql<{ id: string }[]>`
			SELECT id FROM organization ORDER BY id LIMIT 10000
		`)
			candidates.add(row.id);
	for (const row of await env.sql<{ organization_id: string }[]>`
		SELECT organization_id FROM workspace_feature
		WHERE feature = 'frustration_check' AND enabled
	`)
		candidates.add(row.organization_id);
	const allowed: string[] = [];
	for (const workspaceId of candidates)
		if (
			(await env.featureEnabled("frustration_check", workspaceId)) &&
			(await env.featureEnabled("moments", workspaceId))
		)
			allowed.push(workspaceId);
	return allowed.sort();
}

const PendingPromptSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	final_message: z.string(),
	prompt: z.string(),
});
type PendingPrompt = z.infer<typeof PendingPromptSchema> & { sha: string };

/**
 * The newest member prompts of a workspace that follow a main-stream run in
 * its committed build, with the run's last agent message; the caller drops
 * those already answered.
 */
async function recentPrompts(
	executor: ClickHouseExecutor,
	workspaceId: string,
): Promise<PendingPrompt[]> {
	const runs = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const records = getSafeClickHouseTable("rudel.transcript_records");
	const owner = "organization_id = {workspaceId:String}";
	const rows = await query(executor, PendingPromptSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH r AS (
				SELECT user_id, session_id, agent_id, turn_idx, revision, parser_version,
					started_at, coalesce(final_message, '') AS final_message
				FROM ${runs} FINAL
				WHERE ${owner} AND row_kind = 'run' AND agent_id = ''
					AND started_at >= now() - INTERVAL {days:UInt32} DAY
					AND ${committedBuildSql(runs, owner, ["user_id", "session_id"])}
			),
			p AS (
				SELECT user_id, session_id, turn_idx,
					substring(argMin(text, record_idx), 1, ${PROMPT_MAX_CHARS}) AS prompt
				FROM ${records} FINAL
				WHERE ${owner} AND agent_id = '' AND kind = 'user_prompt' AND subtype != 'delegation'
					AND (user_id, session_id, revision, parser_version) IN (
						SELECT user_id, session_id, revision, parser_version FROM r
					)
				GROUP BY user_id, session_id, turn_idx
			)
			SELECT r.user_id AS user_id, r.session_id AS session_id, r.agent_id AS agent_id,
				r.turn_idx AS turn_idx,
				substring(r.final_message, 1, ${MESSAGE_MAX_CHARS}) AS final_message,
				p.prompt AS prompt
			FROM r
			INNER JOIN p ON p.user_id = r.user_id AND p.session_id = r.session_id
				AND p.turn_idx = r.turn_idx + 1
			WHERE p.prompt != ''
			ORDER BY r.started_at DESC
			LIMIT {limit:UInt32}`,
		query_params: {
			workspaceId,
			days: FRUSTRATION_LOOKBACK_DAYS,
			limit: PROMPTS_PER_WORKSPACE,
		},
	});
	return rows.map((row) => ({ ...row, sha: promptSha(row.prompt) }));
}

export function promptSha(prompt: string): string {
	return createHash("sha256").update(prompt).digest("hex");
}

/** What SubQ reads: the agent's last message, then the member's reply. */
export function frustrationState(input: {
	finalMessage: string;
	prompt: string;
}): string {
	return `The agent's last message before the member wrote:
<agent>
${input.finalMessage || "(the run ended without a message)"}
</agent>

The member's next message:
<member>
${input.prompt}
</member>`;
}

/**
 * One pass: for each allowed workspace, asks SubQ about prompts without an
 * answer, newest first, until the budget or `maxPrompts` runs out. Stops at
 * once when SubQ is busy. Best-effort: a failed call is asked again on a
 * later pass.
 */
export async function checkFrustration(
	env: FrustrationEnv,
	options: { budgetMs: number; maxPrompts: number },
): Promise<{ workspaces: number; asked: number; costUsd: number }> {
	const provider = env.provider;
	if (!provider) return { workspaces: 0, asked: 0, costUsd: 0 };
	const deadline = Date.now() + options.budgetMs;
	const workspaces = await frustrationWorkspaces(env);
	let asked = 0;
	let costUsd = 0;
	for (const workspaceId of workspaces) {
		if (Date.now() >= deadline || asked >= options.maxPrompts) break;
		const prompts = await recentPrompts(env.executor, workspaceId);
		const answered = await answeredShas(env.sql, workspaceId, prompts);
		const pending = prompts.filter(
			(prompt) =>
				!answered.has(`${momentKey(promptKey(prompt))}\u0000${prompt.sha}`),
		);
		let busy = false;
		for (
			let index = 0;
			index < pending.length && !busy && Date.now() < deadline;
			index += CONCURRENCY
		) {
			const batch = pending.slice(
				index,
				Math.min(index + CONCURRENCY, index + options.maxPrompts - asked),
			);
			if (batch.length === 0) break;
			const results = await Promise.allSettled(
				batch.map((prompt) =>
					askOne(env, provider, workspaceId, prompt, deadline),
				),
			);
			for (const result of results) {
				if (result.status === "fulfilled") {
					asked++;
					costUsd += result.value;
				} else if (result.reason instanceof RunQuestionProviderBusy)
					busy = true;
				else
					logger.warn("Frustration check failed for a prompt: {error}", {
						error:
							result.reason instanceof Error
								? result.reason.message
								: String(result.reason),
					});
			}
		}
		if (busy) break;
	}
	return { workspaces: workspaces.length, asked, costUsd };
}

function promptKey(prompt: PendingPrompt) {
	return {
		userId: prompt.user_id,
		sessionId: prompt.session_id,
		agentId: prompt.agent_id,
		turn: prompt.turn_idx,
	};
}

async function answeredShas(
	sql: postgres.Sql,
	workspaceId: string,
	prompts: readonly PendingPrompt[],
): Promise<Set<string>> {
	if (prompts.length === 0) return new Set();
	const rows = await sql<
		{
			user_id: string;
			session_id: string;
			agent_id: string;
			turn_idx: number;
			prompt_sha256: string;
		}[]
	>`
		SELECT user_id, session_id, agent_id, turn_idx, prompt_sha256
		FROM prompt_frustration
		WHERE organization_id = ${workspaceId}
			AND session_id = ANY(${[...new Set(prompts.map((prompt) => prompt.session_id))]}::text[])
	`;
	return new Set(
		rows.map(
			(row) =>
				`${momentKey({ userId: row.user_id, sessionId: row.session_id, agentId: row.agent_id, turn: row.turn_idx })}\u0000${row.prompt_sha256}`,
		),
	);
}

async function askOne(
	env: FrustrationEnv,
	provider: RunQuestionProvider,
	workspaceId: string,
	prompt: PendingPrompt,
	deadline: number,
): Promise<number> {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		Math.max(1_000, deadline - Date.now()),
	);
	try {
		const answers = await provider.answer({
			state: frustrationState({
				finalMessage: prompt.final_message,
				prompt: prompt.prompt,
			}),
			questions: [FRUSTRATION_QUESTION],
			signal: controller.signal,
		});
		const probability = answers.probabilities.get(FRUSTRATION_QUESTION.id);
		if (probability === undefined)
			throw new Error("SubQ gave no answer to the frustration question.");
		await env.sql`
			INSERT INTO prompt_frustration (
				organization_id, user_id, session_id, agent_id, turn_idx, prompt_sha256,
				probability, provider, model
			) VALUES (
				${workspaceId}, ${prompt.user_id}, ${prompt.session_id}, ${prompt.agent_id},
				${prompt.turn_idx}, ${prompt.sha}, ${probability}, ${provider.name}, ${answers.model}
			)
			ON CONFLICT DO NOTHING
		`;
		return answers.costUsd;
	} finally {
		clearTimeout(timer);
	}
}
