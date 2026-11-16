import {
	type CompassRunRef,
	type CompassSettings,
	MOMENT_KINDS,
	type MomentKind,
	type MomentObservation,
	type Moments,
	type NoticeableRun,
	RUN_RECORD_TEXT_MAX_CHARS,
	RUN_RECORDS_MAX,
	type RunDetail,
	type RunFlag,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import {
	pinnedParams,
	pinnedRecords,
} from "../transcript-generations/generations.js";
import { readCompassSettings } from "./compass-settings.js";
import { readFrustration } from "./frustration.js";
import {
	type FlagContext,
	flagsOfRun,
	type MomentScope,
	type RunEvidence,
	RunEvidenceSchema,
	rankValuesStatement,
	runEvidenceStatement,
	topPercentCutoff,
} from "./moment-rules.js";
import {
	insertObservation,
	momentKey,
	observationsToday,
	readObservationById,
	readObservations,
	setFeedback,
} from "./observation-store.js";
import {
	normalizeObservation,
	OBSERVATION_PROMPT_VERSION,
	type ObservationModel,
	readSpanText,
} from "./observer.js";
import type { RunEvidencePages } from "./run-evidence-pages.js";

/**
 * Noticeable runs for the Compass page (CONTEXT.md "Moment"): every run of
 * the range the caller may read that at least one of the workspace's flags
 * marks, newest first, each with its newest observation; observing one on
 * request; votes on observations. A run's flags are always found again from
 * its committed build here, never taken from the client, so only real
 * flagged records are ever sent to the model.
 */

export interface MomentsEnv {
	readonly executor: ClickHouseExecutor;
	readonly sql: postgres.Sql;
	featureEnabled(
		feature: "moments" | "moment_observations" | "frustration_check",
		workspaceId: string,
	): Promise<boolean>;
	readonly model: ObservationModel | null;
	/** Observations a workspace may write per UTC day. */
	readonly dailyLimit: number;
	now(): Date;
	readonly evidencePages?: RunEvidencePages;
}

export interface MomentsCaller extends MomentScope {
	/** The member asking. */
	readonly viewerId: string;
}

export class MomentNotFoundError extends Error {}
export class ObservationsUnavailableError extends Error {}
export class ObservationLimitError extends Error {}

/** Default and bounds of `MOMENT_OBSERVATIONS_DAILY_LIMIT`. */
export const DEFAULT_OBSERVATIONS_DAILY_LIMIT = 100;

export function observationsDailyLimit(
	value = process.env.MOMENT_OBSERVATIONS_DAILY_LIMIT,
): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0
		? Math.min(parsed, 10_000)
		: DEFAULT_OBSERVATIONS_DAILY_LIMIT;
}

/** Whether members of the workspace may observe moments now. */
export async function mayObserve(
	env: Pick<MomentsEnv, "featureEnabled" | "model">,
	workspaceId: string,
): Promise<boolean> {
	return (
		env.model !== null &&
		(await env.featureEnabled("moment_observations", workspaceId))
	);
}

