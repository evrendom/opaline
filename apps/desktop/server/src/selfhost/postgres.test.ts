import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import { preparePostgres } from "./postgres.js";

const CONNECTION = "postgres://opaline:pg-password-123@db.lan:5432/opaline";
const scripts = mkdtempSync(join(tmpdir(), "opaline-migrate-"));

afterAll(() => {
	rmSync(scripts, { recursive: true, force: true });
});

function script(name: string, body: string): string {
	const path = join(scripts, name);
	writeFileSync(path, body);
	return path;
}

const migrate = script(
	"migrate.ts",
	[
		'console.log("Connecting");',
		'console.log("Migrations applied (2 new) to " + process.env.PG_CONNECTION_STRING);',
		'console.log("Done");',
	].join("\n"),
);

type Answer = (query: string) => unknown[] | Error;

function fakePostgres(...answers: Answer[]) {
	const opened: string[] = [];
	const clients: { queries: string[]; ended: boolean }[] = [];
	const open = (connectionString: string): postgres.Sql => {
		const answer = answers[opened.length];
		if (!answer) throw new Error(`unexpected connection ${opened.length + 1}`);
		opened.push(connectionString);
		const client = { queries: [] as string[], ended: false };
		clients.push(client);
		const run = (query: string) => {
			client.queries.push(query);
			const result = answer(query);
			return result instanceof Error
				? Promise.reject(result)
				: Promise.resolve(result);
		};
		const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
			run(
				strings
					.reduce(
						(query, part, index) =>
							`${query}${part}${index < values.length ? `[${String(values[index])}]` : ""}`,
						"",
					)
					.replace(/\s+/gu, " ")
					.trim(),
			);
		return Object.assign(sql, {
			unsafe: run,
			end: async () => {
				client.ended = true;
			},
		}) as unknown as postgres.Sql;
	};
	return { open, opened, clients };
}

const database =
	(name: string): Answer =>
	(query) =>
		query.startsWith("SELECT current_database()") ? [{ database: name }] : [];

const setting =
	(value: string | null): Answer =>
	() => [{ value }];

test("an unreachable Postgres is named without its password", async () => {
	const listener = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: { data() {} },
	});
	const { port } = listener;
	listener.stop(true);

	await expect(
		preparePostgres(
			`postgres://opaline:pg-password-123@127.0.0.1:${port}/opaline`,
			migrate,
		),
	).rejects.toThrow(
		`Cannot reach Postgres at postgres://opaline:***@127.0.0.1:${port}/opaline: connect ECONNREFUSED 127.0.0.1:${port}`,
	);
});

test("the database is marked self-hosted, migrated with its own URL and checked afterwards", async () => {
	const pg = fakePostgres(database('we"ird'), setting("on"));

	const ready = await preparePostgres(CONNECTION, migrate, pg.open);

	expect(ready).toEqual({
		database: 'we"ird',
		migrated: `Migrations applied (2 new) to ${CONNECTION}`,
	});
	expect(pg.opened).toEqual([CONNECTION, CONNECTION]);
	expect(pg.clients).toEqual([
		{
			queries: [
				"SELECT current_database() AS database",
				`ALTER DATABASE "we""ird" SET opaline.self_hosted = 'on'`,
			],
			ended: true,
		},
		{
			queries: ["SELECT current_setting([opaline.self_hosted], true) AS value"],
			ended: true,
		},
	]);
});

test("a Postgres user that cannot alter the database is told to own it, and nothing is migrated", async () => {
	const pg = fakePostgres((query) =>
		query.startsWith("ALTER DATABASE")
			? new Error("must be owner of database opaline")
			: [{ database: "opaline" }],
	);

	await expect(preparePostgres(CONNECTION, migrate, pg.open)).rejects.toThrow(
		"Cannot mark database opaline as self-hosted (ALTER DATABASE … SET opaline.self_hosted); the Postgres user must own the database: must be owner of database opaline",
	);
	expect(pg.opened).toHaveLength(1);
	expect(pg.clients[0]?.ended).toBe(true);
});

test("a failed migration shows everything the migrator printed", async () => {
	const pg = fakePostgres(database("opaline"));
	const failing = script(
		"migrate-fails.ts",
		[
			'console.log("applying 0042_runs.sql");',
			'console.error("error: relation \\"runs\\" already exists");',
			"process.exit(3);",
		].join("\n"),
	);

	await expect(preparePostgres(CONNECTION, failing, pg.open)).rejects.toThrow(
		'Postgres migrations failed:\napplying 0042_runs.sql\nerror: relation "runs" already exists',
	);
	expect(pg.opened).toHaveLength(1);
});

test("a database that loses the self-hosted setting is refused, because the free-plan run limit would apply", async () => {
	const pg = fakePostgres(database("opaline"), setting(null));

	await expect(preparePostgres(CONNECTION, migrate, pg.open)).rejects.toThrow(
		"Postgres did not keep opaline.self_hosted=on for database opaline; the free-plan run limit would apply",
	);
	expect(pg.clients.map((client) => client.ended)).toEqual([true, true]);
});
