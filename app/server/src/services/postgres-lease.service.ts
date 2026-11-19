import { randomUUID } from "node:crypto";
import type postgres from "postgres";

/**
 * Pooler-safe mutual exclusion for work that spans more than one transaction.
 *
 * Production reaches Postgres through a transaction-mode pooler, which hands
 * each transaction (and each autocommit statement) to whichever server
 * session is free. Session-level advisory locks therefore unlock on the wrong
 * backend and leak on the original one. A lease is a `coordination_lease` row
 * instead: any connection can take, renew or release it, and a holder that
 * crashes loses it once `expires_at` passes. All times come from the database
 * clock so instances with skewed clocks agree on expiry.
 *
 * Short work that fits in one transaction should keep using
 * `pg_advisory_xact_lock`, which the pooler cannot split.
 */

const LEASE_PRUNE_BATCH_SIZE = 1_000;

export interface PostgresLease {
	readonly holder: string;
	readonly name: string;
	/**
	 * Aborts with `PostgresLeaseLostError` once the holder can no longer prove
	 * it owns the lease: a renewal found another holder, or no renewal reached
	 * Postgres before the lease's last confirmed expiry.
	 */
	readonly signal: AbortSignal;
}

export type PostgresLeaseOutcome<TResult> =
	| { readonly status: "busy" }
	| { readonly result: TResult; readonly status: "completed" };

export interface PostgresLeaseEnvironment {
	readonly database: postgres.Sql;
	/** Lease length; renewed every third of it while the work runs. */
	readonly ttlMs: number;
}

export class PostgresLeaseLostError extends Error {
	constructor(name: string) {
		super(`Lost the Postgres lease ${name}`);
		this.name = "PostgresLeaseLostError";
	}
}

/**
 * Runs `work` while holding the lease `name`, or returns `busy` at once when
 * another live holder has it. The lease is renewed while `work` runs and
 * released afterwards; a failed release is left to expire.
 */
export async function withPostgresLease<TResult>(
	name: string,
	work: (lease: PostgresLease) => Promise<TResult>,
	env: PostgresLeaseEnvironment,
): Promise<PostgresLeaseOutcome<TResult>> {
	assertLeaseTtl(env.ttlMs);
	const holder = randomUUID();
	const requestedAt = Date.now();
	if (!(await acquirePostgresLease(name, holder, env.ttlMs, env.database))) {
		return { status: "busy" };
	}
	const heartbeat = startLeaseHeartbeat(name, holder, requestedAt, env);
	try {
		const result = await work({ holder, name, signal: heartbeat.signal });
		return { result, status: "completed" };
	} finally {
		heartbeat.stop();
		await releasePostgresLease(name, holder, env.database).catch(
			() => undefined,
		);
	}
}

/**
 * Fences a final write against takeover: call it inside the transaction that
 * makes the write, immediately before the write. It locks the lease row, so a
 * successor's acquisition waits until this transaction ends, and throws
 * `PostgresLeaseLostError` (rolling the transaction back) unless `lease` is
 * still held and unexpired.
 */
export async function assertPostgresLeaseHeld(
	lease: PostgresLease,
	transaction: postgres.TransactionSql,
): Promise<void> {
	lease.signal.throwIfAborted();
	const rows = await transaction.unsafe<Array<{ holder: string }>>(
		`SELECT holder FROM coordination_lease
		 WHERE name = $1 AND holder = $2 AND expires_at > now()
		 FOR UPDATE`,
		[lease.name, lease.holder],
	);
	if (rows.length !== 1) throw new PostgresLeaseLostError(lease.name);
}

/** Takes `name` for `holder` when it is free or its previous lease expired. */
export async function acquirePostgresLease(
	name: string,
	holder: string,
	ttlMs: number,
	database: postgres.Sql,
): Promise<boolean> {
	assertLeaseTtl(ttlMs);
	const rows = await database.unsafe<Array<{ holder: string }>>(
		`INSERT INTO coordination_lease (name, holder, acquired_at, expires_at)
		 VALUES ($1, $2, now(), now() + $3::integer * interval '1 millisecond')
		 ON CONFLICT (name) DO UPDATE
		 SET
			holder = EXCLUDED.holder,
			acquired_at = EXCLUDED.acquired_at,
			expires_at = EXCLUDED.expires_at
		 WHERE coordination_lease.expires_at <= now()
		 RETURNING holder`,
		[name, holder, ttlMs],
	);
	return rows.length === 1;
}

