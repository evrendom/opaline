import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Production reaches Postgres through Neon's transaction-mode pooler, which
// hands every transaction (and every autocommit statement) to whichever
// server session is free, even on a `reserve()`d client connection. Session
// state therefore does not survive between statements: a session advisory lock
// is unlocked on the wrong backend ("you don't own a lock of type
// ExclusiveLock") and leaks on the original one. Use `pg_advisory_xact_lock`
// inside `database.begin(...)` for work that fits one transaction, and
// `withPostgresLease` (services/postgres-lease.service.ts) for longer work.

const API_SOURCE_ROOT = join(import.meta.dir, "..");

test("no API source depends on Postgres session state", () => {
	const files = sourceFiles(API_SOURCE_ROOT);
	expect(files).toContain(
		join(API_SOURCE_ROOT, "services/github-repository-sweep.service.ts"),
	);
	expect(files).toContain(
		join(API_SOURCE_ROOT, "services/ingest-processing-ledger.service.ts"),
	);
	const offenders = files.flatMap((file) =>
		sessionStateUses(readFileSync(file, "utf8")).map(
			(use) => `${relative(REPOSITORY_ROOT, file)} uses ${use}`,
		),
	);
	expect(offenders).toEqual([]);
});

test("the scan finds session-level advisory locks and reserved connections, not transaction locks", () => {
	expect(
		sessionStateUses(`
			await connection.unsafe("SELECT pg_try_advisory_lock(hashtextextended($1, 0))", [key]);
			await connection.unsafe("SELECT pg_advisory_lock(42)");
			await connection.unsafe("SELECT PG_ADVISORY_LOCK_SHARED(42)");
			await connection.unsafe("SELECT pg_try_advisory_lock_shared(42)");
			await connection.unsafe("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
			await connection.unsafe("SELECT pg_advisory_unlock_shared(42)");
			await connection.unsafe("SELECT pg_advisory_unlock_all()");
			const connection = await database.reserve();
			await transaction.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
			await transaction.unsafe("SELECT pg_try_advisory_xact_lock(42)");
			await transaction.unsafe("SELECT pg_advisory_xact_lock_shared(42)");
			const reserved = await reserveRateBudget(id, now, database);
		`),
	).toEqual([
		"pg_try_advisory_lock",
		"pg_advisory_lock",
		"pg_advisory_lock_shared",
		"pg_try_advisory_lock_shared",
		"pg_advisory_unlock",
		"pg_advisory_unlock_shared",
		"pg_advisory_unlock_all",
		".reserve(",
	]);
});

/** Session-scoped Postgres features used by `source`, in source order. */
function sessionStateUses(source: string): string[] {
	return [
		...source.matchAll(
			/\bpg_(?:try_)?advisory_(?:lock|unlock)(?:_shared|_all)?\b|\.reserve\(/giu,
		),
	].map((match) => match[0].toLowerCase());
}

/** Every non-test source file under `directory`. */
function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory())
			return entry.name === "__tests__" || entry.name === "node_modules"
				? []
				: sourceFiles(path);
		return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) &&
			!/\.(?:test|integration)\.[cm]?[jt]sx?$/.test(entry.name)
			? [path]
			: [];
	});
}
