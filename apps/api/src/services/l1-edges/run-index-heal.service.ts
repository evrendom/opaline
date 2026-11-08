import { getLogger } from "@logtape/logtape";
import type {
	RunIndexHealOrganization,
	RunIndexHealSkipReason,
	RunIndexHealStatus,
	RunIndexHealTier,
} from "@rudel/api-routes";
import {
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type { MaintenanceDeadline } from "../../lib/bounded-maintenance.js";
import { isSelfHosted } from "../../lib/self-hosted.js";
import {
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
} from "../analysis/run-index-sql.js";
import { readClickHouseLoadAverage } from "../backfill-pacing.js";
import { TRANSCRIPT_RECORDS_TABLE } from "../transcript-records-ingest.service.js";
import { enqueueL1EdgeSessionScopes } from "./l1-edge-queue.service.js";
import { RUN_INDEX_TABLE } from "./l1-edge-tables.js";
import {
	type RunIndexBackfillRow,
	selectQueueable,
} from "./run-index-backfill.service.js";

const logger = getLogger(["rudel", "api", "run-index-heal"]);

export const RUN_INDEX_HEAL_FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_PAGES_PER_ORGANIZATION = 4;
const MAX_SELECTIONS_PER_TICK = 12;
const MAX_CENSUS_ORGANIZATIONS = 10_000;
const MIN_REMAINING_MS = 15_000;

const RECEIPT_SETTINGS = {
	join_use_nulls: 0,
	readonly: "2",
	max_rows_to_read: "2000000000",
	max_bytes_to_read: String(32 * 1024 * 1024 * 1024),
	max_memory_usage: String(2 * 1024 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;

export interface RunIndexHealConfig {
	readonly enabled: boolean;
	readonly workerEnabled: boolean;
	readonly reparse: boolean;
	readonly maxPerTick: number;
	readonly maxReparsePerTick: number;
	readonly maxPending: number;
	readonly maxRecentFailures: number;
	readonly slowMs: number;
	readonly maxLoad: number;
	readonly adminOrganizationId: string | null;
	readonly retroOrganizationIds: ReadonlySet<string> | "all";
	readonly deprioritizedOrganizationIds: ReadonlySet<string>;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function readRunIndexHealConfig(
	env: Environment = process.env,
): RunIndexHealConfig {
	const retro = isSelfHosted(env) ? "all" : readRetroWorkspaces(env);
	return {
		enabled:
			readFlag(env, "RUN_INDEX_HEAL_ENABLED", true) &&
			env.L1_EDGES_ENQUEUE_ENABLED !== "false",
		workerEnabled:
			isSelfHosted(env) || readFlag(env, "L1_EDGES_WORKER_ENABLED", false),
		reparse: readFlag(env, "RUN_INDEX_HEAL_REPARSE_ENABLED", false),
		maxPerTick: readCount(env, "RUN_INDEX_HEAL_MAX_PER_TICK", 25, 1),
		maxReparsePerTick: readCount(
			env,
			"RUN_INDEX_HEAL_REPARSE_MAX_PER_TICK",
			10,
			1,
		),
		maxPending: readCount(env, "RUN_INDEX_HEAL_MAX_PENDING", 100, 0),
		maxRecentFailures: readCount(
			env,
			"RUN_INDEX_HEAL_MAX_RECENT_FAILURES",
			3,
			1,
		),
		slowMs: readCount(env, "RUN_INDEX_HEAL_SLOW_MS", 30_000, 1_000),
		maxLoad: readCount(env, "RUN_INDEX_HEAL_MAX_LOAD", 12, 1),
		adminOrganizationId: env.VITE_ADMIN_ORGANIZATION_ID?.trim() || null,
		retroOrganizationIds: retro,
		deprioritizedOrganizationIds: new Set(
			(env.RUN_INDEX_HEAL_DEPRIORITIZED_ORGS ?? "")
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean),
		),
	};
}

function readRetroWorkspaces(env: Environment): ReadonlySet<string> | "all" {
	const ids = (env.RETRO_TOOLS_WORKSPACES ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	if (!ids.includes("*")) return new Set(ids);
	return ids.length === 1 ? "all" : new Set();
}

function readFlag(env: Environment, name: string, fallback: boolean): boolean {
	const value = env[name];
	if (value === undefined || value === "") return fallback;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${name} must be either "true" or "false"`);
}

function readCount(
	env: Environment,
	name: string,
	fallback: number,
	minimum: number,
): number {
	const value = env[name];
	const parsed = value === undefined || value === "" ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum)
		throw new Error(
			`${name} must be a safe integer greater than or equal to ${minimum}`,
		);
	return parsed;
}

const TIER_RANK: Record<RunIndexHealTier, number> = {
	admin: 0,
	retro: 1,
	active: 2,
	deprioritized: 3,
};

export function healTier(
	organizationId: string,
	config: Pick<
		RunIndexHealConfig,
		| "adminOrganizationId"
		| "retroOrganizationIds"
		| "deprioritizedOrganizationIds"
	>,
): RunIndexHealTier {
	if (organizationId === config.adminOrganizationId) return "admin";
	if (config.deprioritizedOrganizationIds.has(organizationId))
		return "deprioritized";
	if (
		config.retroOrganizationIds === "all" ||
		config.retroOrganizationIds.has(organizationId)
	)
		return "retro";
	return "active";
}

export interface CensusOrganization {
	readonly organizationId: string;
	readonly sessions: number;
	readonly stale: number;
	readonly indexStale: number;
	readonly parserStale: number;
	readonly lastSessionAt: string | null;
}

export function orderHealOrganizations<T extends CensusOrganization>(
	organizations: readonly T[],
	config: Parameters<typeof healTier>[1],
): (T & { tier: RunIndexHealTier })[] {
	return organizations
		.map((organization) => ({
			...organization,
			tier: healTier(organization.organizationId, config),
		}))
		.sort(
			(a, b) =>
				TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
				(b.lastSessionAt ?? "").localeCompare(a.lastSessionAt ?? "") ||
				a.organizationId.localeCompare(b.organizationId),
		);
}

export interface QueueState {
	readonly pending: number;
	readonly recentFailures: number;
}

export function decideHealThrottle(
	config: Pick<
		RunIndexHealConfig,
		"enabled" | "workerEnabled" | "maxPending" | "maxRecentFailures"
	>,
	queue: QueueState | null,
): RunIndexHealSkipReason | null {
	if (!config.enabled) return "disabled";
	if (!config.workerEnabled) return "worker_disabled";
	if (queue === null) return null;
	if (queue.pending > config.maxPending) return "queue_backlog";
	if (queue.recentFailures >= config.maxRecentFailures)
		return "recent_failures";
	return null;
}

export function classifyClickHouseFailure(
	error: unknown,
): "clickhouse_error" | "clickhouse_slow" {
	const text = `${(error as { code?: unknown })?.code ?? ""} ${
		error instanceof Error ? `${error.name} ${error.message}` : String(error)
	}`;
	return /\b159\b|TIMEOUT_EXCEEDED|timeout|timed out/i.test(text)
		? "clickhouse_slow"
		: "clickhouse_error";
}

export type HealReason =
	| "missing"
	| "generation"
	| "index_version"
	| "pricing_version"
	| "current";

export const HealRowSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	session_id: z.string(),
	source: z.string(),
	revision_text: z.string(),
	parser_version: z.coerce.number(),
	session_date: z.string(),
	reason: z.enum([
		"missing",
		"generation",
		"index_version",
		"pricing_version",
		"current",
	]),
});
export type HealRow = z.infer<typeof HealRowSchema>;

export interface HealPlan {
	readonly reparse: HealRow[];
	readonly index: RunIndexBackfillRow[];
}

export function planHealRows(
	rows: readonly HealRow[],
	options: { readonly reparse: boolean; readonly maxReparse: number },
): HealPlan {
	const reparse: HealRow[] = [];
	const index: RunIndexBackfillRow[] = [];
	for (const row of rows) {
		const queued = asIndexRow(row);
		if (queued) index.push(queued);
		else if (
			options.reparse &&
			row.parser_version < TRANSCRIPT_RECORDS_PARSER_VERSION &&
			reparse.length < options.maxReparse
		)
			reparse.push(row);
	}
	return { reparse, index };
}

export function asIndexRow(row: HealRow): RunIndexBackfillRow | null {
	if (row.reason === "current") return null;
	return {
		organization_id: row.organization_id,
		user_id: row.user_id,
		session_id: row.session_id,
		source: row.source,
		revision_text: row.revision_text,
		parser_version: row.parser_version,
		reason: row.reason,
	};
}

function staleSources(organizationFilter: string): string {
	return `WITH records AS (
				SELECT organization_id, user_id, session_id, any(source) AS session_source,
					max((revision, parser_version)) AS generation,
					argMax(session_date, (revision, parser_version)) AS last_session_date
				FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
				WHERE kind = 'receipt' AND agent_id = '' AND record_idx = {receiptRecordIdx:UInt32} AND block_idx = 0
					AND source IN ('claude_code', 'codex') ${organizationFilter}
				GROUP BY organization_id, user_id, session_id
			),
			indexed AS (
				SELECT organization_id, user_id, session_id, toUInt8(1) AS present,
					argMax(tuple(revision, parser_version, index_version, pricing_version),
						tuple(revision, parser_version, index_version, build_revision)) AS committed
				FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
				WHERE row_kind = 'receipt' ${organizationFilter}
				GROUP BY organization_id, user_id, session_id
			)`;
}

const JOINED =
	"records.organization_id = indexed.organization_id AND records.user_id = indexed.user_id AND records.session_id = indexed.session_id";
const INDEX_STALE = `(indexed.present = 0
				OR tuple(indexed.committed.1, indexed.committed.2) != records.generation
				OR indexed.committed.3 != {indexVersion:UInt16}
				OR indexed.committed.4 != {pricingVersion:String})`;
const PARSER_STALE = "records.generation.2 < {parserVersion:UInt16}";
const WANTED = `(${INDEX_STALE} OR ({reparse:UInt8} = 1 AND ${PARSER_STALE}))`;

function versionParams(reparse: boolean) {
	return {
		indexVersion: RUN_INDEX_VERSION,
		parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
		pricingVersion: RUN_INDEX_PRICING_VERSION,
		receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
		reparse: reparse ? 1 : 0,
	};
}

function timeLimit(slowMs: number) {
	return { max_execution_time: Math.max(1, Math.ceil(slowMs / 1_000)) };
}

export function buildHealCensusStatement(input: {
	readonly reparse: boolean;
	readonly slowMs: number;
	readonly organizationIds?: readonly string[];
}): ClickHouseStatement {
	const filter =
		input.organizationIds === undefined
			? ""
			: "AND organization_id IN {organizationIds:Array(String)}";
	return {
		clickhouse_settings: {
			...RECEIPT_SETTINGS,
			...timeLimit(input.slowMs),
			max_result_rows: String(MAX_CENSUS_ORGANIZATIONS),
		},
		query: `${staleSources(filter)}
			SELECT records.organization_id AS organization_id,
				count() AS sessions,
				countIf(${WANTED}) AS stale,
				countIf(${INDEX_STALE}) AS index_stale,
				countIf(${PARSER_STALE}) AS parser_stale,
				toString(max(records.last_session_date)) AS last_session_at
			FROM records
			LEFT JOIN indexed ON ${JOINED}
			GROUP BY organization_id`,
		query_params: {
			...versionParams(input.reparse),
			organizationIds: input.organizationIds ?? [],
		},
	};
}

export interface HealCursor {
	readonly indexStale: boolean;
	readonly sessionDate: string;
	readonly userId: string;
	readonly sessionId: string;
}

export function buildHealSelectionStatement(input: {
	readonly organizationId: string;
	readonly reparse: boolean;
	readonly slowMs: number;
	readonly limit: number;
	readonly reparseOnly?: boolean;
	readonly after?: HealCursor;
}): ClickHouseStatement {
	const after =
		input.after === undefined
			? ""
			: `AND (toUInt8(${INDEX_STALE}), records.last_session_date, records.user_id, records.session_id) < ({afterIndexStale:UInt8}, parseDateTime64BestEffort({afterSessionDate:String}, 3, 'UTC'), {afterUserId:String}, {afterSessionId:String})`;
	return {
		clickhouse_settings: {
			...RECEIPT_SETTINGS,
			...timeLimit(input.slowMs),
			max_result_rows: String(input.limit),
		},
		query: `${staleSources("AND organization_id = {organizationId:String}")}
			SELECT records.organization_id AS organization_id, records.user_id AS user_id,
				records.session_id AS session_id, records.session_source AS source,
				toString(records.generation.1) AS revision_text, records.generation.2 AS parser_version,
				toString(records.last_session_date) AS session_date,
				multiIf(indexed.present = 0, 'missing',
					tuple(indexed.committed.1, indexed.committed.2) != records.generation, 'generation',
					indexed.committed.3 != {indexVersion:UInt16}, 'index_version',
					indexed.committed.4 != {pricingVersion:String}, 'pricing_version',
					'current') AS reason
			FROM records
			LEFT JOIN indexed ON ${JOINED}
			WHERE ${WANTED} AND ({reparseOnly:UInt8} = 0 OR NOT ${INDEX_STALE}) ${after}
			ORDER BY toUInt8(${INDEX_STALE}) DESC, records.last_session_date DESC, records.user_id DESC, records.session_id DESC
			LIMIT {limit:UInt32}`,
		query_params: {
			...versionParams(input.reparse),
			reparseOnly: input.reparse && input.reparseOnly ? 1 : 0,
			afterIndexStale: input.after?.indexStale ? 1 : 0,
			afterSessionDate: input.after?.sessionDate ?? "",
			afterSessionId: input.after?.sessionId ?? "",
			afterUserId: input.after?.userId ?? "",
			limit: input.limit,
			organizationId: input.organizationId,
		},
	};
}

const CensusRowSchema = z.object({
	organization_id: z.string(),
	sessions: z.coerce.number(),
	stale: z.coerce.number(),
	index_stale: z.coerce.number(),
	parser_stale: z.coerce.number(),
	last_session_at: z.string(),
});

export interface HealCensus {
	readonly ms: number;
	readonly organizations: CensusOrganization[];
}

export async function readHealCensus(
	executor: ClickHouseExecutor,
	input: Parameters<typeof buildHealCensusStatement>[0] & {
		readonly now?: () => number;
		readonly signal?: AbortSignal;
	},
): Promise<HealCensus> {
	const now = input.now ?? Date.now;
	const started = now();
	const rows = z.array(CensusRowSchema).parse(
		await executor.query<unknown>({
			...buildHealCensusStatement(input),
			abortSignal: input.signal,
		}),
	);
	return {
		ms: now() - started,
		organizations: rows.map((row) => ({
			organizationId: row.organization_id,
			sessions: row.sessions,
			stale: row.stale,
			indexStale: row.index_stale,
			parserStale: row.parser_stale,
			lastSessionAt:
				row.last_session_at === "" || row.last_session_at.startsWith("1970-")
					? null
					: row.last_session_at,
		})),
	};
}

const QueueStateRowSchema = z.object({
	pending: z.coerce.number(),
	recent_failures: z.coerce.number(),
});

export async function readQueueState(
	sql: postgres.Sql,
	maxPending: number,
	maxRecentFailures: number,
): Promise<QueueState> {
	const [row] = z.array(QueueStateRowSchema).parse(
		await sql.unsafe(
			`SELECT
				(SELECT count(*) FROM (
					SELECT 1 FROM l1_edge_scope
					WHERE request_count > built_request_count AND next_attempt_at <> 'infinity'
					LIMIT $1
				) AS due) AS pending,
				(SELECT count(*) FROM (
					SELECT 1 FROM l1_edge_scope
					WHERE scope_kind = 'run_index' AND last_error IS NOT NULL
						AND updated_at > now() - $3::bigint * interval '1 millisecond'
					LIMIT $2
				) AS failed) AS recent_failures`,
			[maxPending + 1, maxRecentFailures, RUN_INDEX_HEAL_FAILURE_WINDOW_MS],
		),
	);
	return {
		pending: row?.pending ?? 0,
		recentFailures: row?.recent_failures ?? 0,
	};
}

async function readOrganizationNames(
	sql: postgres.Sql,
	organizationIds: readonly string[],
): Promise<Map<string, string>> {
	if (organizationIds.length === 0) return new Map();
	const rows = await sql.unsafe<{ id: string; name: string }[]>(
		"SELECT id, name FROM organization WHERE id = ANY($1::text[])",
		[[...organizationIds]],
	);
	return new Map(rows.map((row) => [row.id, row.name]));
}

export type ReparseOutcome =
	| "written"
	| "deferred"
	| "failed"
	| "oversized"
	| "missing";

export interface Reparser {
	retire(deadline: MaintenanceDeadline): Promise<number>;
	reparse(
		row: HealRow,
		context: { readonly deadline: MaintenanceDeadline; runBytes: number },
	): Promise<{ outcome: ReparseOutcome; bytes: number }>;
}

export interface RunIndexHealTickResult {
	status: "ran" | "skipped";
	skipped: RunIndexHealSkipReason | null;
	queue: QueueState | null;
	load: number | null;
	censusMs: number | null;
	staleBefore: number | null;
	remaining: number | null;
	queued: number;
	alreadyQueued: number;
	frozen: number;
	reparsed: number;
	reparseOutcomes: Record<ReparseOutcome, number>;
	retiredGenerations: number;
	selections: number;
	organizations: {
		organizationId: string;
		tier: RunIndexHealTier;
		stale: number;
		queued: number;
		reparsed: number;
	}[];
	stoppedEarly:
		| "deadline"
		| "selections"
		| "clickhouse_error"
		| "clickhouse_slow"
		| null;
}

export interface RunIndexHealTickOptions {
	readonly sql: postgres.Sql;
	readonly executor: ClickHouseExecutor;
	readonly config: RunIndexHealConfig;
	readonly deadline: MaintenanceDeadline;
	readonly reparser?: Reparser;
	readonly organizationIds?: readonly string[];
	readonly signal?: AbortSignal;
}

function emptyResult(): RunIndexHealTickResult {
	return {
		status: "skipped",
		skipped: null,
		queue: null,
		load: null,
		censusMs: null,
		staleBefore: null,
		remaining: null,
		queued: 0,
		alreadyQueued: 0,
		frozen: 0,
		reparsed: 0,
		reparseOutcomes: {
			written: 0,
			deferred: 0,
			failed: 0,
			oversized: 0,
			missing: 0,
		},
		retiredGenerations: 0,
		selections: 0,
		organizations: [],
		stoppedEarly: null,
	};
}

export async function runRunIndexHealTick(
	options: RunIndexHealTickOptions,
): Promise<RunIndexHealTickResult> {
	const result = emptyResult();
	const { config, deadline } = options;
	const early = decideHealThrottle(config, null);
	if (early) return skip(result, early);

	result.queue = await readQueueState(
		options.sql,
		config.maxPending,
		config.maxRecentFailures,
	);
	const throttled = decideHealThrottle(config, result.queue);
	if (throttled) return skip(result, throttled);

	try {
		result.load = await readClickHouseLoadAverage(options.executor);
	} catch (error) {
		logger.warn("Run index heal could not read the ClickHouse load: {error}", {
			error: error instanceof Error ? error.message : String(error),
		});
		return skip(result, classifyClickHouseFailure(error));
	}
	if (result.load > config.maxLoad) return skip(result, "clickhouse_slow");

	const reparse = config.reparse && options.reparser !== undefined;
	let census: HealCensus;
	try {
		census = await readHealCensus(options.executor, {
			reparse,
			slowMs: config.slowMs,
			organizationIds: options.organizationIds,
			now: deadline.now,
			signal: options.signal,
		});
	} catch (error) {
		logger.warn("Run index heal census failed: {error}", {
			error: error instanceof Error ? error.message : String(error),
		});
		return skip(result, classifyClickHouseFailure(error));
	}
	result.censusMs = census.ms;
	result.staleBefore = census.organizations.reduce(
		(sum, organization) => sum + organization.stale,
		0,
	);
	if (census.ms > config.slowMs) return skip(result, "clickhouse_slow");
	result.status = "ran";

	const known = new Set(
		(
			await readOrganizationNames(
				options.sql,
				census.organizations.map((organization) => organization.organizationId),
			)
		).keys(),
	);
	const ordered = orderHealOrganizations(
		census.organizations.filter(
			(organization) =>
				organization.stale > 0 && known.has(organization.organizationId),
		),
		config,
	);

	if (reparse && options.reparser) {
		try {
			result.retiredGenerations = await options.reparser.retire(deadline);
		} catch (error) {
			logger.warn("Run index heal retirement pass failed: {error}", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const reparseState = { runBytes: 0 };
	for (const organization of ordered) {
		const wantIndex = config.maxPerTick - result.queued;
		const wantReparse = reparse
			? config.maxReparsePerTick - result.reparsed
			: 0;
		if (wantIndex <= 0 && wantReparse <= 0) break;
		if (!hasTime(deadline)) {
			result.stoppedEarly = "deadline";
			break;
		}
		const entry = {
			organizationId: organization.organizationId,
			tier: organization.tier,
			stale: organization.stale,
			queued: 0,
			reparsed: 0,
		};
		result.organizations.push(entry);
		const stop = await healOrganization(options, {
			organizationId: organization.organizationId,
			reparse,
			result,
			entry,
			reparseState,
		});
		if (stop) {
			result.stoppedEarly = stop;
			break;
		}
		if (result.selections >= MAX_SELECTIONS_PER_TICK) break;
	}
	result.remaining = Math.max(0, result.staleBefore - result.queued);
	return result;
}

async function healOrganization(
	options: RunIndexHealTickOptions,
	input: {
		readonly organizationId: string;
		readonly reparse: boolean;
		readonly result: RunIndexHealTickResult;
		readonly entry: { queued: number; reparsed: number };
		readonly reparseState: { runBytes: number };
	},
): Promise<RunIndexHealTickResult["stoppedEarly"]> {
	const { config, deadline } = options;
	const { result, entry } = input;
	let after: HealCursor | undefined;
	for (let page = 0; page < MAX_PAGES_PER_ORGANIZATION; page++) {
		const wantIndex = config.maxPerTick - result.queued;
		const wantReparse = input.reparse
			? config.maxReparsePerTick - result.reparsed
			: 0;
		if (wantIndex <= 0 && wantReparse <= 0) return null;
		if (!hasTime(deadline)) return "deadline";
		if (result.selections >= MAX_SELECTIONS_PER_TICK) return "selections";
		result.selections++;
		const limit = Math.max(wantIndex, 0) + wantReparse + config.maxPending;
		let rows: HealRow[];
		try {
			rows = z.array(HealRowSchema).parse(
				await options.executor.query<unknown>({
					...buildHealSelectionStatement({
						organizationId: input.organizationId,
						reparse: input.reparse,
						slowMs: config.slowMs,
						limit,
						reparseOnly: wantIndex <= 0,
						after,
					}),
					abortSignal: options.signal,
				}),
			);
		} catch (error) {
			logger.warn(
				"Run index heal selection failed for organization {organizationId}: {error}",
				{
					organizationId: input.organizationId,
					error: error instanceof Error ? error.message : String(error),
				},
			);
			return classifyClickHouseFailure(error);
		}
		const plan = planHealRows(rows, {
			reparse: input.reparse,
			maxReparse: Math.max(wantReparse, 0),
		});
		for (const row of plan.reparse) {
			if (!hasTime(deadline)) return "deadline";
			const done = await options.reparser?.reparse(row, {
				deadline,
				runBytes: input.reparseState.runBytes,
			});
			if (!done) continue;
			input.reparseState.runBytes += done.bytes;
			result.reparseOutcomes[done.outcome]++;
			if (done.outcome === "written") {
				result.reparsed++;
				entry.reparsed++;
			}
		}
		if (wantIndex > 0 && plan.index.length > 0) {
			const wanted = await selectQueueable(
				options.sql,
				input.organizationId,
				plan.index,
			);
			result.alreadyQueued += wanted.alreadyQueued;
			result.frozen += wanted.frozen;
			const sessions = wanted.sessions.slice(0, wantIndex);
			const queued = await enqueueL1EdgeSessionScopes(
				options.sql,
				"run_index",
				input.organizationId,
				sessions.map((row) => ({
					userId: row.user_id,
					source: row.source,
					sessionId: row.session_id,
				})),
				{ priority: 1 },
			);
			result.queued += queued;
			entry.queued += queued;
		}
		const last = rows.at(-1);
		if (rows.length < limit || last === undefined) return null;
		after = {
			indexStale: last.reason !== "current",
			sessionDate: last.session_date,
			userId: last.user_id,
			sessionId: last.session_id,
		};
	}
	return null;
}

function hasTime(deadline: MaintenanceDeadline): boolean {
	return deadline.deadlineAt - deadline.now() >= MIN_REMAINING_MS;
}

function skip(
	result: RunIndexHealTickResult,
	reason: RunIndexHealSkipReason,
): RunIndexHealTickResult {
	result.status = "skipped";
	result.skipped = reason;
	return result;
}

export function logRunIndexHealTick(result: RunIndexHealTickResult): void {
	const fields = {
		status: result.status,
		skipped: result.skipped,
		queued: result.queued,
		reparsed: result.reparsed,
		alreadyQueued: result.alreadyQueued,
		frozen: result.frozen,
		staleBefore: result.staleBefore,
		remaining: result.remaining,
		pending: result.queue?.pending ?? null,
		recentFailures: result.queue?.recentFailures ?? null,
		load: result.load,
		censusMs: result.censusMs,
		retiredGenerations: result.retiredGenerations,
		stoppedEarly: result.stoppedEarly,
		organizations: result.organizations.length,
	};
	if (result.status === "skipped")
		logger.info(
			"Run index heal tick skipped ({skipped}): pending={pending} recentFailures={recentFailures} load={load} stale={staleBefore}",
			fields,
		);
	else
		logger.info(
			"Run index heal tick: queued={queued} reparsed={reparsed} remaining={remaining} of {staleBefore} stale",
			fields,
		);
}

export async function readRunIndexHealStatus(options: {
	readonly sql: postgres.Sql;
	readonly executor: ClickHouseExecutor;
	readonly config: RunIndexHealConfig;
	readonly now?: () => number;
}): Promise<RunIndexHealStatus> {
	const { config } = options;
	const now = options.now ?? Date.now;
	const queue = await readQueueState(
		options.sql,
		config.maxPending,
		config.maxRecentFailures,
	);
	const base = {
		generatedAt: new Date(now()).toISOString(),
		versions: {
			runIndex: RUN_INDEX_VERSION,
			runIndexPricing: RUN_INDEX_PRICING_VERSION,
			transcriptParser: TRANSCRIPT_RECORDS_PARSER_VERSION,
		},
		config: {
			enabled: config.enabled,
			workerEnabled: config.workerEnabled,
			reparse: config.reparse,
			maxPerTick: config.maxPerTick,
			maxReparsePerTick: config.maxReparsePerTick,
			maxPending: config.maxPending,
			maxRecentFailures: config.maxRecentFailures,
			slowMs: config.slowMs,
			maxLoad: config.maxLoad,
			deprioritizedOrganizationIds: [...config.deprioritizedOrganizationIds],
		},
		queue,
		nextTick: { skipped: decideHealThrottle(config, queue) },
	};
	let census: HealCensus;
	try {
		census = await readHealCensus(options.executor, {
			reparse: config.reparse,
			slowMs: config.slowMs,
			now,
		});
	} catch (error) {
		return {
			...base,
			census: {
				error: error instanceof Error ? error.message : String(error),
			},
		};
	}
	const names = await readOrganizationNames(
		options.sql,
		census.organizations.map((organization) => organization.organizationId),
	);
	const organizations: RunIndexHealOrganization[] = orderHealOrganizations(
		census.organizations,
		config,
	).map((organization) => ({
		...organization,
		name: names.get(organization.organizationId) ?? null,
	}));
	const totals = census.organizations.reduce(
		(sum, organization) => ({
			sessions: sum.sessions + organization.sessions,
			stale: sum.stale + organization.stale,
			indexStale: sum.indexStale + organization.indexStale,
			parserStale: sum.parserStale + organization.parserStale,
		}),
		{ sessions: 0, stale: 0, indexStale: 0, parserStale: 0 },
	);
	return { ...base, census: { ms: census.ms, totals, organizations } };
}

export function skippedRunIndexHealTick(
	reason: RunIndexHealSkipReason,
): RunIndexHealTickResult {
	return skip(emptyResult(), reason);
}
