import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import postgres from "postgres";
import {
	claimL1EdgeScopes,
	completeL1EdgeScope,
	enqueueL1EdgeDependents,
	enqueueL1EdgeScope,
	failL1EdgeScope,
	holdsL1EdgeLease,
	L1_EDGE_MAX_ATTEMPTS,
	type L1EdgeScopeKey,
	recordL1EdgeDependencies,
} from "../services/l1-edges/l1-edge-queue.service.js";

setDefaultTimeout(60_000);
// Its own client: another suite in this process may close the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `l1_edge_queue_${Date.now()}_${crypto.randomUUID()}`;
const organizationId = `${RUN}_org`;
const userId = `${RUN}_user`;

afterAll(async () => {
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
	await sqlClient.end();
});

const session = (sessionId: string): L1EdgeScopeKey => ({
	kind: "session",
	organizationId,
	userId,
	source: "claude_code",
	sessionId,
});
/** Claims only this test's scopes, whatever else is queued. */
async function claimOwn(limit = 10) {
	const claims = await claimL1EdgeScopes(sqlClient, {
		limit: 1_000,
		leaseMs: 60_000,
	});
	const own = claims.filter((claim) => claim.organizationId === organizationId);
	for (const other of claims.filter(
		(claim) => claim.organizationId !== organizationId,
	))
		await sqlClient.unsafe(
			"UPDATE l1_edge_scope SET lease_token = NULL, lease_expires_at = NULL WHERE organization_id = $1 AND scope_kind = $2 AND scope_id = $3",
			[other.organizationId, other.scopeKind, other.scopeId],
		);
	return own.slice(0, limit);
}

test("scopes coalesce, claim with a lease and revision, and only the lease holder completes them", async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Edge', $2, false)`,
		[userId, `${userId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Edges', $1)",
		[organizationId],
	);

	await enqueueL1EdgeScope(sqlClient, session("a"));
	await enqueueL1EdgeScope(sqlClient, session("a"));
	await enqueueL1EdgeScope(sqlClient, session("b"), { priority: 1 });
	await enqueueL1EdgeScope(sqlClient, {
		kind: "repository",
		organizationId,
		repositoryId: "101",
	});
	const [first, second, third] = await claimOwn();
	// Live scopes before backfill.
	expect([first?.scopeId, second?.scopeId, third?.scopeId]).toEqual([
		`${userId}/claude_code/a`,
		"101",
		`${userId}/claude_code/b`,
	]);
	if (!first || !second || !third) throw new Error("expected three claims");
	// Each claim takes its own build revision.
	expect(new Set([first.revision, second.revision, third.revision]).size).toBe(
		3,
	);
	expect(await claimOwn()).toEqual([]);

	// A request during the build leaves the scope due after completion.
	await enqueueL1EdgeScope(sqlClient, session("a"));
	expect(
		await completeL1EdgeScope(sqlClient, first, {
			resolverVersion: 1,
			input: { revision: "7" },
			edgeCount: 3,
			unresolvedCount: 1,
		}),
	).toBe(true);
	const [again] = await claimOwn();
	expect(again?.scopeId).toBe(`${userId}/claude_code/a`);
	expect(again?.builtRevision).toBe(first.revision);
	expect(again?.input).toEqual({ revision: "7" });

	// A stale lease cannot complete.
	expect(await holdsL1EdgeLease(sqlClient, first)).toBe(false);
	expect(
		await completeL1EdgeScope(sqlClient, first, {
			resolverVersion: 1,
			edgeCount: 0,
			unresolvedCount: 0,
		}),
	).toBe(false);
	if (!again) throw new Error("expected a reclaim");
	expect(await holdsL1EdgeLease(sqlClient, again)).toBe(true);

	// Failures back off; after the last attempt the scope waits for a request.
	await sqlClient.unsafe(
		"UPDATE l1_edge_scope SET attempt_count = $4 WHERE organization_id = $1 AND scope_kind = $2 AND scope_id = $3",
		[organizationId, "session", again.scopeId, L1_EDGE_MAX_ATTEMPTS],
	);
	expect(await failL1EdgeScope(sqlClient, again, "boom", () => 0)).toBe(true);
	const [{ next } = { next: "" }] = await sqlClient.unsafe<{ next: string }[]>(
		"SELECT next_attempt_at::text AS next FROM l1_edge_scope WHERE organization_id = $1 AND scope_id = $2",
		[organizationId, again.scopeId],
	);
	expect(next).toBe("infinity");
	await enqueueL1EdgeScope(sqlClient, session("a"));
	expect((await claimOwn()).map((claim) => claim.attemptCount)).toEqual([1]);

	// A repository change re-queues open dependents only.
	await recordL1EdgeDependencies(sqlClient, third, [
		{ repositoryKey: "101", openUntil: new Date(Date.now() + 86_400_000) },
		{ repositoryKey: "name:o/r", openUntil: new Date(Date.now() - 1_000) },
	]);
	expect(
		await completeL1EdgeScope(sqlClient, third, {
			resolverVersion: 1,
			edgeCount: 0,
			unresolvedCount: 0,
		}),
	).toBe(true);
	expect(
		await enqueueL1EdgeDependents(sqlClient, organizationId, ["name:o/r"], {
			limit: 10,
		}),
	).toBe(0);
	expect(
		await enqueueL1EdgeDependents(sqlClient, organizationId, ["101"], {
			limit: 10,
		}),
	).toBe(1);

	// Deleting the workspace removes its scopes and dependencies.
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	const [{ count } = { count: -1 }] = await sqlClient.unsafe<
		{ count: number }[]
	>(
		"SELECT (SELECT count(*) FROM l1_edge_scope WHERE organization_id = $1) + (SELECT count(*) FROM l1_edge_scope_dependency WHERE organization_id = $1) AS count",
		[organizationId],
	);
	expect(Number(count)).toBe(0);
});
