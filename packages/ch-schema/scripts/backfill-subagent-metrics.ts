#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveClickHouseUsername } from "../src/clickhouse-connection.js";
import { withMvSourcePredicate } from "../src/mv-session-filter.js";
import { CLAUDE_SESSION_ANALYTICS_MV_SQL } from "../src/mv-sql/claude-session-analytics.js";
import { CODEX_SESSION_ANALYTICS_MV_SQL } from "../src/mv-sql/codex-session-analytics.js";
import { buildCanonicalRevisionDigestSql } from "../src/subagent-metrics-backfill.js";

const FUTURE_TOLERANCE_MS = 60_000;
const MAX_PREFLOOR_PASSES = 5;
// The 30-minute default assumes a fast cluster; a memory-bounded single-thread
// full-history pass on the production node legitimately runs longer. Operators
// must raise the deadline explicitly — never silently.
const MAX_PREFLOOR_DURATION_MS = (() => {
	const raw = process.env.SUBAGENT_BACKFILL_MAX_DURATION_MS;
	if (raw === undefined || raw.trim() === "") return 30 * 60_000;
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(
			"SUBAGENT_BACKFILL_MAX_DURATION_MS must be a positive integer of milliseconds",
		);
	}
	return parsed;
})();
const BATCH_SIZE = 100;
const DEFAULT_JOURNAL_PATH = resolve(
	import.meta.dir,
	"../../..",
	".context/subagent-metrics-backfill-journal.json",
);

const TARGET_COLUMNS = [
	"session_date",
	"last_interaction_date",
	"session_id",
	"organization_id",
	"project_path",
	"git_remote",
	"package_name",
	"package_type",
	"filter_version",
	"ingested_at",
	"user_id",
	"git_branch",
	"git_sha",
	"tag",
	"source",
	"skills",
	"slash_commands",
	"subagent_types",
	"subagent_count",
	"native_subagents",
	"input_tokens",
	"output_tokens",
	"cache_read_input_tokens",
	"cache_creation_input_tokens",
	"total_tokens",
	"total_interactions",
	"actual_duration_min",
	"avg_period_sec",
	"median_period_sec",
	"quick_responses",
	"normal_responses",
	"long_pauses",
	"error_count",
	"error_pattern",
	"model_used",
	"has_commit",
	"session_archetype",
	"success_score",
	"used_plan_mode",
	"inference_duration_sec",
	"human_duration_sec",
] as const;

type Source = "claude_code" | "codex";
type EpochName = "c0" | "c1" | "c2";

export interface CensusRow {
	readonly digest: string;
	readonly ingested_at_ms: string;
	readonly month: string;
	readonly organization_id: string;
	readonly session_date_ms: string;
	readonly session_id: string;
	readonly source: Source;
	readonly user_id: string;
}

export interface Epochs {
	readonly c0: number;
	readonly c1: number;
	readonly c2: number;
	readonly floor: number;
	readonly s: number;
}

interface Journal {
	barrierCompletedAt?: string;
	driftVerifiedAt?: string;
	epochs: Epochs;
	equalVersionCollisionCount: number;
	prefloorCompletedAt: string;
	residualDriftCount?: number;
	usedEpochs: EpochName[];
	version: 1;
}

interface MaximumRow {
	readonly max_ms: string;
	readonly relation: string;
}

export interface ClickHouseConnection {
	readonly database: string;
	readonly password: string;
	readonly url: string;
	readonly username: string;
}

interface CliOptions {
	readonly fleetVerified: boolean;
	readonly healthUrls: readonly string[];
	readonly journalPath: string;
	readonly phase:
		| "barrier"
		| "c0"
		| "c1"
		| "c2"
		| "coverage"
		| "drift"
		| "prefloor"
		| "status";
}

async function main(): Promise<void> {
	const options = parseCliOptions(process.argv.slice(2));
	if (options.phase === "status") {
		console.log(
			JSON.stringify(await readJournal(options.journalPath), null, 2),
		);
		return;
	}

	const connection = readConnection();
	if (options.phase === "coverage") {
		console.log(JSON.stringify(await readClaudeCoverage(connection), null, 2));
		return;
	}
	if (options.phase === "prefloor") {
		await runPrefloor(connection, options.journalPath);
		return;
	}
	if (options.phase === "barrier") {
		await runBarrier(connection, options);
		return;
	}
	if (options.phase === "drift") {
		await runDriftVerification(connection, options.journalPath);
		return;
	}

	await runCorrection(connection, options.journalPath, options.phase);
}

