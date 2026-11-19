import type {
	ClickHouseClient,
	ClickHouseSettings,
} from "@clickhouse/client-web";
import { ClickHouseError } from "@clickhouse/client-web";

export const WRITE_PROBE_LIMITS = {
	insertBudgetSeconds: 10,
	insertRequestTimeoutMs: 12_000,
	readBudgetSeconds: 2,
	readRequestTimeoutMs: 3_000,
	readbackRetryDelaysMs: [250, 500, 1_000],
	readbackBudgetMs: 4_000,
	slowWriteMs: 3_000,
} as const;

export type WriteProbeOutcome =
	| "ok"
	| "delayed_visibility"
	| "not_visible"
	| "read_failed"
	| "insert_timeout"
	| "insert_failed";

export const HEALTHY_WRITE_PROBE_OUTCOMES: ReadonlySet<WriteProbeOutcome> =
	new Set(["ok", "delayed_visibility"]);

export type ProbeFailure = "clickhouse" | "timeout" | "network";

export interface ProbeRequestReport {
	query_id: string;
	started_at: string;
	duration_ms: number;
	failure: ProbeFailure | null;
	exception_code: string | null;
}

export interface ProbeReadReport extends ProbeRequestReport {
	rows: number | null;
}

export interface WriteProbeReport {
	probe_id: string;
	outcome: WriteProbeOutcome;
	slow_insert: boolean;
	started_at: string;
	finished_at: string;
	duration_ms: number;
	insert: ProbeRequestReport;
	reads: ProbeReadReport[];
	visible_after_ms: number | null;
}

export type WriteProbeClient = Pick<ClickHouseClient, "command" | "query">;

const TIMEOUT_CODES = new Set(["159", "160", "209"]);

export function insertProbeRequest(probeId: string) {
	return {
		query: `INSERT INTO rudel.dependency_health_probes (probe_id)
				SETTINGS async_insert = 1, wait_for_async_insert = 1,
					async_insert_use_adaptive_busy_timeout = 0,
					async_insert_busy_timeout_ms = 200
				FORMAT JSONEachRow ${JSON.stringify({ probe_id: probeId })}`,
		query_id: `health-write-${probeId}`,
		clickhouse_settings: {
			max_execution_time: WRITE_PROBE_LIMITS.insertBudgetSeconds,
			// max_execution_time does not bound the wait for an async insert flush.
			wait_for_async_insert_timeout: WRITE_PROBE_LIMITS.insertBudgetSeconds,
		} satisfies ClickHouseSettings,
	};
}

export function readProbeRequest(probeId: string, attempt: number) {
	return {
		query: `SELECT probe_id FROM rudel.dependency_health_probes
				WHERE probe_id = {probeId:UUID} LIMIT 1`,
		query_params: { probeId },
		query_id: `health-read-${probeId}-${attempt}`,
		format: "JSONEachRow" as const,
		clickhouse_settings: {
			max_execution_time: WRITE_PROBE_LIMITS.readBudgetSeconds,
			timeout_before_checking_execution_speed: 0,
			max_rows_to_read: "100000",
			max_bytes_to_read: "1048576",
			use_query_cache: 0,
			select_sequential_consistency: "1",
		} satisfies ClickHouseSettings,
	};
}

export function describeFailure(error: unknown): {
	failure: ProbeFailure;
	exception_code: string | null;
} {
	if (error instanceof ClickHouseError)
		return {
			failure: TIMEOUT_CODES.has(error.code) ? "timeout" : "clickhouse",
			exception_code: error.code,
		};
	// @clickhouse/client-web rejects its own deadlines with plain Errors.
	if (
		error instanceof Error &&
		(error.message === "Timeout error." ||
			error.message === "The user aborted a request." ||
			error.name === "TimeoutError" ||
			error.name === "AbortError")
	)
		return { failure: "timeout", exception_code: null };
	return { failure: "network", exception_code: null };
}

export interface WriteProbeRuntime {
	probeId?: string;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

export async function probeClickHouseWrite(
	client: WriteProbeClient,
	runtime: WriteProbeRuntime = {},
): Promise<WriteProbeReport> {
	const now = runtime.now ?? Date.now;
	const sleep =
		runtime.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const probeId = runtime.probeId ?? crypto.randomUUID();
	const started = now();
	const finish = (
		outcome: WriteProbeOutcome,
		insert: ProbeRequestReport,
		reads: ProbeReadReport[],
		visibleAt: number | null,
		insertAcknowledgedAt: number | null,
	): WriteProbeReport => {
		const finished = now();
		return {
			probe_id: probeId,
			outcome,
			slow_insert:
				outcome === "insert_timeout" ||
				insert.duration_ms > WRITE_PROBE_LIMITS.slowWriteMs,
			started_at: new Date(started).toISOString(),
			finished_at: new Date(finished).toISOString(),
			duration_ms: finished - started,
			insert,
			reads,
			visible_after_ms:
				visibleAt !== null && insertAcknowledgedAt !== null
					? visibleAt - insertAcknowledgedAt
					: null,
		};
	};

	const insertRequest = insertProbeRequest(probeId);
	let insert: ProbeRequestReport;
	try {
		await client.command({
			...insertRequest,
			abort_signal: AbortSignal.timeout(
				WRITE_PROBE_LIMITS.insertRequestTimeoutMs,
			),
		});
		insert = request(insertRequest.query_id, started, now(), null);
	} catch (error) {
		const failed = request(
			insertRequest.query_id,
			started,
			now(),
			describeFailure(error),
		);
		return finish(
			failed.failure === "timeout" ? "insert_timeout" : "insert_failed",
			failed,
			[],
			null,
			null,
		);
	}

	const acknowledged = now();
	const reads: ProbeReadReport[] = [];
	for (let attempt = 0; ; attempt++) {
		const readRequest = readProbeRequest(probeId, attempt);
		const readStarted = now();
		try {
			const result = await client.query({
				...readRequest,
				abort_signal: AbortSignal.timeout(
					WRITE_PROBE_LIMITS.readRequestTimeoutMs,
				),
			});
			const rows = await result.json<{ probe_id: string }>();
			const readFinished = now();
			reads.push({
				...request(readRequest.query_id, readStarted, readFinished, null),
				rows: rows.length,
			});
			if (rows.some((row) => row.probe_id === probeId))
				return finish(
					attempt === 0 ? "ok" : "delayed_visibility",
					insert,
					reads,
					readFinished,
					acknowledged,
				);
		} catch (error) {
			reads.push({
				...request(
					readRequest.query_id,
					readStarted,
					now(),
					describeFailure(error),
				),
				rows: null,
			});
			return finish("read_failed", insert, reads, null, acknowledged);
		}
		const delay = WRITE_PROBE_LIMITS.readbackRetryDelaysMs[attempt];
		if (
			delay === undefined ||
			now() + delay - acknowledged > WRITE_PROBE_LIMITS.readbackBudgetMs
		)
			return finish("not_visible", insert, reads, null, acknowledged);
		await sleep(delay);
	}
}

function request(
	queryId: string,
	started: number,
	finished: number,
	failure: { failure: ProbeFailure; exception_code: string | null } | null,
): ProbeRequestReport {
	return {
		query_id: queryId,
		started_at: new Date(started).toISOString(),
		duration_ms: finished - started,
		failure: failure?.failure ?? null,
		exception_code: failure?.exception_code ?? null,
	};
}
