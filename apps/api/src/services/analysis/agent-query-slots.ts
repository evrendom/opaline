import { randomUUID } from "node:crypto";
import type postgres from "postgres";

/**
 * How many agent ClickHouse queries may run at once, across every API
 * instance. Agent queries run as the same ClickHouse user as ingest and
 * backfills, each may use up to 512 MiB, and the server has about 5.4 GiB, so
 * without a cap a burst of agent queries starves inserts and merges. Vercel
 * runs many API instances, so the slots are rows in Postgres
 * (`analysis_query_slot`), each held under a lease while a query runs.
 */
export const AGENT_QUERY_LIMITS = {
	/**
	 * Agent queries running at once, over all workspaces: one per slot row.
	 * Migration 0059 adds rows 0-3; a higher limit needs a migration adding rows.
	 */
	running: 4,
	/** Agent queries of one workspace running at once. */
	perWorkspace: 2,
	/** How long a query waits for a free slot before it is refused as busy. */
	waitMs: 3_000,
	/**
	 * A slot whose holder never released it (a crashed instance) is free
	 * again after this long; longer than an agent query may run (10 s).
	 */
	leaseMs: 30_000,
} as const;

export const AGENT_QUERY_BUSY =
	"The analysis service is busy; retry in a moment.";

/** No slot came free within the wait: recoverable, the agent retries shortly. */
export class AgentQueryBusyError extends Error {
	constructor() {
		super(AGENT_QUERY_BUSY);
		this.name = "AgentQueryBusyError";
	}
}

/** A slot held for one query. */
export interface AgentQueryLease {
	readonly slot: number;
	readonly token: string;
}

/** Where the slots live: shared by every instance. */
export interface AgentQuerySlots {
	/** How long a lease lasts unless renewed. */
	readonly leaseMs: number;
	/** Takes a free slot for the workspace, or null when none is free now. */
	take(workspaceId: string): Promise<AgentQueryLease | null>;
	/** Extends the lease while its holder still has it. */
	renew(lease: AgentQueryLease): Promise<void>;
	release(lease: AgentQueryLease): Promise<void>;
}

export interface AgentQueryLimiter {
	/**
	 * Runs `work` (one agent query) while holding a slot of the workspace.
	 * Waits briefly for a slot, then throws `AgentQueryBusyError` without
	 * running it; a cancelled `signal` stops the wait with its reason. The
	 * lease is renewed while `work` runs, and the slot is released when `work`
	 * settles, whether it returned or threw.
	 */
	withAgentQuerySlot<T>(
		workspaceId: string,
		work: () => Promise<T>,
		signal?: AbortSignal,
	): Promise<T>;
}

/** How often a waiting query tries again for a slot. */
const POLL_MS = 200;

export function createAgentQueryLimiter(
	slots: AgentQuerySlots,
	options: { waitMs?: number } = {},
): AgentQueryLimiter {
	const waitMs = options.waitMs ?? AGENT_QUERY_LIMITS.waitMs;
	return {
		async withAgentQuerySlot(workspaceId, work, signal) {
			const deadline = Date.now() + waitMs;
			let lease = await slots.take(workspaceId);
			while (!lease) {
				signal?.throwIfAborted();
				const left = deadline - Date.now();
				if (left <= 0) throw new AgentQueryBusyError();
				await sleep(Math.min(left, POLL_MS));
				lease = await slots.take(workspaceId);
			}
			const held = lease;
			// A failed renewal is retried on the next tick; the lease outlasts two.
			const renewal = setInterval(
				() => void slots.renew(held).catch(() => undefined),
				Math.floor(slots.leaseMs / 3),
			);
			try {
				return await work();
			} finally {
				clearInterval(renewal);
				// A failed release is left to expire.
				await slots.release(held).catch(() => undefined);
			}
		},
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The slots in Postgres. A take claims a free or expired slot row with
 * `FOR UPDATE SKIP LOCKED`, so concurrent takes on any instance never get
 * the same slot, and only while the workspace holds fewer than its share;
 * takes of one workspace queue on a transaction lock so two never both see
 * room for one more. Times come from the database clock.
 */
export function createPostgresAgentQuerySlots(
	sql: postgres.Sql,
	options: { running?: number; perWorkspace?: number; leaseMs?: number } = {},
): AgentQuerySlots {
	const running = options.running ?? AGENT_QUERY_LIMITS.running;
	const perWorkspace = options.perWorkspace ?? AGENT_QUERY_LIMITS.perWorkspace;
	const leaseMs = options.leaseMs ?? AGENT_QUERY_LIMITS.leaseMs;
	return {
		leaseMs,
		async take(workspaceId) {
			const token = randomUUID();
			const rows = await sql.begin(async (transaction) => {
				await transaction.unsafe(
					"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
					[`analysis-query-slot:${workspaceId}`],
				);
				return transaction.unsafe<{ slot: number }[]>(
					`WITH free AS MATERIALIZED (
						SELECT slot FROM analysis_query_slot
						WHERE slot < $1::int
							AND (lease_expires_at IS NULL OR lease_expires_at <= now())
							AND (
								SELECT count(*) FROM analysis_query_slot
								WHERE organization_id = $2::text AND lease_expires_at > now()
							) < $5::int
							-- A workspace deleted mid-request gets no slot (busy), not a foreign key error.
							AND EXISTS (SELECT 1 FROM organization WHERE id = $2::text)
						ORDER BY slot
						FOR UPDATE SKIP LOCKED
						LIMIT 1
					)
					UPDATE analysis_query_slot AS held SET
						organization_id = $2::text,
						lease_token = $3::text,
						lease_expires_at = now() + $4::bigint * interval '1 millisecond'
					FROM free
					WHERE held.slot = free.slot
					RETURNING held.slot`,
					[running, workspaceId, token, leaseMs, perWorkspace],
				);
			});
			const slot = rows[0]?.slot;
			return slot === undefined ? null : { slot, token };
		},
		async renew(lease) {
			await sql.unsafe(
				`UPDATE analysis_query_slot
				 SET lease_expires_at = now() + $3::bigint * interval '1 millisecond'
				 WHERE slot = $1 AND lease_token = $2`,
				[lease.slot, lease.token, leaseMs],
			);
		},
		async release(lease) {
			await sql.unsafe(
				`UPDATE analysis_query_slot
				 SET organization_id = NULL, lease_token = NULL, lease_expires_at = NULL
				 WHERE slot = $1 AND lease_token = $2`,
				[lease.slot, lease.token],
			);
		},
	};
}