async function runPrefloor(
	connection: ClickHouseConnection,
	journalPath: string,
): Promise<void> {
	if (await journalExists(journalPath)) {
		throw new Error(
			`Backfill journal already exists at ${journalPath}; refusing to mint a second epoch ladder`,
		);
	}

	const startedAt = Date.now();
	let previousStamp = 0;
	let previousCensus: CensusRow[] | undefined;
	let residual: CensusRow[] = [];
	for (let pass = 1; pass <= MAX_PREFLOOR_PASSES; pass += 1) {
		if (Date.now() - startedAt > MAX_PREFLOOR_DURATION_MS) {
			throw nonConvergedError(residual, "30-minute deadline exceeded");
		}

		const maxima = await assertTimestampPreflight(connection);
		const cutoffMs = Date.now() + FUTURE_TOLERANCE_MS;
		const census = await readGlobalCensus(connection, cutoffMs);
		const stamp =
			Math.max(
				previousStamp,
				...maxima.map((row) => Number(row.max_ms)),
				...census.map((row) => Number(row.ingested_at_ms)),
			) + 1;
		await backfillCensus(connection, census, stamp);

		const nextCensus = await readGlobalCensus(
			connection,
			Date.now() + FUTURE_TOLERANCE_MS,
		);
		residual = changedCensusRows(census, nextCensus);
		console.log(
			`[subagent-backfill] pre-floor pass=${pass} rows=${census.length} stamp=${stamp} changed_after_pass=${residual.length}`,
		);
		previousStamp = stamp;
		previousCensus = nextCensus;
		if (residual.length === 0) break;
		if (pass === MAX_PREFLOOR_PASSES) {
			throw nonConvergedError(residual, "five-pass limit exceeded");
		}
	}

	if (!previousCensus) {
		throw new Error("Pre-floor census did not run");
	}
	const epochs = buildEpochs(previousStamp);
	if (epochs.floor > Date.now() + FUTURE_TOLERANCE_MS) {
		throw new Error(
			`Computed floor ${epochs.floor} is more than 60 seconds in the future; wait and rerun prefloor`,
		);
	}
	const collisionCount = await readEqualVersionCollisionCount(connection);
	await writeJournal(journalPath, {
		epochs,
		equalVersionCollisionCount: collisionCount,
		prefloorCompletedAt: new Date().toISOString(),
		usedEpochs: [],
		version: 1,
	});
	console.log(
		`[subagent-backfill] converged fingerprint=${censusFingerprint(previousCensus)} collisions=${collisionCount}`,
	);
	console.log(`INGESTED_AT_FLOOR_MS=${epochs.floor}`);
}

async function runBarrier(
	connection: ClickHouseConnection,
	options: CliOptions,
): Promise<void> {
	if (!options.fleetVerified) {
		throw new Error(
			"Barrier requires --fleet-verified after confirming every old machine is gone",
		);
	}
	if (options.healthUrls.length === 0) {
		throw new Error("Barrier requires at least one --health-url");
	}
	const journal = await readJournal(options.journalPath);
	for (const healthUrl of options.healthUrls) {
		await assertHealthFloor(healthUrl, journal.epochs.floor);
	}

	const settings = await queryJson<{ value: string }>(
		connection,
		"SELECT value FROM system.settings WHERE name = 'async_insert_busy_timeout_max_ms'",
	);
	const busyTimeoutMs = Number(settings[0]?.value);
	if (!Number.isFinite(busyTimeoutMs) || busyTimeoutMs < 0) {
		throw new Error(
			"Target did not expose async_insert_busy_timeout_max_ms; barrier cannot assume a timeout",
		);
	}
	const marginMs = Math.ceil(busyTimeoutMs) + 1_000;
	console.log(`[subagent-backfill] waiting async-insert margin ${marginMs}ms`);
	await Bun.sleep(marginMs);
	await execute(connection, "SYSTEM FLUSH ASYNC INSERT QUEUE").catch(
		(error: unknown) => {
			console.warn(
				`[subagent-backfill] best-effort async queue flush failed: ${String(error)}`,
			);
		},
	);
	await assertTimestampPreflight(connection);
	journal.barrierCompletedAt = new Date().toISOString();
	await writeJournal(options.journalPath, journal);
	console.log("[subagent-backfill] barrier recorded; terminal C0 may run");
}

