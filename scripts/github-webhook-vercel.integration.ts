import { afterAll, beforeAll, expect, test } from "bun:test";
import { ok as assert } from "node:assert";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { sqlClient } from "../apps/api/src/db.js";
import {
	GITHUB_WEBHOOK_PATH,
	handleGitHubWebhookRequest,
} from "../apps/api/src/handlers/github-webhook-http.js";
import { runGitHubEvidenceCollectionMaintenance } from "../apps/api/src/services/github-evidence-maintenance.service.js";
import {
	createR2MultipartUploadClient,
	R2_INGEST_BUCKET,
} from "../apps/api/src/services/r2-ingest-storage.service.js";
import { createGitHubWebhookVercelHandler } from "../deploy/cloud/api/webhooks/github.js";

const secret = "integration-webhook-secret".repeat(3);
const suffix = randomUUID();
const userId = `github-vercel-user-${suffix}`;
const organizationId = `github-vercel-org-${suffix}`;
const installationId = randomInt(1, 2 ** 47);
const repositoryId = randomInt(1, 2 ** 47);
const now = new Date("2026-09-30T12:00:00.000Z");

beforeAll(async () => {
	const connectionString = process.env.PG_CONNECTION_STRING;
	assert(
		connectionString,
		"PG_CONNECTION_STRING is required for integration tests",
	);
	expect(["127.0.0.1", "localhost", "::1"]).toContain(
		new URL(connectionString).hostname,
	);
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email) VALUES ($1, 'Vercel webhook', $2)`,
		[userId, `${userId}@example.test`],
	);
	await sqlClient.unsafe(
		`INSERT INTO organization (id, name, slug) VALUES ($1, 'Vercel webhook', $1)`,
		[organizationId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_app_installation (installation_id, organization_id, account_id, account_login, account_type, repository_selection, permissions, status, installed_by_user_id)
 VALUES ($1, $2, '1', 'opalinehq', 'Organization', 'selected', '{}'::jsonb, 'active', $3)`,
		[String(installationId), organizationId, userId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_repository_binding (organization_id, repository_id, installation_id, node_id, owner, name, full_name, default_branch, is_private, status)
 VALUES ($1, $2, $3, $4, 'opalinehq', 'athena', 'opalinehq/athena', 'main', true, 'active')`,
		[
			organizationId,
			String(repositoryId),
			String(installationId),
			`node-${suffix}`,
		],
	);
});

afterAll(async () => {
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
});

function sign(body: string): string {
	return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("the Vercel entry executes targeted collection attempts after acknowledging, not just a resident-worker wake", async () => {
	const sessionPrefix = `vercel-${randomUUID()}`;
	const commitSha = "d".repeat(40);
	const targetIds: string[] = [];
	for (const label of ["first", "second"]) {
		targetIds.push(
			await insertCollection({
				commitSha,
				sessionId: `${sessionPrefix}-${label}`,
				status: "complete",
			}),
		);
	}
	const inFlight = await insertCollection({
		commitSha,
		sessionId: `${sessionPrefix}-collecting`,
		status: "collecting",
	});
	const backlogIds: string[] = [];
	for (let index = 0; index < 6; index += 1) {
		backlogIds.push(
			await insertCollection({
				commitSha: "e".repeat(40),
				sessionId: `${sessionPrefix}-backlog-${index}`,
				status: "queued",
			}),
		);
	}
	let clock = now;
	let releaseDebounce: (() => void) | undefined;
	const debounce = new Promise<void>((resolve) => {
		releaseDebounce = resolve;
	});
	const delays: number[] = [];
	const continuations: Promise<unknown>[] = [];
	const maintenanceResults: Array<{ attempted: number; failed: number }> = [];
	const r2 = createR2MultipartUploadClient({
		accessKeyId: "integration-access",
		accountId: "integration-account",
		bucket: R2_INGEST_BUCKET,
		endpoint: "http://127.0.0.1:1",
		forcePathStyle: true,
		secretAccessKey: "integration-secret",
	});
	const handler = createGitHubWebhookVercelHandler({
		handleRequest(request, onRefreshScheduled) {
			assert(onRefreshScheduled);
			return handleGitHubWebhookRequest(request, {
				getDatabase: async () => sqlClient,
				now: () => clock,
				onRefreshScheduled,
				secret,
			});
		},
		async runMaintenance(collectionIds, signal) {
			expect([...collectionIds].sort()).toEqual(
				[...targetIds, inFlight].sort(),
			);
			expect(signal.aborted).toBe(false);
			const result = await runGitHubEvidenceCollectionMaintenance({
				collectionIds,
				config: {
					appId: "1",
					slug: "integration",
					privateKeyPem: "invalid-integration-key",
				},
				database: sqlClient,
				limit: 1,
				now: () => clock,
				r2,
				signal,
			});
			maintenanceResults.push(result);
			return result;
		},
		wait(delayMs) {
			delays.push(delayMs);
			return debounce;
		},
	});
	const body = JSON.stringify({
		state: "success",
		installation: { id: installationId },
		repository: { id: repositoryId },
		sha: commitSha,
	});
	const deliveryId = randomUUID();
	const request = () =>
		new Request(`https://api.example.test${GITHUB_WEBHOOK_PATH}`, {
			body,
			headers: {
				"x-github-delivery": deliveryId,
				"x-github-event": "status",
				"x-hub-signature-256": sign(body),
			},
			method: "POST",
		});
	const context = {
		waitUntil(promise: Promise<unknown>) {
			continuations.push(promise);
		},
	};
	const response = await handler(request(), context);
	expect(response.status).toBe(202);
	expect(await response.json()).toEqual({ outcome: "refresh_scheduled" });
	expect(delays).toEqual([31_000]);
	expect(continuations).toHaveLength(1);
	expect(maintenanceResults).toHaveLength(0);
	const duplicate = await handler(request(), context);
	expect(await duplicate.json()).toEqual({ outcome: "duplicate" });
	expect(continuations).toHaveLength(1);

	const newerTarget = await insertCollection({
		attemptNumber: 2,
		commitSha,
		sessionId: `${sessionPrefix}-first`,
		status: "complete",
	});
	await sqlClient.unsafe(
		"UPDATE github_evidence_collection SET refresh_due_at = $2 WHERE id = $1",
		[newerTarget, new Date(now.getTime() + 30_000).toISOString()],
	);
	clock = new Date(now.getTime() + 31_000);
	assert(releaseDebounce);
	releaseDebounce();
	await Promise.all(continuations);

	expect(
		maintenanceResults.map(({ attempted, failed }) => ({
			attempted,
			failed,
		})),
	).toEqual([
		{ attempted: 1, failed: 1 },
		{ attempted: 1, failed: 1 },
		{ attempted: 0, failed: 0 },
	]);
	const attempts = await sqlClient.unsafe<
		Array<{
			attempt_number: number;
			error: string | null;
			lease_expires_at: unknown;
			retry_after: unknown;
			session_id: string;
			status: string;
		}>
	>(
		"SELECT attempt_number, error, lease_expires_at, retry_after, session_id, status FROM github_evidence_collection WHERE session_id IN ($1, $2) ORDER BY session_id, attempt_number DESC",
		[`${sessionPrefix}-first`, `${sessionPrefix}-second`],
	);
	expect(attempts).toHaveLength(5);
	const failures = attempts.filter(({ status }) => status === "failed");
	expect(failures.map(({ attempt_number }) => attempt_number)).toEqual([3, 2]);
	for (const failure of failures) {
		expect(failure.error).toBeTruthy();
		expect(failure.lease_expires_at).toBeNull();
		expect(failure.retry_after).not.toBeNull();
	}
	const untouched = await sqlClient.unsafe<
		Array<{ id: string; status: string }>
	>(
		"SELECT id, status FROM github_evidence_collection WHERE id = ANY($1::text[]) ORDER BY id",
		[[...backlogIds, inFlight]],
	);
	expect(untouched).toHaveLength(7);
	expect(untouched.filter(({ status }) => status === "queued")).toHaveLength(6);
	expect(untouched.find(({ id }) => id === inFlight)?.status).toBe(
		"collecting",
	);
	expect(await refreshDueAt(inFlight)).not.toBeNull();
});

