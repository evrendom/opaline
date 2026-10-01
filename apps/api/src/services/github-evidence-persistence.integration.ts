import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { sqlClient } from "../db.js";
import { handleGitHubRepositorySetupRequest } from "../handlers/github-repository-evidence-http.js";
import {
	createGitHubInstallState,
	verifyGitHubUserAuthorizationState,
} from "./github-app.service.js";
import { collectAndPersistGitHubCommitEvidence } from "./github-evidence-persistence.service.js";
import {
	getGitHubRepositoryConnectionStatus,
	persistGitHubRepositoryInstallation,
} from "./github-repository-binding.service.js";
import {
	createR2MultipartUploadClient,
	R2_INGEST_BUCKET,
} from "./r2-ingest-storage.service.js";

const suffix = randomUUID();
const callbackOrganizationIds: string[] = [];
const userId = `github-lease-user-${suffix}`;
const organizationId = `github-lease-org-${suffix}`;
const installationId = `github-lease-installation-${suffix}`;
const repositoryId = `github-lease-repository-${suffix}`;
const commitSha = "a".repeat(40);
const callbackInstallationId = BigInt(
	`0x${suffix.replaceAll("-", "")}`,
).toString();
const verifiedOrganizationId = `github-verified-org-${suffix}`;
const verifiedInstallationId = `github-verified-installation-${suffix}`;
const config = {
	appId: "1",
	privateKeyPem: "unused because lease reservation stops before GitHub auth",
	slug: "github-lease-integration",
};
const r2 = createR2MultipartUploadClient({
	accessKeyId: "unused",
	accountId: "unused",
	bucket: R2_INGEST_BUCKET,
	endpoint: "http://127.0.0.1:59000",
	forcePathStyle: true,
	secretAccessKey: "unused",
});
const callbackPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
	.privateKey.export({ format: "pem", type: "pkcs8" })
	.toString();
const callbackStateSecret = "github-callback-integration-secret".repeat(2);
const callbackEnvironment = {
	GITHUB_REPOSITORY_APP_CALLBACK_URL: "http://127.0.0.1:41239/api/github/setup",
	GITHUB_REPOSITORY_APP_CLIENT_ID: "Iv1.integration",
	GITHUB_REPOSITORY_APP_CLIENT_SECRET: "integration-client-secret",
	GITHUB_REPOSITORY_APP_ID: "12345",
	GITHUB_REPOSITORY_APP_PRIVATE_KEY: callbackPrivateKey,
	GITHUB_REPOSITORY_APP_SLUG: "opaline-integration",
	GITHUB_REPOSITORY_APP_STATE_SECRET: callbackStateSecret,
};