async function runCorrection(
	connection: ClickHouseConnection,
	journalPath: string,
	epochName: EpochName,
): Promise<void> {
	const journal = await readJournal(journalPath);
	if (!journal.barrierCompletedAt) {
		throw new Error("Correction refused until the barrier phase completes");
	}
	const requiredPrevious =
		epochName === "c1" ? "c0" : epochName === "c2" ? "c1" : undefined;
	if (requiredPrevious && !journal.usedEpochs.includes(requiredPrevious)) {
		throw new Error(
			`${epochName.toUpperCase()} requires ${requiredPrevious.toUpperCase()} first`,
		);
	}
	if (journal.usedEpochs.includes(epochName)) {
		throw new Error(
			`${epochName.toUpperCase()} was already used; epoch reuse is forbidden`,
		);
	}

	await assertTimestampPreflight(connection);
	journal.usedEpochs.push(epochName);
	await writeJournal(journalPath, journal);
	const census = await readGlobalCensus(
		connection,
		Date.now() + FUTURE_TOLERANCE_MS,
	);
	await backfillCensus(connection, census, journal.epochs[epochName]);
	const collisions = await readEqualVersionCollisionCount(connection);
	journal.equalVersionCollisionCount = Math.max(
		journal.equalVersionCollisionCount,
		collisions,
	);
	await writeJournal(journalPath, journal);
	console.log(
		`[subagent-backfill] ${epochName.toUpperCase()} complete rows=${census.length} stamp=${journal.epochs[epochName]} collisions=${collisions}`,
	);
}

async function runDriftVerification(
	connection: ClickHouseConnection,
	journalPath: string,
): Promise<void> {
	const journal = await readJournal(journalPath);
	if (!journal.usedEpochs.includes("c2")) {
		throw new Error("Drift verification requires C2 first");
	}
	await assertTimestampPreflight(connection);
	const census = await readGlobalCensus(
		connection,
		Date.now() + FUTURE_TOLERANCE_MS,
	);
	const residualDriftCount = await readSubagentDriftCount(connection, census);
	const collisions = await readEqualVersionCollisionCount(connection);
	journal.equalVersionCollisionCount = Math.max(
		journal.equalVersionCollisionCount,
		collisions,
	);
	journal.residualDriftCount = residualDriftCount;
	if (residualDriftCount === 0) {
		journal.driftVerifiedAt = new Date().toISOString();
	} else {
		delete journal.driftVerifiedAt;
	}
	await writeJournal(journalPath, journal);
	console.log(
		`[subagent-backfill] drift rows=${residualDriftCount} collisions=${collisions}`,
	);
	if (residualDriftCount > 0) {
		throw new Error(
			`DRIFT VERIFICATION FAILED: ${residualDriftCount} session analytics rows differ from the current raw census`,
		);
	}
}

export async function backfillCensus(
	connection: ClickHouseConnection,
	census: readonly CensusRow[],
	stampMs: number,
): Promise<void> {
	const groups = new Map<string, CensusRow[]>();
	for (const row of census) {
		const key = `${row.source}:${row.month}`;
		const group = groups.get(key) ?? [];
		group.push(row);
		groups.set(key, group);
	}

	for (const [groupKey, rows] of [...groups.entries()].sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
			const batch = rows.slice(offset, offset + BATCH_SIZE);
			const filteredMv = buildFilteredMvSql(batch);
			const columns = TARGET_COLUMNS.map((column) => `\`${column}\``).join(
				", ",
			);
			const selected = TARGET_COLUMNS.map((column) =>
				column === "ingested_at"
					? `${dateTime64Literal(stampMs)} AS \`ingested_at\``
					: `analytics.\`${column}\``,
			).join(", ");
			await execute(
				connection,
				`INSERT INTO rudel.session_analytics (${columns}) SELECT ${selected} FROM (${filteredMv}) AS analytics SETTINGS async_insert = 0`,
			);
			await verifyBatch(connection, batch, filteredMv, stampMs);
			console.log(
				`[subagent-backfill] batch=${groupKey} offset=${offset} rows=${batch.length}`,
			);
		}
	}
}

