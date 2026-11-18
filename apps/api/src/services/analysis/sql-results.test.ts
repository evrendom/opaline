import { expect, test } from "bun:test";
import type postgres from "postgres";
import {
	createMemorySqlResultStore,
	createSqlQuota,
	openSqlResult,
	readSqlQuotaLimits,
	SQL_QUOTA,
	type SqlResultRecord,
} from "./sql-results.js";

/**
 * Opening a stored sql result by its id (answers action=result): the member
 * who ran it gets its title, SQL and rows, or why the rows are gone; nobody
 * else opens it. The Postgres store's purge is covered by
 * analysis-sql.integration.ts.
 */

const STORED_AT = new Date("2026-10-01T10:00:00.000Z");
const output: SqlResultRecord["output"] = {
	title: "Longest runs",
	query: "SELECT session_id FROM runs",
	columns: ["session_id"],
	rows: 1,
	truncated: false,
	table: "session_id\ns1",
	notices: [],
	sessions: [],
	runs: [],
};
const record = (owners: string[]): SqlResultRecord => ({
	workspaceId: "w",
	authorId: "author",
	title: output.title,
	query: output.query,
	output,
	owners,
	counts: true,
	queryCarriesText: false,
});
const author = { workspaceId: "w", userId: "author" };
const days = (count: number) =>
	new Date(STORED_AT.getTime() + count * 86_400_000);

test("its author opens a result with its title, SQL and rows until 90 days have passed", async () => {
	const results = createMemorySqlResultStore(() => STORED_AT);
	const id = await results.save(record(["author"]));
	expect(await openSqlResult(results, author, id, days(90))).toEqual({
		id,
		title: output.title,
		query: output.query,
		createdAt: STORED_AT.toISOString(),
		unavailable: null,
		output,
	});
	expect(await openSqlResult(results, author, id, days(91))).toMatchObject({
		title: output.title,
		query: output.query,
		unavailable: "expired",
		output: null,
	});
});

test("deleting a member it counted removes its rows and keeps its title and SQL; deleting its author deletes it", async () => {
	const results = createMemorySqlResultStore(() => STORED_AT);
	const counted = await results.save(record(["author", "member"]));
	const other = await results.save(record(["author"]));
	await results.purge({ targetType: "account", targetId: "member" });
	expect(await openSqlResult(results, author, counted, days(1))).toMatchObject({
		title: output.title,
		query: output.query,
		unavailable: "removed",
		output: null,
	});
	expect(await results.get(counted)).toMatchObject({ owners: ["author"] });
	expect(
		(await openSqlResult(results, author, other, days(1))).unavailable,
	).toBeNull();
	await results.purge({ targetType: "account", targetId: "author" });
	expect(await results.get(other)).toBeNull();
});

test("nobody but its author opens a result, in no other workspace", async () => {
	const results = createMemorySqlResultStore(() => STORED_AT);
	const id = await results.save(record(["author"]));
	for (const viewer of [
		{ workspaceId: "w", userId: "member" },
		{ workspaceId: "other", userId: "author" },
	])
		await expect(openSqlResult(results, viewer, id, days(1))).rejects.toThrow(
			`No sql result ${id} of yours`,
		);
	await expect(
		openSqlResult(results, author, "sr_missing", days(1)),
	).rejects.toThrow("No sql result sr_missing of yours");
});

test("the SQL quota is 120 calls an hour, off on a self-hosted server unless OPALINE_SQL_QUOTA_PER_HOUR sets one", async () => {
	expect(readSqlQuotaLimits({})).toBe(SQL_QUOTA);
	expect(readSqlQuotaLimits({ OPALINE_SQL_QUOTA_PER_HOUR: "5" })).toBe(
		SQL_QUOTA,
	);
	expect(readSqlQuotaLimits({ OPALINE_SELF_HOSTED: "1" })).toBeNull();
	expect(
		readSqlQuotaLimits({
			OPALINE_SELF_HOSTED: "1",
			OPALINE_SQL_QUOTA_PER_HOUR: "600",
		}),
	).toEqual({ queries: 600, windowMs: 3_600_000 });
	expect(
		readSqlQuotaLimits({
			OPALINE_SELF_HOSTED: "1",
			OPALINE_SQL_QUOTA_PER_HOUR: "lots",
		}),
	).toBe(SQL_QUOTA);

	const reached: string[] = [];
	const sql = ((strings: TemplateStringsArray) => {
		reached.push(strings.join("?"));
		return Promise.resolve([{ query_count: 2, window_started_at: new Date() }]);
	}) as unknown as postgres.Sql;
	const off = createSqlQuota(sql, { OPALINE_SELF_HOSTED: "1" });
	for (let call = 0; call < 500; call++)
		expect(await off.take("w")).toEqual({ allowed: true });
	expect(reached).toEqual([]);
	const one = createSqlQuota(sql, {
		OPALINE_SELF_HOSTED: "1",
		OPALINE_SQL_QUOTA_PER_HOUR: "1",
	});
	expect(one.queries).toBe(1);
	expect((await one.take("w")).allowed).toBe(false);
	expect(createSqlQuota(sql, {}).queries).toBe(120);
});