export async function listMoments(
	env: MomentsEnv,
	caller: MomentsCaller,
	input: {
		startDate: string;
		endDate: string;
		kinds?: readonly MomentKind[];
		mine: boolean;
		limit: number;
		offset: number;
	},
): Promise<Moments> {
	const scope: MomentScope = {
		workspaceId: caller.workspaceId,
		member: input.mine ? caller.viewerId : caller.member,
	};
	if (input.mine && caller.member !== null && caller.member !== caller.viewerId)
		throw new MomentNotFoundError("Not your runs.");
	const load = () => readRunEvidence(env.executor, scope, input);
	const [runs, observable, settings, frustrationCheck] = await Promise.all([
		env.evidencePages
			? env.evidencePages.read(
					JSON.stringify([
						scope.workspaceId,
						scope.member,
						input.startDate,
						input.endDate,
					]),
					input.offset,
					load,
				)
			: load(),
		mayObserve(env, caller.workspaceId),
		readCompassSettings(env.sql, caller.workspaceId),
		env.featureEnabled("frustration_check", caller.workspaceId),
	]);
	const flagged = await flagRuns(env, caller.workspaceId, runs, settings, {
		frustrationCheck,
	});
	const wanted = new Set(
		input.kinds && input.kinds.length > 0 ? input.kinds : MOMENT_KINDS,
	);
	const counts = Object.fromEntries(
		MOMENT_KINDS.map((kind) => [kind, 0]),
	) as Record<MomentKind, number>;
	const all: { run: RunEvidence; flags: RunFlag[] }[] = [];
	for (const entry of flagged) {
		for (const kind of new Set(entry.flags.map((flag) => flag.kind)))
			counts[kind]++;
		if (entry.flags.some((flag) => wanted.has(flag.kind))) all.push(entry);
	}
	const perDay = new Map<string, number>();
	for (const { run } of all) {
		const date = new Date(run.started_ms).toISOString().slice(0, 10);
		perDay.set(date, (perDay.get(date) ?? 0) + 1);
	}
	const page = all.slice(input.offset, input.offset + input.limit);
	const observations = await readObservations(
		env.sql,
		caller.workspaceId,
		page.map(({ run }) => ({ ...runKeyOf(run), revision: run.revision })),
		caller.viewerId,
	);
	return {
		observable,
		frustrationCheck,
		runs: runs.length,
		counts,
		days: [...perDay]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, count]) => ({ date, count })),
		noticeable: page.map(({ run, flags }) =>
			toNoticeableRun(
				run,
				flags,
				observations.get(momentKey(runKeyOf(run))) ?? null,
			),
		),
		nextOffset:
			all.length > input.offset + input.limit
				? input.offset + input.limit
				: null,
	};
}

/**
 * One noticeable run with all its records in order, for the right pane of
 * Compass: its flags found again in its committed build, its newest
 * observation, and its records from the run's own transcript generation.
 */
export async function readRunDetail(
	env: MomentsEnv,
	caller: MomentsCaller,
	input: CompassRunRef & { startDate: string; endDate: string },
): Promise<RunDetail> {
	const { run, flags } = await findFlaggedRun(env, caller, input);
	const ref = runKeyOf(run);
	const [observations, observable, rows] = await Promise.all([
		readObservations(
			env.sql,
			caller.workspaceId,
			[{ ...ref, revision: run.revision }],
			caller.viewerId,
		),
		mayObserve(env, caller.workspaceId),
		query(env.executor, RunRecordRowSchema, {
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			query: `SELECT record_idx, block_idx, toUnixTimestamp64Milli(ts) AS ts_ms,
					kind, subtype, tool_name,
					toUInt8(is_error OR coalesce(exit_code, 0) != 0) AS failed, exit_code,
					file_path, file_op, text_chars,
					substringUTF8(if(text_chars <= {maxChars:UInt32}, text, head), 1, {maxChars:UInt32}) AS text
				FROM ${getSafeClickHouseTable("rudel.transcript_records")} FINAL
				WHERE ${pinnedRecords()} AND agent_id = {agentId:String}
					AND turn_idx = {turn:UInt32}
					AND kind != 'meta'
				ORDER BY record_idx, block_idx
				LIMIT {limit:UInt32}`,
			query_params: {
				...pinnedParams(
					{ organizationId: caller.workspaceId, userId: run.user_id },
					[
						{
							sessionId: run.session_id,
							revision: run.revision,
							parserVersion: run.parser_version,
						},
					],
				),
				agentId: run.agent_id,
				turn: run.turn_idx,
				maxChars: RUN_RECORD_TEXT_MAX_CHARS,
				limit: RUN_RECORDS_MAX + 1,
			},
		}),
	]);
	return {
		run: toNoticeableRun(run, flags, observations.get(momentKey(ref)) ?? null),
		observable,
		records: rows.slice(0, RUN_RECORDS_MAX).map((row) => ({
			record: row.record_idx,
			block: row.block_idx,
			at: row.ts_ms > 0 ? new Date(row.ts_ms).toISOString() : null,
			kind: row.kind,
			subtype: row.subtype,
			tool: row.tool_name,
			failed: row.failed === 1,
			exitCode: row.exit_code,
			filePath: row.file_path,
			fileOp: row.file_op,
			text: row.text,
			textChars: row.text_chars,
		})),
		truncated: rows.length > RUN_RECORDS_MAX,
	};
}