export function buildFilteredMvSql(rows: readonly CensusRow[]): string {
	const source = rows[0]?.source;
	if (!source || rows.some((row) => row.source !== source)) {
		throw new Error("Backfill batch must contain exactly one source");
	}
	const digestSql = buildCanonicalRevisionDigestSql(
		"cs",
		source === "claude_code",
	);
	const predicate = rows
		.map(
			(row) =>
				`(cs.organization_id = base64Decode('${base64(row.organization_id)}')` +
				` AND cs.user_id = base64Decode('${base64(row.user_id)}')` +
				` AND cs.session_id = base64Decode('${base64(row.session_id)}')` +
				` AND toUnixTimestamp64Milli(cs.session_date) = ${safeInteger(row.session_date_ms)}` +
				` AND toUnixTimestamp64Milli(cs.ingested_at) = ${safeInteger(row.ingested_at_ms)}` +
				` AND ${digestSql} = '${safeDigest(row.digest)}')`,
		)
		.join(" OR ");
	return withMvSourcePredicate(
		source === "codex"
			? CODEX_SESSION_ANALYTICS_MV_SQL
			: CLAUDE_SESSION_ANALYTICS_MV_SQL,
		predicate,
	);
}

async function verifyBatch(
	connection: ClickHouseConnection,
	rows: readonly CensusRow[],
	filteredMv: string,
	stampMs: number,
): Promise<void> {
	const identityPredicate = targetIdentityPredicate(rows);
	// Even with sequential consistency requested, give shared-storage metadata
	// a bounded window to converge before declaring the batch lost.
	let violations = 0;
	for (let attempt = 0; attempt < 4; attempt++) {
		if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * attempt));
		const result = await queryJson<{ violations: string }>(
			connection,
			`WITH expected AS (${filteredMv}), actual AS (
				SELECT source, organization_id, user_id, session_id, ingested_at, subagent_count, subagent_types, native_subagents
				FROM rudel.session_analytics FINAL WHERE ${identityPredicate}
			)
			SELECT count() AS violations FROM expected
			LEFT JOIN actual USING (source, organization_id, user_id, session_id)
			WHERE toUnixTimestamp64Milli(actual.ingested_at) < ${stampMs}
				OR (toUnixTimestamp64Milli(actual.ingested_at) = ${stampMs}
					AND (actual.subagent_count != expected.subagent_count
						OR actual.subagent_types != expected.subagent_types
						OR actual.native_subagents != expected.native_subagents))`,
		);
		violations = Number(result[0]?.violations ?? 0);
		if (violations === 0) return;
	}
	throw new Error(
		`Per-batch verification failed with ${violations} violations`,
	);
}

export async function readSubagentDriftCount(
	connection: ClickHouseConnection,
	census: readonly CensusRow[],
): Promise<number> {
	let violations = 0;
	const groups = new Map<string, CensusRow[]>();
	for (const row of census) {
		const key = `${row.source}:${row.month}`;
		const group = groups.get(key) ?? [];
		group.push(row);
		groups.set(key, group);
	}
	for (const rows of groups.values()) {
		for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
			const batch = rows.slice(offset, offset + BATCH_SIZE);
			const expected = buildFilteredMvSql(batch);
			const actualPredicate = targetIdentityPredicate(batch);
			const result = await queryJson<{ violations: string }>(
				connection,
				`WITH expected AS (${expected}), actual AS (
					SELECT source, organization_id, user_id, session_id, subagent_count,
						subagent_types, native_subagents, toUInt8(1) AS present
					FROM rudel.session_analytics FINAL WHERE ${actualPredicate}
				)
				SELECT count() AS violations FROM expected
				LEFT JOIN actual USING (source, organization_id, user_id, session_id)
				WHERE actual.present = 0
					OR actual.subagent_count != expected.subagent_count
					OR actual.subagent_types != expected.subagent_types
					OR actual.native_subagents != expected.native_subagents`,
			);
			violations += Number(result[0]?.violations ?? 0);
		}
	}
	return violations;
}

async function readGlobalCensus(
	connection: ClickHouseConnection,
	cutoffMs: number,
): Promise<CensusRow[]> {
	const [claude, codex] = await Promise.all([
		readSourceCensus(connection, "claude_code", cutoffMs),
		readSourceCensus(connection, "codex", cutoffMs),
	]);
	return [...claude, ...codex].sort(compareCensusRows);
}

