import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sqlClient } from "../db.js";
import {
	getCliUpdateStatus,
	readLatestCliVersion,
	recordUserCliVersion,
	resetLatestCliVersionForTests,
} from "../services/cli-version.service.js";

const userId = `cli-version-${randomUUID()}`;
const npmAnswering = (version: unknown) =>
	(async () => Response.json({ version })) as unknown as typeof fetch;

beforeAll(async () => {
	await sqlClient`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'CLI Version', ${`${userId}@example.test`})`;
});

beforeEach(() => resetLatestCliVersionForTests());

afterAll(async () => {
	await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
});

test("reports an outdated CLI from the last recorded upload and ignores junk versions", async () => {
	await readLatestCliVersion(npmAnswering("0.11.0"), Date.now());
	expect(await getCliUpdateStatus(sqlClient, userId)).toEqual({
		installedVersion: null,
		latestVersion: "0.11.0",
		outdated: false,
	});

	await recordUserCliVersion(sqlClient, userId, "0.9.0");
	await recordUserCliVersion(sqlClient, userId, "not-a-version");
	expect(await getCliUpdateStatus(sqlClient, userId)).toEqual({
		installedVersion: "0.9.0",
		latestVersion: "0.11.0",
		outdated: true,
	});

	await recordUserCliVersion(sqlClient, userId, "0.11.0");
	expect((await getCliUpdateStatus(sqlClient, userId)).outdated).toBe(false);
});

test("never throws into the upload when the version cannot be stored", async () => {
	const closed = postgres(process.env.PG_CONNECTION_STRING ?? "");
	await closed.end();
	expect(await recordUserCliVersion(closed, userId, "0.9.0")).toBeUndefined();
});

test("checks npm at most hourly and keeps the last version when npm fails", async () => {
	expect(await readLatestCliVersion(npmAnswering("0.11.0"), 0)).toBe("0.11.0");
	expect(await readLatestCliVersion(npmAnswering("0.12.0"), 1_000)).toBe(
		"0.11.0",
	);
	const failing = (async () => {
		throw new Error("offline");
	}) as unknown as typeof fetch;
	expect(await readLatestCliVersion(failing, 60 * 60 * 1_000)).toBe("0.11.0");
});
