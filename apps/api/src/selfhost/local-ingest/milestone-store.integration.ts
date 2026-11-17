import "../../__tests__/helpers/local-integration-guard.js";
import { afterAll, expect, test } from "bun:test";
import { sqlClient } from "../../db.js";
import { createMilestoneStore } from "./milestone-store.js";

const name = `test-${crypto.randomUUID()}`;
const store = createMilestoneStore(sqlClient);

afterAll(async () => {
	await sqlClient`DELETE FROM local_ingest_milestone WHERE name = ${name}`;
});

test("a milestone is unset until reached and keeps its first time", async () => {
	expect(await store.reachedAt(name)).toBeNull();
	const first = new Date("2026-11-17T10:00:00.123Z");
	await store.reach(name, first);
	expect(await store.reachedAt(name)).toEqual(first);
	await store.reach(name, new Date("2026-11-18T10:00:00Z"));
	expect(await store.reachedAt(name)).toEqual(first);
	expect(await store.reachedAt(`${name}-other`)).toBeNull();
});