export async function readSourceCensus(
	connection: ClickHouseConnection,
	source: Source,
	cutoffMs: number,
	organizationId?: string,
): Promise<CensusRow[]> {
	const table = source === "codex" ? "codex_sessions" : "claude_sessions";
	const digestSql = buildCanonicalRevisionDigestSql(
		"cs",
		source === "claude_code",
	);
	const organizationFilter = organizationId
		? ` AND cs.organization_id = base64Decode('${base64(organizationId)}')`
		: "";
	// Streaming aggregation is the only query shape that survived the
	// production node's ~5.4 GiB ceiling: no window, no join, no sort — each
	// block's digests are computed and immediately folded into per-identity
	// argMax state (one small tuple per identity). The argMax comparator
	// tuple(ingested_at, digest) implements the tie-break contract directly:
	// highest version wins, equal versions fall to the maximum canonical
	// digest.
	return queryJson<CensusRow>(
		connection,
		`SELECT '${source}' AS source, organization_id, user_id, session_id,
			toString(toUnixTimestamp64Milli(tupleElement(top_revision, 1))) AS session_date_ms,
			toString(toUnixTimestamp64Milli(tupleElement(top_revision, 2))) AS ingested_at_ms,
			tupleElement(top_revision, 3) AS digest,
			toString(toYYYYMM(tupleElement(top_revision, 1))) AS month
		FROM (
			SELECT cs.organization_id AS organization_id, cs.user_id AS user_id,
				cs.session_id AS session_id,
				argMax(
					tuple(cs.session_date, cs.ingested_at, ${digestSql}),
					tuple(cs.ingested_at, ${digestSql})
				) AS top_revision
			FROM rudel.${table} AS cs
			WHERE toUnixTimestamp64Milli(cs.ingested_at) <= ${cutoffMs}${organizationFilter}
			GROUP BY organization_id, user_id, session_id
		)
		ORDER BY organization_id, user_id, session_id`,
	);
}

async function assertTimestampPreflight(
	connection: ClickHouseConnection,
): Promise<MaximumRow[]> {
	const maxima = await queryJson<MaximumRow>(
		connection,
		`SELECT relation, toString(max_ms) AS max_ms FROM (
			SELECT 'claude_sessions' AS relation, toUnixTimestamp64Milli(max(ingested_at)) AS max_ms FROM rudel.claude_sessions
			UNION ALL
			SELECT 'codex_sessions' AS relation, toUnixTimestamp64Milli(max(ingested_at)) AS max_ms FROM rudel.codex_sessions
			UNION ALL
			SELECT 'session_analytics' AS relation, toUnixTimestamp64Milli(max(ingested_at)) AS max_ms FROM rudel.session_analytics
		)`,
	);
	const ceiling = Date.now() + FUTURE_TOLERANCE_MS;
	const offenders = maxima.filter((row) => Number(row.max_ms) > ceiling);
	if (offenders.length > 0) {
		throw new Error(
			`Timestamp preflight found values beyond now + 60s: ${offenders.map((row) => `${row.relation}=${row.max_ms}`).join(", ")}`,
		);
	}
	return maxima;
}

async function readEqualVersionCollisionCount(
	connection: ClickHouseConnection,
): Promise<number> {
	const queries = (["claude_code", "codex"] as const).map((source) => {
		const table = source === "codex" ? "codex_sessions" : "claude_sessions";
		const digest = buildCanonicalRevisionDigestSql(
			"cs",
			source === "claude_code",
		);
		return `SELECT organization_id, user_id, session_id, ingested_at
			FROM rudel.${table} AS cs GROUP BY organization_id, user_id, session_id, ingested_at
			HAVING uniqExact(${digest}) > 1`;
	});
	const result = await queryJson<{ collisions: string }>(
		connection,
		`SELECT count() AS collisions FROM (${queries.join(" UNION ALL ")})`,
	);
	return Number(result[0]?.collisions ?? 0);
}

async function readClaudeCoverage(connection: ClickHouseConnection) {
	// Streaming argMax keeps only two booleans of state per identity, so the
	// scan stays inside the production node's memory ceiling. Coverage is a
	// disclosure report, not a persisted metric, so equal-version ties may
	// resolve by version alone here (no digest tie-break).
	const rows = await queryJson<{
		delegating_sessions: string;
		mapless_delegating_sessions: string;
	}>(
		connection,
		`SELECT countIf(is_delegating) AS delegating_sessions,
			countIf(is_delegating AND is_mapless) AS mapless_delegating_sessions
		FROM (
			SELECT argMax(position(content, '"name":"Task"') > 0, ingested_at) AS is_delegating,
				argMax(length(subagents) = 0, ingested_at) AS is_mapless
			FROM rudel.claude_sessions
			GROUP BY organization_id, user_id, session_id
		)`,
	);
	const denominator = Number(rows[0]?.delegating_sessions ?? 0);
	const numerator = Number(rows[0]?.mapless_delegating_sessions ?? 0);
	return {
		delegatingSessions: denominator,
		maplessDelegatingSessions: numerator,
		maplessRate: denominator === 0 ? 0 : numerator / denominator,
	};
}