/**
 * Extends the lease while `holder` still owns the row. An expired lease that
 * nobody took over is still ours: taking it over replaces the holder.
 */
export async function renewPostgresLease(
	name: string,
	holder: string,
	ttlMs: number,
	database: postgres.Sql,
): Promise<boolean> {
	assertLeaseTtl(ttlMs);
	const rows = await database.unsafe<Array<{ holder: string }>>(
		`UPDATE coordination_lease
		 SET expires_at = now() + $3::integer * interval '1 millisecond'
		 WHERE name = $1 AND holder = $2
		 RETURNING holder`,
		[name, holder, ttlMs],
	);
	return rows.length === 1;
}

/** Releases the lease only when `holder` still owns it. */
export async function releasePostgresLease(
	name: string,
	holder: string,
	database: postgres.Sql,
): Promise<boolean> {
	const rows = await database.unsafe<Array<{ holder: string }>>(
		"DELETE FROM coordination_lease WHERE name = $1 AND holder = $2 RETURNING holder",
		[name, holder],
	);
	return rows.length === 1;
}

/**
 * Deletes leases left behind by crashed holders. Only rows that expired over
 * an hour ago are removed, so a live holder's next renewal never races this.
 */
export async function pruneExpiredPostgresLeases(
	database: postgres.Sql,
): Promise<{ readonly deleted: number; readonly hasMore: boolean }> {
	const rows = await database.unsafe<Array<{ name: string }>>(
		`DELETE FROM coordination_lease
		 WHERE name IN (
			SELECT name FROM coordination_lease
			WHERE expires_at < now() - interval '1 hour'
			ORDER BY expires_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		 )
		 AND expires_at < now() - interval '1 hour'
		 RETURNING name`,
		[LEASE_PRUNE_BATCH_SIZE],
	);
	return {
		deleted: rows.length,
		hasMore: rows.length === LEASE_PRUNE_BATCH_SIZE,
	};
}

function startLeaseHeartbeat(
	name: string,
	holder: string,
	requestedAt: number,
	env: PostgresLeaseEnvironment,
): { readonly signal: AbortSignal; readonly stop: () => void } {
	const controller = new AbortController();
	const lose = (): void => {
		if (!controller.signal.aborted) {
			controller.abort(new PostgresLeaseLostError(name));
		}
	};
	// Expiry is measured from when each request was sent, so the local view of
	// it is never later than the database's.
	let expiry = setTimeout(lose, requestedAt + env.ttlMs - Date.now());
	let renewing = false;
	let stopped = false;
	const renewal = setInterval(
		() => {
			if (controller.signal.aborted || renewing) return;
			renewing = true;
			const sentAt = Date.now();
			renewPostgresLease(name, holder, env.ttlMs, env.database)
				.then((renewed) => {
					if (stopped) return;
					if (!renewed) {
						lose();
						return;
					}
					clearTimeout(expiry);
					expiry = setTimeout(lose, sentAt + env.ttlMs - Date.now());
					expiry.unref?.();
				})
				// A failed renewal keeps the previous expiry; the next tick retries.
				.catch(() => undefined)
				.finally(() => {
					renewing = false;
				});
		},
		Math.max(1, Math.floor(env.ttlMs / 3)),
	);
	expiry.unref?.();
	renewal.unref?.();
	return {
		signal: controller.signal,
		stop: () => {
			stopped = true;
			clearInterval(renewal);
			clearTimeout(expiry);
		},
	};
}

function assertLeaseTtl(ttlMs: number): void {
	if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 2_147_483_647) {
		throw new Error("Postgres lease TTL must be a positive 32-bit integer");
	}
}