const RunRecordRowSchema = z.object({
	record_idx: z.coerce.number(),
	block_idx: z.coerce.number(),
	ts_ms: z.coerce.number(),
	kind: z.string(),
	subtype: z.string(),
	tool_name: z.string(),
	failed: z.coerce.number(),
	exit_code: z.coerce.number().nullable(),
	file_path: z.string(),
	file_op: z.string(),
	text_chars: z.coerce.number(),
	text: z.string(),
});

/**
 * Observes one noticeable run: finds it and its flags again in its committed
 * build, returns the stored observation of that revision when there is one,
 * else sends the flagged records to the model (within the workspace's daily
 * limit) and stores it.
 */
export async function observeMoment(
	env: MomentsEnv,
	caller: MomentsCaller,
	input: CompassRunRef & { startDate: string; endDate: string },
): Promise<MomentObservation> {
	if (!(await mayObserve(env, caller.workspaceId)) || env.model === null)
		throw new ObservationsUnavailableError(
			"Observations are not enabled for this workspace.",
		);
	const model = env.model;
	const { run, flags } = await findFlaggedRun(env, caller, input);
	const ref = runKeyOf(run);
	const key = { ...ref, revision: run.revision };
	const stored = (
		await readObservations(env.sql, caller.workspaceId, [key], caller.viewerId)
	).get(momentKey(ref));
	if (stored) return stored;

	if (
		(await observationsToday(env.sql, caller.workspaceId, env.now())) >=
		env.dailyLimit
	)
		throw new ObservationLimitError(
			`This workspace has used today's ${env.dailyLimit} observations. Try again tomorrow.`,
		);
	const span = {
		start: Math.min(...flags.map((flag) => flag.spanStart)),
		end: Math.max(...flags.map((flag) => flag.spanEnd)),
	};
	const records = await readSpanText(
		env.executor,
		{
			workspaceId: caller.workspaceId,
			userId: run.user_id,
			sessionId: run.session_id,
			agentId: run.agent_id,
			revision: run.revision,
			parserVersion: run.parser_version,
		},
		span,
	);
	if (!records) throw new MomentNotFoundError("The run's records are gone.");
	const result = await model.observe({
		flags,
		prompt: run.prompt_head,
		records,
	});
	const id = await insertObservation(env.sql, {
		...key,
		workspaceId: caller.workspaceId,
		runStartedAt: new Date(run.started_ms),
		spanStart: span.start,
		spanEnd: span.end,
		...normalizeObservation(result.output, span),
		model: model.model,
		promptVersion: OBSERVATION_PROMPT_VERSION,
		inputTokens: result.inputTokens,
		outputTokens: result.outputTokens,
		createdBy: caller.viewerId,
	});
	const saved = await readObservationById(
		env.sql,
		caller.workspaceId,
		id,
		caller.viewerId,
	);
	if (!saved) throw new MomentNotFoundError("Run not found.");
	return saved;
}

/**
 * A run the caller may read, with its flags found again in its committed
 * build, ranked against the range the page showed it in, as it was there.
 * Throws when the run is gone or no flag marks it.
 */
async function findFlaggedRun(
	env: MomentsEnv,
	caller: MomentsCaller,
	input: CompassRunRef & { startDate: string; endDate: string },
): Promise<{ run: RunEvidence; flags: RunFlag[] }> {
	const ref: CompassRunRef = {
		userId: input.userId,
		sessionId: input.sessionId,
		agentId: input.agentId,
		turn: input.turn,
	};
	if (caller.member !== null && ref.userId !== caller.member)
		throw new MomentNotFoundError("Run not found.");
	const [run] = await readRunEvidence(
		env.executor,
		{ workspaceId: caller.workspaceId, member: ref.userId },
		{ run: ref },
	);
	if (!run) throw new MomentNotFoundError("Run not found.");
	const rank = rankValuesStatement(
		{ workspaceId: caller.workspaceId, member: caller.member },
		input,
	);
	const [settings, frustrationCheck, ranked] = await Promise.all([
		readCompassSettings(env.sql, caller.workspaceId),
		env.featureEnabled("frustration_check", caller.workspaceId),
		query(env.executor, rank.schema, {
			query: rank.query,
			query_params: rank.query_params,
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		}),
	]);
	const [entry] = await flagRuns(env, caller.workspaceId, [run], settings, {
		frustrationCheck,
		rankAgainst: ranked.map((row) => ({
			cost: row.cost_usd ?? 0,
			minutes: row.minutes,
		})),
	});
	if (!entry) throw new MomentNotFoundError("Run is not noticeable.");
	return entry;
}

