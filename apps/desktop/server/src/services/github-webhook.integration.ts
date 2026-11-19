import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { sqlClient } from "../db.js";
import {
	GITHUB_WEBHOOK_PATH,
	handleGitHubWebhookRequest,
} from "../handlers/github-webhook-http.js";
import { pruneGitHubWebhookDeliveries } from "./github-webhook-delivery.service.js";

const secret = "integration-webhook-secret".repeat(3);
const suffix = randomUUID();
const userId = `github-webhook-user-${suffix}`;
const organizationId = `github-webhook-org-${suffix}`;
const otherOrganizationId = `github-webhook-other-org-${suffix}`;
const installationId = randomInt(1, 2 ** 47);
const otherInstallationId = installationId + 1;
const repositoryId = randomInt(1, 2 ** 47);
const otherRepositoryId = repositoryId + 1;
const removableRepositoryId = repositoryId + 2;
const pullRequestId = randomInt(1, 2 ** 47);
const headSha = "a".repeat(40);
const earlierSha = "b".repeat(40);
const now = new Date("2026-09-30T12:00:00.000Z");

beforeAll(async () => {
	const connectionString = process.env.PG_CONNECTION_STRING;
	expect(connectionString).toBeTruthy();
	expect(["127.0.0.1", "localhost", "::1"]).toContain(
		new URL(connectionString ?? "").hostname,
	);
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email) VALUES ($1, 'Webhook', $2)`,
		[userId, `${userId}@example.test`],
	);
	for (const [organization, installation, repositories] of [
		[organizationId, installationId, [repositoryId, removableRepositoryId]],
		[otherOrganizationId, otherInstallationId, [otherRepositoryId]],
	] as const) {
		await sqlClient.unsafe(
			"INSERT INTO organization (id, name, slug) VALUES ($1, 'Webhook', $1)",
			[organization],
		);
		await sqlClient.unsafe(
			`INSERT INTO github_app_installation
			 (installation_id, organization_id, account_id, account_login, account_type,
			  repository_selection, permissions, status, installed_by_user_id)
			 VALUES ($1, $2, '1', 'opalinehq', 'Organization', 'selected',
			         '{"checks":"read"}'::jsonb, 'active', $3)`,
			[String(installation), organization, userId],
		);
		for (const repository of repositories) {
			await sqlClient.unsafe(
				`INSERT INTO github_repository_binding
				 (organization_id, repository_id, installation_id, node_id, owner, name,
				  full_name, default_branch, is_private, status)
				 VALUES ($1, $2, $3, $4, 'opalinehq', $5, $6, 'main', true, 'active')`,
				[
					organization,
					String(repository),
					String(installation),
					`node-${repository}`,
					`repo-${repository}`,
					`opalinehq/repo-${repository}`,
				],
			);
		}
	}
});

afterAll(async () => {
	await sqlClient.unsafe(
		"DELETE FROM organization WHERE id = ANY($1::text[])",
		[[organizationId, otherOrganizationId]],
	);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
});

function sign(body: string): string {
	return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function deliver(input: {
	readonly deliveryId?: string;
	readonly event: string;
	readonly payload: unknown;
	readonly onRefreshScheduled?: (delayMs: number) => void;
}) {
	const body = JSON.stringify(input.payload);
	const deliveryId = input.deliveryId ?? randomUUID();
	const response = await handleGitHubWebhookRequest(
		new Request(`https://api.example.test${GITHUB_WEBHOOK_PATH}`, {
			body,
			headers: {
				"content-type": "application/json",
				"x-github-delivery": deliveryId,
				"x-github-event": input.event,
				"x-hub-signature-256": sign(body),
			},
			method: "POST",
		}),
		{
			getDatabase: async () => sqlClient,
			now: () => now,
			onRefreshScheduled: input.onRefreshScheduled ?? (() => {}),
			secret,
		},
	);
	return {
		deliveryId,
		outcome: ((await response.json()) as { outcome?: string }).outcome,
		status: response.status,
	};
}