function targetIdentityPredicate(rows: readonly CensusRow[]): string {
	return rows
		.map(
			(row) =>
				`(source = '${row.source}'` +
				` AND organization_id = base64Decode('${base64(row.organization_id)}')` +
				` AND user_id = base64Decode('${base64(row.user_id)}')` +
				` AND session_id = base64Decode('${base64(row.session_id)}'))`,
		)
		.join(" OR ");
}

export function buildEpochs(s: number): Epochs {
	return { c0: s + 1, c1: s + 2, c2: s + 3, floor: s + 4, s };
}

export function changedCensusRows(
	before: readonly CensusRow[],
	after: readonly CensusRow[],
): CensusRow[] {
	const beforeRows = new Map(
		before.map((row) => [censusIdentity(row), censusRevision(row)]),
	);
	const afterRows = new Map(
		after.map((row) => [censusIdentity(row), censusRevision(row)]),
	);
	const changedOrAdded = after.filter(
		(row) => beforeRows.get(censusIdentity(row)) !== censusRevision(row),
	);
	const removed = before.filter((row) => !afterRows.has(censusIdentity(row)));
	return [...changedOrAdded, ...removed].sort(compareCensusRows);
}

function censusFingerprint(rows: readonly CensusRow[]): string {
	const hash = createHash("sha256");
	for (const row of [...rows].sort(compareCensusRows)) {
		const value = `${censusIdentity(row)}\u0000${censusRevision(row)}`;
		hash.update(`${Buffer.byteLength(value, "utf8")}:`);
		hash.update(value, "utf8");
	}
	return hash.digest("hex");
}

function censusIdentity(row: CensusRow): string {
	return `${row.source}\u0000${row.organization_id}\u0000${row.user_id}\u0000${row.session_id}`;
}

function censusRevision(row: CensusRow): string {
	return `${row.session_date_ms}\u0000${row.ingested_at_ms}\u0000${row.digest}`;
}

function compareCensusRows(left: CensusRow, right: CensusRow): number {
	return censusIdentity(left).localeCompare(censusIdentity(right));
}

function nonConvergedError(rows: readonly CensusRow[], reason: string): Error {
	return new Error(
		`NON-CONVERGED: ${reason}; residual=${JSON.stringify(rows.slice(0, 20).map(censusIdentity))}`,
	);
}

function dateTime64Literal(timestampMs: number): string {
	const iso = new Date(timestampMs)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
	return `toDateTime64('${iso}', 3, 'UTC')`;
}

function base64(value: string): string {
	return Buffer.from(value, "utf8").toString("base64");
}

function safeInteger(value: string): string {
	if (!/^[0-9]+$/u.test(value) || !Number.isSafeInteger(Number(value))) {
		throw new Error(`Unsafe integer from ClickHouse: ${JSON.stringify(value)}`);
	}
	return value;
}

function safeDigest(value: string): string {
	if (!/^[0-9a-f]{64}$/u.test(value)) {
		throw new Error(`Unsafe digest from ClickHouse: ${JSON.stringify(value)}`);
	}
	return value;
}