/**
 * Each run with the flags the workspace has on, keeping only runs with at
 * least one. Cost and duration rank against the runs passed in; SubQ's
 * frustration answers count only where the workspace has the check on.
 */
export async function flagRuns(
	env: Pick<MomentsEnv, "sql">,
	workspaceId: string,
	runs: readonly RunEvidence[],
	settings: CompassSettings,
	options: {
		frustrationCheck: boolean;
		/** Runs to rank cost and duration against; the runs themselves when missing. */
		rankAgainst?: readonly { cost: number; minutes: number }[];
	},
): Promise<{ run: RunEvidence; flags: RunFlag[] }[]> {
	const ranked =
		options.rankAgainst ??
		runs.map((run) => ({ cost: run.cost_usd ?? 0, minutes: run.minutes }));
	const frustration =
		options.frustrationCheck && settings.flags.user_frustrated.enabled
			? await readFrustration(
					env.sql,
					workspaceId,
					runs.map((run) => run.session_id),
				)
			: new Map<string, number>();
	const costCutoff = settings.flags.expensive_run.enabled
		? topPercentCutoff(
				ranked.map((run) => run.cost),
				settings.flags.expensive_run.value ?? 10,
			)
		: null;
	const minutesCutoff = settings.flags.long_run.enabled
		? topPercentCutoff(
				ranked.map((run) => run.minutes),
				settings.flags.long_run.value ?? 10,
			)
		: null;
	const rankedFigures = {
		costs: ranked.map((run) => run.cost),
		minutes: ranked.map((run) => run.minutes),
	};
	const flagged: { run: RunEvidence; flags: RunFlag[] }[] = [];
	for (const run of runs) {
		const context: FlagContext = {
			costCutoff,
			minutesCutoff,
			ranked: rankedFigures,
			frustration: frustration.get(momentKey(runKeyOf(run))) ?? null,
		};
		const flags = flagsOfRun(run, settings, context);
		if (flags.length > 0) flagged.push({ run, flags });
	}
	return flagged;
}

function runKeyOf(run: RunEvidence) {
	return {
		userId: run.user_id,
		sessionId: run.session_id,
		agentId: run.agent_id,
		turn: run.turn_idx,
	};
}

/** A member's vote on an observation of a run they may read. */
export async function voteOnObservation(
	env: Pick<MomentsEnv, "sql">,
	caller: MomentsCaller,
	input: { observationId: string; useful: boolean | null },
): Promise<MomentObservation["feedback"]> {
	const observation = await readObservationById(
		env.sql,
		caller.workspaceId,
		input.observationId,
		caller.viewerId,
	);
	if (
		!observation ||
		(caller.member !== null && observation.userId !== caller.member)
	)
		throw new MomentNotFoundError("Observation not found.");
	return setFeedback(env.sql, { ...input, userId: caller.viewerId });
}

function readRunEvidence(
	executor: ClickHouseExecutor,
	scope: MomentScope,
	range: Parameters<typeof runEvidenceStatement>[1],
): Promise<RunEvidence[]> {
	return query(executor, RunEvidenceSchema, {
		...runEvidenceStatement(scope, range),
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
}

function toNoticeableRun(
	run: RunEvidence,
	flags: RunFlag[],
	observation: MomentObservation | null,
): NoticeableRun {
	const ref = runKeyOf(run);
	return {
		...ref,
		id: momentKey(ref),
		startedAt: new Date(run.started_ms).toISOString(),
		prompt: run.prompt_head,
		model: run.model || null,
		costUsd: run.cost_usd,
		minutes: run.minutes,
		flags,
		observation,
	};
}