beforeAll(async () => {
	const connectionString = process.env.PG_CONNECTION_STRING;
	if (!connectionString) {
		throw new Error("PG_CONNECTION_STRING is required for integration tests");
	}
	if (
		!["127.0.0.1", "localhost", "::1"].includes(
			new URL(connectionString).hostname,
		)
	) {
		throw new Error(
			"GitHub lease integration tests require loopback PostgreSQL",
		);
	}
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email) VALUES ($1, 'GitHub Lease', $2)`,
		[userId, `${userId}@example.test`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'GitHub Lease', $1)",
		[organizationId],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'GitHub Verified', $1)",
		[verifiedOrganizationId],
	);
	await sqlClient.unsafe(
		"INSERT INTO member (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
		[randomUUID(), organizationId, userId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_app_installation
		 (installation_id, organization_id, account_id, account_login, account_type,
		  repository_selection, permissions, status, installed_by_user_id)
		 VALUES ($1, $2, '1', 'github-lease', 'Organization', 'selected', '{}'::jsonb,
		         'active', $3)`,
		[installationId, organizationId, userId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_repository_binding
		 (organization_id, repository_id, installation_id, node_id, owner, name,
		  full_name, default_branch, is_private, status)
		 VALUES ($1, $2, $3, $4, 'opalinehq', 'athena', 'opalinehq/athena', 'main',
		         true, 'active')`,
		[organizationId, repositoryId, installationId, `node-${suffix}`],
	);
});

afterAll(async () => {
	await sqlClient.unsafe(
		"DELETE FROM organization WHERE id = ANY($1::text[])",
		[callbackOrganizationIds],
	);
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		verifiedOrganizationId,
	]);
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
});

describe("GitHub evidence lease timestamps", () => {
	test("serializes concurrent callback persistence by installation and enforces tenant foreign keys", async () => {
		const organizations = [randomUUID(), randomUUID()];
		callbackOrganizationIds.push(...organizations);
		for (const organization of organizations)
			await sqlClient.unsafe(
				"INSERT INTO organization (id, name, slug) VALUES ($1, 'Callback race', $1)",
				[organization],
			);
		const installationId = randomUUID();
		const details = {
			installationId,
			accountId: "1",
			accountLogin: "opalinehq",
			accountType: "Organization" as const,
			repositorySelection: "selected" as const,
			permissions: { contents: "read" },
		};
		const repository = {
			id: randomUUID(),
			nodeId: randomUUID(),
			owner: "opalinehq",
			name: "callback",
			fullName: "opalinehq/callback",
			defaultBranch: "main",
			isPrivate: true,
		};
		const callbacks = await Promise.allSettled(
			organizations.map((organizationId) =>
				persistGitHubRepositoryInstallation({
					database: sqlClient,
					details,
					installedByUserId: userId,
					now: new Date(),
					organizationId,
					repositories: [repository],
				}),
			),
		);
		expect(
			callbacks.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			callbacks.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		const [installation] = await sqlClient.unsafe<
			Array<{ organization_id: string }>
		>(
			"SELECT organization_id FROM github_app_installation WHERE installation_id = $1",
			[installationId],
		);
		if (!installation) throw new Error("Expected one installation owner");
		const other = organizations.find(
			(organizationId) => organizationId !== installation.organization_id,
		);
		if (!other) throw new Error("Expected another workspace");
		expect(
			await sqlClient.unsafe(
				"SELECT organization_id FROM github_repository_binding WHERE installation_id = $1",
				[installationId],
			),
		).toHaveLength(1);
		await expect(
			sqlClient
				.unsafe(
					"INSERT INTO github_repository_binding (organization_id, repository_id, installation_id, node_id, owner, name, full_name, default_branch, is_private) VALUES ($1, $2, $3, 'cross', 'opalinehq', 'cross', 'opalinehq/cross', 'main', true)",
					[other, randomUUID(), installationId],
				)
				.then(),
		).rejects.toMatchObject({ code: "23503" });
		await expect(
			sqlClient
				.unsafe(
					"INSERT INTO github_evidence_collection (id, organization_id, repository_id, installation_id, commit_sha, status, source_version, coverage) VALUES ($1, $2, $3, $4, $5, 'queued', 'fixture', '{}'::jsonb)",
					[randomUUID(), other, repository.id, installationId, commitSha],
				)
				.then(),
		).rejects.toMatchObject({ code: "23503" });
	});

	test("requires user authorization before binding a setup callback installation", async () => {
		const setupState = createGitHubInstallState({
			organizationId,
			stateSecret: callbackStateSecret,
			userId,
			workspaceSlug: organizationId,
		});
		const setupUrl = new URL("http://127.0.0.1:41239/api/github/setup");
		setupUrl.searchParams.set("installation_id", callbackInstallationId);
		setupUrl.searchParams.set("setup_action", "install");
		setupUrl.searchParams.set("state", setupState);

		const response = await handleGitHubRepositorySetupRequest({
			database: sqlClient,
			environment: callbackEnvironment,
			frontendOrigin: "http://127.0.0.1:4011",
			getSession: async () => ({ user: { id: userId } }),
			request: new Request(setupUrl.toString()),
		});

		expect(response.status).toBe(302);
		const authorizationUrl = new URL(response.headers.get("Location") ?? "");
		expect(authorizationUrl.origin).toBe("https://github.com");
		expect(
			verifyGitHubUserAuthorizationState({
				state: authorizationUrl.searchParams.get("state") ?? "",
				stateSecret: callbackStateSecret,
			}),
		).toMatchObject({ installationId: callbackInstallationId });
		const bindings = await sqlClient.unsafe(
			"SELECT installation_id FROM github_app_installation WHERE installation_id = $1",
			[callbackInstallationId],
		);
		expect(bindings).toHaveLength(0);
	});

	test("reconnect keeps only the user-verified repository snapshot", async () => {
		const repositoryA = {
			defaultBranch: "main",
			fullName: "opalinehq/verified-a",
			id: `verified-a-${suffix}`,
			isPrivate: true,
			name: "verified-a",
			nodeId: `verified-node-a-${suffix}`,
			owner: "opalinehq",
		};
		const repositoryB = {
			...repositoryA,
			fullName: "opalinehq/app-only-b",
			id: `app-only-b-${suffix}`,
			name: "app-only-b",
			nodeId: `app-only-node-b-${suffix}`,
		};
		const details = {
			accountId: `verified-account-${suffix}`,
			accountLogin: "opalinehq",
			accountType: "Organization" as const,
			installationId: verifiedInstallationId,
			permissions: { contents: "read" },
			repositorySelection: "all" as const,
		};
		await persistGitHubRepositoryInstallation({
			database: sqlClient,
			details,
			installedByUserId: userId,
			now: new Date("2026-09-20T12:00:00.000Z"),
			organizationId: verifiedOrganizationId,
			repositories: [repositoryA, repositoryB],
		});
		await persistGitHubRepositoryInstallation({
			database: sqlClient,
			details,
			installedByUserId: userId,
			now: new Date("2026-09-20T12:01:00.000Z"),
			organizationId: verifiedOrganizationId,
			repositories: [repositoryA],
		});

		const status = await getGitHubRepositoryConnectionStatus({
			database: sqlClient,
			organizationId: verifiedOrganizationId,
		});
		expect(
			status.repositories.map((repository) => repository.repositoryId),
		).toEqual([repositoryA.id]);
		const removed = await sqlClient.unsafe<Array<{ status: string }>>(
			"SELECT status FROM github_repository_binding WHERE organization_id = $1 AND repository_id = $2",
			[verifiedOrganizationId, repositoryB.id],
		);
		expect([...removed]).toEqual([{ status: "removed" }]);
	});

	test("reads the organization-scoped installation and repository settings", async () => {
		expect(
			await getGitHubRepositoryConnectionStatus({
				database: sqlClient,
				organizationId,
			}),
		).toEqual({
			accountLogin: "github-lease",
			accountType: "Organization",
			suspended: false,
			connected: true,
			installationId,
			manageUrl: `https://github.com/organizations/github-lease/settings/installations/${installationId}`,
			repositories: [
				{
					defaultBranch: "main",
					installationId,
					isPrivate: true,
					name: "athena",
					nodeId: `node-${suffix}`,
					organizationId,
					owner: "opalinehq",
					repositoryId,
					sync: { state: "syncing" },
				},
			],
			repositorySelection: "selected",
		});
	});

	test("rejects an active string lease without mutating its attempt", async () => {
		const collectionId = randomUUID();
		const sessionId = `active-${suffix}`;
		const contextId = randomUUID();
		await insertCollection({
			collectionId,
			contextId,
			leaseExpiresAt: "2026-09-20T12:15:00.000Z",
			sessionId,
		});
		const [persisted] = await sqlClient.unsafe<
			Array<{ lease_expires_at: unknown }>
		>("SELECT lease_expires_at FROM github_evidence_collection WHERE id = $1", [
			collectionId,
		]);
		expect(typeof persisted?.lease_expires_at).toBe("string");

		await expect(
			collectAndPersistGitHubCommitEvidence({
				commitSha,
				config,
				contextId,
				database: sqlClient,
				initiatedByUserId: userId,
				now: () => new Date("2026-09-20T12:00:00.000Z"),
				organizationId,
				refresh: true,
				repositoryId,
				r2,
				sessionId,
			}),
		).rejects.toThrow("GitHub evidence collection is already in progress.");

		const rows = await collectionRows(sessionId);
		expect([...rows]).toEqual([
			{
				attemptNumber: 1,
				error: null,
				id: collectionId,
				retryCount: 0,
				retryOfCollectionId: null,
				status: "collecting",
			},
		]);
	});

	test("checks an active string lease on the retry-fenced path", async () => {
		const collectionId = randomUUID();
		const sessionId = `retry-active-${suffix}`;
		const contextId = randomUUID();
		await insertCollection({
			collectionId,
			contextId,
			leaseExpiresAt: "2026-09-20T12:15:00.000Z",
			sessionId,
		});

		await expect(
			collectAndPersistGitHubCommitEvidence({
				commitSha,
				config,
				contextId,
				database: sqlClient,
				initiatedByUserId: userId,
				now: () => new Date("2026-09-20T12:00:00.000Z"),
				organizationId,
				repositoryId,
				retryCollectionId: collectionId,
				r2,
				sessionId,
			}),
		).rejects.toThrow("GitHub evidence collection is already in progress.");
		expect(await collectionRows(sessionId)).toHaveLength(1);
	});

	test("expires a string lease and preserves the old attempt before starting another", async () => {
		const collectionId = randomUUID();
		const sessionId = `expired-${suffix}`;
		const contextId = randomUUID();
		await insertCollection({
			collectionId,
			contextId,
			leaseExpiresAt: "2026-09-20T11:59:59.000Z",
			sessionId,
		});
		const controller = new AbortController();
		controller.abort(new Error("stop before GitHub auth"));

		await expect(
			collectAndPersistGitHubCommitEvidence({
				commitSha,
				config,
				contextId,
				database: sqlClient,
				initiatedByUserId: userId,
				now: () => new Date("2026-09-20T12:00:00.000Z"),
				organizationId,
				refresh: true,
				repositoryId,
				r2,
				sessionId,
				signal: controller.signal,
			}),
		).rejects.toThrow("stop before GitHub auth");

		const rows = await collectionRows(sessionId);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			attemptNumber: 1,
			error: "Collection lease expired.",
			id: collectionId,
			retryCount: 0,
			retryOfCollectionId: null,
			status: "failed",
		});
		expect(rows[1]).toMatchObject({
			attemptNumber: 2,
			error: "Error: stop before GitHub auth",
			retryCount: 0,
			retryOfCollectionId: null,
			status: "failed",
		});
		expect(rows[1]?.id).not.toBe(collectionId);
	});

	test("accepts a null lease on a completed cached attempt", async () => {
		const collectionId = randomUUID();
		const contextId = randomUUID();
		await sqlClient.unsafe(
			`INSERT INTO github_evidence_collection
			 (id, organization_id, repository_id, installation_id, initiated_by_user_id,
			  session_id, context_id, commit_sha, attempt_number, retry_count, status,
			  source_version, coverage, metadata_object_id, metadata_object_key,
			  started_at, completed_at, lease_expires_at, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, '', $6, $7, 1, 0, 'complete', 'integration',
			         '{}'::jsonb, 'sha256:cached', 'cached/object', $8, $8, NULL, $8, $8)`,
			[
				collectionId,
				organizationId,
				repositoryId,
				installationId,
				userId,
				contextId,
				commitSha,
				"2026-09-20T12:00:00.000Z",
			],
		);

		expect(
			await collectAndPersistGitHubCommitEvidence({
				commitSha,
				config,
				contextId,
				database: sqlClient,
				initiatedByUserId: userId,
				organizationId,
				repositoryId,
				r2,
				sessionId: null,
			}),
		).toEqual({
			collectionId,
			commitSha,
			logCount: 0,
			metadataObjectId: "sha256:cached",
			status: "complete",
		});
	});
});