async function assertHealthFloor(
	url: string,
	expectedFloorMs: number,
): Promise<void> {
	const response = await fetch(url);
	const body: unknown = await response.json();
	if (!response.ok || !isRecord(body) || body.status !== "ok") {
		throw new Error(`Health check is not ready: ${url} (${response.status})`);
	}
	if (body.ingested_at_floor_ms !== expectedFloorMs) {
		throw new Error(
			`Health floor mismatch at ${url}: expected ${expectedFloorMs}, received ${String(body.ingested_at_floor_ms)}`,
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readConnection(): ClickHouseConnection {
	const url = process.env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	return {
		database: process.env.CLICKHOUSE_DB ?? "default",
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		url,
		username: resolveClickHouseUsername(process.env, url),
	};
}

async function queryJson<Row>(
	connection: ClickHouseConnection,
	query: string,
): Promise<Row[]> {
	const text = await requestClickHouse(connection, `${query} FORMAT JSON`);
	const parsed: unknown = JSON.parse(text);
	if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
		throw new Error("ClickHouse response did not contain a JSON data array");
	}
	return parsed.data as Row[];
}

async function execute(
	connection: ClickHouseConnection,
	query: string,
): Promise<void> {
	await requestClickHouse(connection, query);
}

async function requestClickHouse(
	connection: ClickHouseConnection,
	query: string,
): Promise<string> {
	const url = new URL(connection.url);
	url.searchParams.set("database", connection.database);
	// Every content-bearing scan must fit the production node's ~5.4 GiB total
	// memory ceiling. Transcript rows reach >100 MB and the canonical digest
	// materializes several framed copies of each block's content, so blocks
	// must be bounded by BYTES (preferred_block_size_bytes adapts row counts
	// to size) and the scan kept single-threaded with a capped prefetch pool.
	// Applied at the connection layer so census, coverage, batch replay, and
	// drift queries are all bounded uniformly.
	// max_block_size is the enforced bound: byte-adaptive sizing alone still
	// admitted multi-transcript blocks whose expression temporaries exceeded
	// the ceiling — the Codex MV's per-line arrays over even 4 near-cap
	// transcripts doubled into GiB-scale allocations. One transcript per block.
	url.searchParams.set("max_threads", "1");
	url.searchParams.set("max_block_size", "1");
	url.searchParams.set("preferred_block_size_bytes", "33554432");
	url.searchParams.set("filesystem_prefetch_max_memory_usage", "536870912");
	// Batch replay queries embed the canonical digest expression once per
	// selected revision plus the full MV SQL; a 100-row batch legitimately
	// exceeds the 256 KiB default and truncates into a syntax error.
	url.searchParams.set("max_query_size", "8388608");
	// Shared-storage engines do not guarantee read-your-writes across nodes:
	// a verification SELECT routed after an INSERT can miss the fresh parts
	// and report every row as a violation. Sequential consistency makes the
	// runner's read-after-write checks sound; plain local MergeTree ignores it.
	url.searchParams.set("select_sequential_consistency", "1");
	const response = await fetch(url, {
		body: query,
		headers: {
			"Content-Type": "text/plain",
			"X-ClickHouse-Key": connection.password,
			"X-ClickHouse-User": connection.username,
		},
		method: "POST",
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`ClickHouse request failed (${response.status}): ${text}\nQuery: ${query.slice(0, 1_000)}`,
		);
	}
	return text;
}

async function journalExists(path: string): Promise<boolean> {
	return Bun.file(path).exists();
}

async function readJournal(path: string): Promise<Journal> {
	const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.epochs)) {
		throw new Error(`Invalid backfill journal at ${path}`);
	}
	return parsed as unknown as Journal;
}

async function writeJournal(path: string, journal: Journal): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.tmp`;
	await writeFile(
		temporaryPath,
		`${JSON.stringify(journal, null, 2)}\n`,
		"utf8",
	);
	await rename(temporaryPath, path);
}

function parseCliOptions(args: readonly string[]): CliOptions {
	const phase = args[0];
	if (
		phase !== "prefloor" &&
		phase !== "barrier" &&
		phase !== "c0" &&
		phase !== "c1" &&
		phase !== "c2" &&
		phase !== "coverage" &&
		phase !== "drift" &&
		phase !== "status"
	) {
		throw new Error(
			"Usage: backfill-subagent-metrics.ts <coverage|prefloor|barrier|c0|c1|c2|drift|status> [--journal PATH] [--fleet-verified] [--health-url URL]",
		);
	}
	let fleetVerified = false;
	const healthUrls: string[] = [];
	let journalPath = DEFAULT_JOURNAL_PATH;
	for (let index = 1; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--fleet-verified") {
			fleetVerified = true;
			continue;
		}
		if (argument === "--health-url" || argument === "--journal") {
			const value = args[index + 1];
			if (!value) throw new Error(`${argument} requires a value`);
			if (argument === "--health-url") healthUrls.push(value);
			else journalPath = resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	return { fleetVerified, healthUrls, journalPath, phase };
}

if (import.meta.main) {
	void main().catch((error: unknown) => {
		console.error(`[subagent-backfill] failed: ${String(error)}`);
		process.exit(1);
	});
}