async function insertCollection(input: {
	readonly attemptNumber?: number;
	readonly commitSha: string;
	readonly observationStartedAt?: Date;
	readonly repository?: number;
	readonly sessionId: string;
	readonly sessionUserId?: string;
	readonly status: "collecting" | "complete" | "queued";
}): Promise<string> {
	const id = randomUUID();
	await sqlClient.unsafe(
		`INSERT INTO github_evidence_collection
		 (id, organization_id, repository_id, installation_id, session_id, session_source,
		  session_user_id, commit_sha, attempt_number, status, source_version, coverage,
		  lease_expires_at, retry_after, observation_started_at)
		 VALUES ($1, $2, $3, $4, $5, 'claude_code', $6, $7, $8, $9, 'test', '{}'::jsonb,
		         CASE WHEN $9 = 'collecting' THEN $10::timestamptz + INTERVAL '5 minutes' END,
		         CASE WHEN $9 = 'queued' THEN $10::timestamptz END, $11)`,
		[
			id,
			organizationId,
			String(input.repository ?? repositoryId),
			String(installationId),
			input.sessionId,
			input.sessionUserId ?? userId,
			input.commitSha,
			input.attemptNumber ?? 1,
			input.status,
			now.toISOString(),
			(input.observationStartedAt ?? now).toISOString(),
		],
	);
	return id;
}

async function refreshDueAt(collectionId: string): Promise<string | null> {
	const [row] = await sqlClient.unsafe<Array<{ due: string | null }>>(
		"SELECT to_char(refresh_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS due FROM github_evidence_collection WHERE id = $1",
		[collectionId],
	);
	return row?.due ?? null;
}