async function insertCollection(input: {
	readonly collectionId: string;
	readonly contextId: string;
	readonly leaseExpiresAt: string;
	readonly sessionId: string;
}): Promise<void> {
	await sqlClient.unsafe(
		`INSERT INTO github_evidence_collection
		 (id, organization_id, repository_id, installation_id, initiated_by_user_id,
		  session_id, context_id, commit_sha, attempt_number, retry_count, status,
		  source_version, coverage, started_at, lease_expires_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 0, 'collecting', 'integration',
		         '{}'::jsonb, $9, $10, $9, $9)`,
		[
			input.collectionId,
			organizationId,
			repositoryId,
			installationId,
			userId,
			input.sessionId,
			input.contextId,
			commitSha,
			"2026-09-20T11:45:00.000Z",
			input.leaseExpiresAt,
		],
	);
}
async function collectionRows(sessionId: string): Promise<
	ReadonlyArray<{
		attemptNumber: number;
		error: string | null;
		id: string;
		retryCount: number;
		retryOfCollectionId: string | null;
		status: string;
	}>
> {
	return sqlClient.unsafe(
		`SELECT id,
		        attempt_number AS "attemptNumber",
		        retry_count AS "retryCount",
		        retry_of_collection_id AS "retryOfCollectionId",
		        status,
		        error
		 FROM github_evidence_collection
		 WHERE organization_id = $1 AND session_id = $2
		 ORDER BY attempt_number`,
		[organizationId, sessionId],
	);
}