function pullRequestPayload(input: {
	readonly action?: string;
	readonly installation?: number;
	readonly repository?: number;
}) {
	return {
		action: input.action ?? "closed",
		installation: { id: input.installation ?? installationId },
		repository: {
			id: input.repository ?? repositoryId,
			full_name: "opalinehq/athena",
		},
		pull_request: { id: pullRequestId, head: { sha: headSha } },
	};
}

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

async function deliveryRows(deliveryId: string) {
	return sqlClient.unsafe<Array<Record<string, unknown>>>(
		"SELECT * FROM github_webhook_delivery WHERE delivery_id = $1",
		[deliveryId],
	);
}

describe("GitHub webhook deliveries", () => {
	test("schedules a debounced refresh of the latest session-linked attempts and acknowledges without collecting", async () => {
		const sessionPrefix = `refresh-${randomUUID()}`;
		const headCollection = await insertCollection({
			commitSha: headSha,
			sessionId: `${sessionPrefix}-head`,
			status: "complete",
		});
		const linkedFirstAttempt = await insertCollection({
			commitSha: earlierSha,
			sessionId: `${sessionPrefix}-linked`,
			status: "complete",
		});
		await sqlClient.unsafe(
			`INSERT INTO github_pull_request_snapshot
			 (organization_id, collection_id, repository_id, provider_pull_request_id,
			  pull_number, head_sha, coverage_complete, ci_coverage_complete, observed_at)
			 VALUES ($1, $2, $3, $4, 1, $5, true, true, $6)`,
			[
				organizationId,
				linkedFirstAttempt,
				String(repositoryId),
				String(pullRequestId),
				headSha,
				now.toISOString(),
			],
		);
		const linkedLatestAttempt = await insertCollection({
			attemptNumber: 2,
			commitSha: earlierSha,
			sessionId: `${sessionPrefix}-linked`,
			status: "complete",
		});
		const inFlight = await insertCollection({
			commitSha: headSha,
			sessionId: `${sessionPrefix}-collecting`,
			status: "collecting",
		});
		const queued = await insertCollection({
			commitSha: headSha,
			sessionId: `${sessionPrefix}-queued`,
			status: "queued",
		});
		const unattributed = await insertCollection({
			commitSha: headSha,
			sessionId: `${sessionPrefix}-unattributed`,
			sessionUserId: "",
			status: "complete",
		});
		const expired = await insertCollection({
			commitSha: headSha,
			observationStartedAt: new Date(now.getTime() - 20 * 86_400_000),
			sessionId: `${sessionPrefix}-expired`,
			status: "complete",
		});
		const otherRepository = await insertCollection({
			commitSha: headSha,
			repository: removableRepositoryId,
			sessionId: `${sessionPrefix}-other-repository`,
			status: "complete",
		});
		const wakeDelays: number[] = [];

		const response = await deliver({
			event: "pull_request",
			onRefreshScheduled: (delayMs) => wakeDelays.push(delayMs),
			payload: pullRequestPayload({}),
		});

		expect(response).toMatchObject({
			outcome: "refresh_scheduled",
			status: 202,
		});
		expect(wakeDelays).toEqual([31_000]);
		const due = "2026-09-30T12:00:30Z";
		expect(await refreshDueAt(headCollection)).toBe(due);
		expect(await refreshDueAt(linkedLatestAttempt)).toBe(due);
		expect(await refreshDueAt(inFlight)).toBe(due);
		for (const untouched of [
			linkedFirstAttempt,
			queued,
			unattributed,
			expired,
			otherRepository,
		]) {
			expect(await refreshDueAt(untouched)).toBeNull();
		}
		// Acknowledgement only scheduled work: no attempt was reserved or run.
		const statuses = await sqlClient.unsafe<Array<{ status: string }>>(
			"SELECT status FROM github_evidence_collection WHERE session_id LIKE $1 || '%' ORDER BY session_id, attempt_number",
			[sessionPrefix],
		);
		expect(statuses.map(({ status }) => status).sort()).toEqual([
			"collecting",
			"complete",
			"complete",
			"complete",
			"complete",
			"complete",
			"complete",
			"queued",
		]);
		const [delivery] = await deliveryRows(response.deliveryId);
		const storedDelivery: Record<string, unknown> = {
			...delivery,
			received_at: new Date(String(delivery?.received_at)),
		};
		expect(storedDelivery).toEqual({
			delivery_id: response.deliveryId,
			organization_id: organizationId,
			installation_id: String(installationId),
			repository_id: String(repositoryId),
			event: "pull_request",
			action: "closed",
			outcome: "refresh_scheduled",
			affected_rows: 3,
			received_at: now,
		});

		// A later event never postpones an earlier requested refresh.
		await deliver({
			event: "check_suite",
			payload: {
				action: "completed",
				installation: { id: installationId },
				repository: { id: repositoryId },
				check_suite: { head_sha: headSha },
			},
		});
		expect(await refreshDueAt(headCollection)).toBe(due);
	});

	test("deduplicates replayed and concurrent deliveries by delivery id", async () => {
		const collection = await insertCollection({
			commitSha: headSha,
			sessionId: `dedupe-${randomUUID()}`,
			status: "complete",
		});
		const deliveryId = randomUUID();
		const [first, second] = await Promise.all([
			deliver({
				deliveryId,
				event: "pull_request",
				payload: pullRequestPayload({}),
			}),
			deliver({
				deliveryId,
				event: "pull_request",
				payload: pullRequestPayload({}),
			}),
		]);
		expect([first.outcome, second.outcome].sort()).toEqual([
			"duplicate",
			"refresh_scheduled",
		]);
		await sqlClient.unsafe(
			"UPDATE github_evidence_collection SET refresh_due_at = NULL WHERE id = $1",
			[collection],
		);
		const wakeDelays: number[] = [];

		const replay = await deliver({
			deliveryId,
			event: "pull_request",
			onRefreshScheduled: (delayMs) => wakeDelays.push(delayMs),
			payload: pullRequestPayload({}),
		});

		expect(replay).toMatchObject({ outcome: "duplicate", status: 202 });
		expect(wakeDelays).toEqual([]);
		expect(await refreshDueAt(collection)).toBeNull();
		expect(await deliveryRows(deliveryId)).toHaveLength(1);
	});

	test("drops events for unbound repositories and foreign installations without storing them", async () => {
		const unboundRepository = await deliver({
			event: "pull_request",
			payload: pullRequestPayload({ repository: repositoryId + 1_000 }),
		});
		// The repository is bound, but to another workspace's installation.
		const crossTenant = await deliver({
			event: "pull_request",
			payload: pullRequestPayload({ repository: otherRepositoryId }),
		});
		const unknownInstallation = await deliver({
			event: "installation",
			payload: {
				action: "deleted",
				installation: { id: installationId + 1_000 },
			},
		});

		for (const response of [
			unboundRepository,
			crossTenant,
			unknownInstallation,
		]) {
			expect(response).toMatchObject({ outcome: "dropped", status: 202 });
			expect(await deliveryRows(response.deliveryId)).toHaveLength(0);
		}
	});

	test("records bound events without matching collections as no-ops", async () => {
		const response = await deliver({
			event: "status",
			payload: {
				state: "success",
				installation: { id: installationId },
				repository: { id: repositoryId },
				sha: "c".repeat(40),
			},
		});
		expect(response).toMatchObject({ outcome: "no_op", status: 202 });
		expect((await deliveryRows(response.deliveryId))[0]?.affected_rows).toBe(0);
	});

	test("removes repositories dropped from the installation and stops routing their events", async () => {
		const removed = await deliver({
			event: "installation_repositories",
			payload: {
				action: "removed",
				installation: { id: installationId },
				repositories_removed: [
					{ id: removableRepositoryId },
					{ id: otherRepositoryId },
				],
			},
		});
		expect(removed).toMatchObject({
			outcome: "installation_updated",
			status: 202,
		});
		const bindings = await sqlClient.unsafe<
			Array<{ repository_id: string; status: string }>
		>(
			"SELECT repository_id, status FROM github_repository_binding WHERE repository_id = ANY($1::text[]) ORDER BY repository_id",
			[[String(removableRepositoryId), String(otherRepositoryId)]],
		);
		// The other workspace's binding is out of this installation's reach.
		expect([...bindings]).toEqual([
			{ repository_id: String(otherRepositoryId), status: "active" },
			{ repository_id: String(removableRepositoryId), status: "removed" },
		]);
		expect(
			await deliver({
				event: "pull_request",
				payload: pullRequestPayload({ repository: removableRepositoryId }),
			}),
		).toMatchObject({ outcome: "dropped" });
	});

	test("tracks installation suspension, permissions and deletion", async () => {
		const installationStatus = async () =>
			(
				await sqlClient.unsafe<Array<{ permissions: unknown; status: string }>>(
					"SELECT status, permissions FROM github_app_installation WHERE installation_id = $1",
					[String(installationId)],
				)
			)[0];

		expect(
			await deliver({
				event: "installation",
				payload: { action: "suspend", installation: { id: installationId } },
			}),
		).toMatchObject({ outcome: "installation_updated" });
		expect((await installationStatus())?.status).toBe("suspended");
		expect(
			await deliver({ event: "pull_request", payload: pullRequestPayload({}) }),
		).toMatchObject({ outcome: "dropped" });

		await deliver({
			event: "installation",
			payload: { action: "unsuspend", installation: { id: installationId } },
		});
		expect((await installationStatus())?.status).toBe("active");
		await deliver({
			event: "installation",
			payload: {
				action: "new_permissions_accepted",
				installation: {
					id: installationId,
					permissions: { checks: "read", pull_requests: "read" },
				},
			},
		});
		expect((await installationStatus())?.permissions).toEqual({
			checks: "read",
			pull_requests: "read",
		});

		const deleted = await deliver({
			event: "installation",
			payload: { action: "deleted", installation: { id: installationId } },
		});
		expect(deleted).toMatchObject({ outcome: "installation_updated" });
		expect((await deliveryRows(deleted.deliveryId))[0]?.affected_rows).toBe(2);
		expect((await installationStatus())?.status).toBe("deleted");
		const active = await sqlClient.unsafe(
			"SELECT 1 FROM github_repository_binding WHERE installation_id = $1 AND status = 'active'",
			[String(installationId)],
		);
		expect(active).toHaveLength(0);
		// A deleted installation is never resurrected by a later unsuspend.
		expect(
			await deliver({
				event: "installation",
				payload: { action: "unsuspend", installation: { id: installationId } },
			}),
		).toMatchObject({ outcome: "no_op" });
		expect((await installationStatus())?.status).toBe("deleted");
	});

	test("prunes deliveries past the retention window", async () => {
		const [stale, fresh] = [randomUUID(), randomUUID()];
		for (const [deliveryId, receivedAt] of [
			[stale, new Date(now.getTime() - 31 * 86_400_000)],
			[fresh, new Date(now.getTime() - 29 * 86_400_000)],
		] as const) {
			await sqlClient.unsafe(
				`INSERT INTO github_webhook_delivery
				 (delivery_id, organization_id, installation_id, event, outcome, received_at)
				 VALUES ($1, $2, $3, 'status', 'no_op', $4)`,
				[
					deliveryId,
					otherOrganizationId,
					String(otherInstallationId),
					receivedAt.toISOString(),
				],
			);
		}

		await pruneGitHubWebhookDeliveries({ database: sqlClient, now: () => now });

		expect(await deliveryRows(stale)).toHaveLength(0);
		expect(await deliveryRows(fresh)).toHaveLength(1);
	});
});
