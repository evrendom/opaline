import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
	acquirePostgresLease,
	assertPostgresLeaseHeld,
	PostgresLeaseLostError,
	pruneExpiredPostgresLeases,
	releasePostgresLease,
	renewPostgresLease,
	withPostgresLease,
} from "./postgres-lease.service.js";

const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) {
	throw new Error("PG_CONNECTION_STRING is required for integration tests");
}
// Separate single-connection clients stand in for the different server
// sessions a transaction-mode pooler hands out to consecutive statements.
const first = postgres(connectionString, { max: 1, prepare: false });
const secondNotices: string[] = [];
const second = postgres(connectionString, {
	max: 1,
	onnotice: (notice) => {
		secondNotices.push(String(notice.message));
	},
	prepare: false,
});

afterAll(async () => {
	await Promise.all([first.end({ timeout: 1 }), second.end({ timeout: 1 })]);
});

describe("Postgres lease primitives", () => {
	test("a free name is acquired once and contenders are refused", async () => {
		const name = leaseName();
		const holder = randomUUID();

		expect(await acquirePostgresLease(name, holder, 60_000, first)).toBe(true);
		expect(await acquirePostgresLease(name, randomUUID(), 60_000, second)).toBe(
			false,
		);
		expect(await acquirePostgresLease(name, holder, 60_000, second)).toBe(
			false,
		);
		expect(await readHolder(name)).toBe(holder);
	});

	test("concurrent acquisitions of one name admit exactly one holder", async () => {
		const name = leaseName();
		const results = await Promise.all([
			acquirePostgresLease(name, randomUUID(), 60_000, first),
			acquirePostgresLease(name, randomUUID(), 60_000, second),
		]);

		expect(results.filter(Boolean)).toHaveLength(1);
	});

	test("an expired lease is taken over and its former holder can neither renew nor release it", async () => {
		const name = leaseName();
		const crashed = randomUUID();
		const successor = randomUUID();
		expect(await acquirePostgresLease(name, crashed, 200, first)).toBe(true);
		expect(await acquirePostgresLease(name, successor, 60_000, second)).toBe(
			false,
		);

		await Bun.sleep(400);

		expect(await acquirePostgresLease(name, successor, 60_000, second)).toBe(
			true,
		);
		expect(await renewPostgresLease(name, crashed, 60_000, first)).toBe(false);
		expect(await releasePostgresLease(name, crashed, first)).toBe(false);
		expect(await readHolder(name)).toBe(successor);
	});

	test("renewal extends a lease past its original expiry", async () => {
		const name = leaseName();
		const holder = randomUUID();
		expect(await acquirePostgresLease(name, holder, 300, first)).toBe(true);

		expect(await renewPostgresLease(name, holder, 60_000, first)).toBe(true);
		await Bun.sleep(500);

		expect(await acquirePostgresLease(name, randomUUID(), 60_000, second)).toBe(
			false,
		);
	});

	test("only the holder releases a lease, from any server session", async () => {
		const name = leaseName();
		const holder = randomUUID();
		expect(await acquirePostgresLease(name, holder, 60_000, first)).toBe(true);

		expect(await releasePostgresLease(name, randomUUID(), second)).toBe(false);
		expect(await readHolder(name)).toBe(holder);
		// Released on a different session than the one that acquired it, as a
		// transaction-mode pooler may do.
		expect(await releasePostgresLease(name, holder, second)).toBe(true);
		expect(await readHolder(name)).toBeNull();
		expect(await acquirePostgresLease(name, randomUUID(), 60_000, first)).toBe(
			true,
		);
	});

	test("session advisory locks are why: an unlock on another server session releases nothing", async () => {
		const key = leaseName();
		const [locked] = await first<Array<{ locked: boolean }>>`
			SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS locked
		`;
		expect(locked?.locked).toBe(true);
		try {
			const [unlocked] = await second<Array<{ unlocked: boolean }>>`
				SELECT pg_advisory_unlock(hashtextextended(${key}, 0)) AS unlocked
			`;
			expect(unlocked?.unlocked).toBe(false);
			// The warning production logged on every pooled unlock.
			expect(secondNotices).toContain(
				"you don't own a lock of type ExclusiveLock",
			);
			const [retry] = await second<Array<{ locked: boolean }>>`
				SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS locked
			`;
			expect(retry?.locked).toBe(false);
		} finally {
			await first`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
		}
	});

	test("pruning removes only leases that expired over an hour ago", async () => {
		const stale = leaseName();
		const recent = leaseName();
		await first`
			INSERT INTO coordination_lease (name, holder, acquired_at, expires_at)
			VALUES
				(${stale}, ${randomUUID()}, now() - interval '3 hours', now() - interval '2 hours'),
				(${recent}, ${randomUUID()}, now() - interval '2 minutes', now() - interval '1 minute')
		`;

		const pruned = await pruneExpiredPostgresLeases(second);

		expect(pruned.deleted).toBeGreaterThanOrEqual(1);
		expect(await readHolder(stale)).toBeNull();
		expect(await readHolder(recent)).not.toBeNull();
	});
});

describe("assertPostgresLeaseHeld", () => {
	test("fences a write until it commits, so a successor cannot take over mid-write", async () => {
		const name = leaseName();
		const holder = randomUUID();
		expect(await acquirePostgresLease(name, holder, 200, first)).toBe(true);
		const lease = heldLease(name, holder);
		let successorAcquired: Promise<boolean> | undefined;

		await first.begin(async (transaction) => {
			await assertPostgresLeaseHeld(lease, transaction);
			await Bun.sleep(400);
			// Expired by now, but the fenced row lock holds the successor off.
			successorAcquired = acquirePostgresLease(
				name,
				randomUUID(),
				60_000,
				second,
			);
			await Bun.sleep(200);
			expect(await readHolderFrom(transaction, name)).toBe(holder);
		});

		expect(await successorAcquired).toBe(true);
	});

	test("rejects a holder whose lease was taken over or has expired", async () => {
		const takenOver = leaseName();
		const formerHolder = randomUUID();
		expect(
			await acquirePostgresLease(takenOver, formerHolder, 200, first),
		).toBe(true);
		await Bun.sleep(400);
		expect(
			await acquirePostgresLease(takenOver, randomUUID(), 60_000, second),
		).toBe(true);
		const expired = leaseName();
		const expiredHolder = randomUUID();
		expect(await acquirePostgresLease(expired, expiredHolder, 200, first)).toBe(
			true,
		);
		await Bun.sleep(400);

		for (const lease of [
			heldLease(takenOver, formerHolder),
			heldLease(expired, expiredHolder),
		]) {
			await expect(
				first.begin((transaction) =>
					assertPostgresLeaseHeld(lease, transaction),
				),
			).rejects.toBeInstanceOf(PostgresLeaseLostError);
		}
	});
});

describe("withPostgresLease", () => {
	test("reports busy without running the work while another holder is live", async () => {
		const name = leaseName();
		expect(await acquirePostgresLease(name, randomUUID(), 60_000, first)).toBe(
			true,
		);
		let ran = false;

		const outcome = await withPostgresLease(
			name,
			async () => {
				ran = true;
			},
			{ database: second, ttlMs: 60_000 },
		);

		expect(outcome).toEqual({ status: "busy" });
		expect(ran).toBe(false);
	});

	test("renews the lease while work outlives its TTL and releases it afterwards", async () => {
		const name = leaseName();
		let contended: boolean | undefined;
		let aborted: boolean | undefined;

		const outcome = await withPostgresLease(
			name,
			async (lease) => {
				await Bun.sleep(900);
				contended = await acquirePostgresLease(
					name,
					randomUUID(),
					60_000,
					second,
				);
				aborted = lease.signal.aborted;
				return "done";
			},
			{ database: first, ttlMs: 300 },
		);

		expect(outcome).toEqual({ result: "done", status: "completed" });
		expect(contended).toBe(false);
		expect(aborted).toBe(false);
		expect(await readHolder(name)).toBeNull();
	});

	test("releases the lease when the work throws", async () => {
		const name = leaseName();

		await expect(
			withPostgresLease(
				name,
				async () => {
					throw new Error("work failed");
				},
				{ database: first, ttlMs: 60_000 },
			),
		).rejects.toThrow("work failed");
		expect(await readHolder(name)).toBeNull();
	});

	test("aborts the work's signal once another holder owns the lease, and leaves that holder's lease alone", async () => {
		const name = leaseName();
		const successor = randomUUID();
		let reason: unknown;

		await withPostgresLease(
			name,
			async (lease) => {
				// Stands in for a takeover after renewals could not reach Postgres.
				await second`
					UPDATE coordination_lease SET holder = ${successor} WHERE name = ${name}
				`;
				reason = await new Promise<unknown>((resolve) => {
					lease.signal.addEventListener("abort", () =>
						resolve(lease.signal.reason),
					);
				});
			},
			{ database: first, ttlMs: 300 },
		);

		expect(reason).toBeInstanceOf(PostgresLeaseLostError);
		expect(await readHolder(name)).toBe(successor);
	});
});

function heldLease(name: string, holder: string) {
	return { holder, name, signal: new AbortController().signal };
}

async function readHolderFrom(
	transaction: postgres.TransactionSql,
	name: string,
): Promise<string | null> {
	const [row] = await transaction.unsafe<Array<{ holder: string }>>(
		"SELECT holder FROM coordination_lease WHERE name = $1",
		[name],
	);
	return row?.holder ?? null;
}

function leaseName(): string {
	return `postgres-lease-test:${randomUUID()}`;
}

async function readHolder(name: string): Promise<string | null> {
	const [row] = await second<Array<{ holder: string }>>`
		SELECT holder FROM coordination_lease WHERE name = ${name}
	`;
	return row?.holder ?? null;
}
