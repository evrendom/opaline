import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import {
	pinnedParams,
	pinnedRows,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../transcript-generations/generations.js";
import { committedBuildSql } from "./run-index-reader.js";
import {
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
} from "./run-index-sql.js";
import { queryRunFacts, type RunRow, RunRowSchema } from "./run-queries.js";
import { ANALYSIS_QUERY_SETTINGS } from "./sql.js";

export interface RunFactsBatch {
	readonly scope: TranscriptReadScope;
	readonly generations: readonly SessionGeneration[];
}

export interface LoadedRunFacts {
	readonly rows: RunRow[][];
	readonly indexedSessions: number;
	readonly computedSessions: number;
}

const INDEX_READ_SESSIONS = 1_000;

const IndexedRowSchema = z.object({
	row_kind: z.string(),
	session_id: z.string(),
	session_unattributed: z.coerce.number(),
	session_unattributed_models: z.array(z.tuple([z.string(), z.number()])),
});

export function buildIndexedRunFactsStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): ClickHouseStatement {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = `organization_id = {organizationId:String} AND user_id = {userId:String}
				AND session_id IN {sessionIds:Array(String)}`;
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT toString(row_kind) AS row_kind, session_id, agent_id, turn_idx, start_record AS first_record,
				toUnixTimestamp64Milli(started_at) AS started_ms, minutes, active_minutes, toString(raw_chars) AS raw_chars,
				genuine_prompts AS genuine_prompt, ifNull(prompt_head, '') AS prompt_head, edits, tool_calls, failed_calls,
				reads AS read_calls, searches AS search_calls, ifNull(not_found, 0) AS not_found,
				toString(source) AS run_source, parser_version AS run_parser_version, cost_usd AS cost,
				usage_unpriced AS unpriced_observations, toString(usage_model) AS usage_model, model_costs,
				ifNull(cost_usd, 0) AS session_unattributed,
				arrayMap(m -> (m.1, ifNull(m.2, 0)), model_costs) AS session_unattributed_models
			FROM ${table} FINAL
			WHERE ${pinnedRows()}
				AND index_version = {indexVersion:UInt16} AND pricing_version = {pricingVersion:String}
				AND ${committedBuildSql(table, owner, ["session_id"])}
			ORDER BY session_id, agent_id, first_record`,
		query_params: {
			...pinnedParams(scope, generations),
			indexVersion: RUN_INDEX_VERSION,
			pricingVersion: RUN_INDEX_PRICING_VERSION,
		},
	};
}

export async function readIndexedRunFacts(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): Promise<Map<string, RunRow[]>> {
	const bySession = new Map<string, RunRow[]>();
	const rows = await executor.query<Record<string, unknown>>(
		buildIndexedRunFactsStatement(scope, generations),
	);
	const parsed = rows.map((row) => ({
		row,
		indexed: IndexedRowSchema.parse(row),
	}));
	const receipts = new Map(
		parsed
			.filter(({ indexed }) => indexed.row_kind === "receipt")
			.map(({ indexed }) => [indexed.session_id, indexed]),
	);
	for (const sessionId of receipts.keys()) bySession.set(sessionId, []);
	for (const { row, indexed } of parsed) {
		const receipt = receipts.get(indexed.session_id);
		if (indexed.row_kind !== "run" || !receipt) continue;
		bySession.get(indexed.session_id)?.push(
			RunRowSchema.parse({
				...row,
				session_unattributed: receipt.session_unattributed,
				session_unattributed_models: receipt.session_unattributed_models,
			}),
		);
	}
	return bySession;
}

export const COMPUTED_RUNS_TTL_MS = 5 * 60_000;
export const COMPUTED_RUNS_MAX = 50_000;

export class ComputedRunFacts {
	readonly #entries = new Map<string, { at: number; rows: RunRow[] }>();
	#runs = 0;

	constructor(
		readonly ttlMs = COMPUTED_RUNS_TTL_MS,
		readonly maxRuns = COMPUTED_RUNS_MAX,
		readonly now: () => number = Date.now,
	) {}

	get size(): number {
		return this.#entries.size;
	}

	get(key: string): RunRow[] | undefined {
		const entry = this.#entries.get(key);
		if (!entry) return undefined;
		if (this.now() - entry.at < this.ttlMs) return entry.rows;
		this.#drop(key);
		return undefined;
	}

	set(key: string, rows: RunRow[]): void {
		this.#drop(key);
		if (rows.length > this.maxRuns) return;
		this.#entries.set(key, { at: this.now(), rows });
		this.#runs += rows.length;
		for (const oldest of this.#entries.keys()) {
			if (this.#runs <= this.maxRuns) break;
			this.#drop(oldest);
		}
	}

	#drop(key: string): void {
		const entry = this.#entries.get(key);
		if (!entry) return;
		this.#entries.delete(key);
		this.#runs -= entry.rows.length;
	}
}

const computedByExecutor = new WeakMap<ClickHouseExecutor, ComputedRunFacts>();

export function computedRunFactsOf(
	executor: ClickHouseExecutor,
): ComputedRunFacts {
	let computed = computedByExecutor.get(executor);
	if (!computed) {
		computed = new ComputedRunFacts();
		computedByExecutor.set(executor, computed);
	}
	return computed;
}

export function computedRunKey(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
): string {
	return [
		scope.organizationId,
		scope.userId,
		generation.sessionId,
		generation.revision,
		generation.parserVersion,
	].join("\u0000");
}

async function computeRunFacts(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	computed: ComputedRunFacts | undefined,
): Promise<RunRow[]> {
	if (!computed)
		return generations.length
			? queryRunFacts(executor, scope, generations)
			: [];
	const known: RunRow[] = [];
	const unknown: SessionGeneration[] = [];
	for (const generation of generations) {
		const rows = computed.get(computedRunKey(scope, generation));
		if (rows) known.push(...rows);
		else unknown.push(generation);
	}
	if (unknown.length === 0) return known;
	const fresh = await queryRunFacts(executor, scope, unknown);
	const bySession = new Map<string, RunRow[]>(
		unknown.map((generation) => [generation.sessionId, []]),
	);
	for (const row of fresh) bySession.get(row.session_id)?.push(row);
	for (const generation of unknown)
		computed.set(
			computedRunKey(scope, generation),
			bySession.get(generation.sessionId) ?? [],
		);
	return [...known, ...fresh];
}

export async function loadRunFacts(
	executor: ClickHouseExecutor,
	batches: readonly RunFactsBatch[],
	computed?: ComputedRunFacts,
): Promise<LoadedRunFacts> {
	const indexed = new Map<string, RunRow[]>();
	const byOwner = new Map<string, RunFactsBatch[]>();
	for (const batch of batches)
		byOwner.set(batch.scope.userId, [
			...(byOwner.get(batch.scope.userId) ?? []),
			batch,
		]);
	for (const owned of byOwner.values()) {
		const scope = owned[0]?.scope;
		if (!scope) continue;
		const generations = owned.flatMap((batch) => batch.generations);
		for (let at = 0; at < generations.length; at += INDEX_READ_SESSIONS)
			for (const [session, rows] of await readIndexedRunFacts(
				executor,
				scope,
				generations.slice(at, at + INDEX_READ_SESSIONS),
			))
				indexed.set(`${scope.userId}\u0000${session}`, rows);
	}
	let indexedSessions = 0;
	let computedSessions = 0;
	const rows: RunRow[][] = [];
	for (const batch of batches) {
		const key = (sessionId: string) =>
			`${batch.scope.userId}\u0000${sessionId}`;
		const missing = batch.generations.filter(
			(generation) => !indexed.has(key(generation.sessionId)),
		);
		indexedSessions += batch.generations.length - missing.length;
		computedSessions += missing.length;
		const live = await computeRunFacts(
			executor,
			batch.scope,
			missing,
			computed,
		);
		const order = new Map(
			batch.generations.map((generation, index) => [
				generation.sessionId,
				index,
			]),
		);
		rows.push(
			[
				...batch.generations.flatMap(
					(generation) => indexed.get(key(generation.sessionId)) ?? [],
				),
				...live,
			].sort(
				(left, right) =>
					(order.get(left.session_id) ?? 0) -
						(order.get(right.session_id) ?? 0) ||
					left.agent_id.localeCompare(right.agent_id) ||
					left.first_record - right.first_record,
			),
		);
	}
	return { rows, indexedSessions, computedSessions };
}
