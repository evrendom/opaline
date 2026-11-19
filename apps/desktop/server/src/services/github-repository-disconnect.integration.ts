import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { sqlClient } from "../db.js";
import { disconnectGitHubRepositoryInstallation } from "./github-repository-disconnect.service.js";

const suffix = randomUUID();
const userId = `github-disconnect-user-${suffix}`;
const organizationId = `github-disconnect-org-${suffix}`;
const otherOrganizationId = `github-disconnect-other-${suffix}`;
const emptyOrganizationId = `github-disconnect-empty-${suffix}`;
const numericSuffix = BigInt(`0x${suffix.replaceAll("-", "").slice(0, 12)}`);
const installationId = (numericSuffix + 1n).toString();
const otherInstallationId = (numericSuffix + 2n).toString();
const config = {
	appId: "12345",
	privateKeyPem: generateKeyPairSync("rsa", { modulusLength: 2048 })
		.privateKey.export({ format: "pem", type: "pkcs8" })
		.toString(),
	slug: "opaline-disconnect-integration",
};

function githubResponding(status: number) {
	const calls: Array<{ method: string; url: string; authorization: string }> =
		[];
	const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({
			authorization: new Headers(init?.headers).get("Authorization") ?? "",
			method: init?.method ?? "GET",
			url: String(url),
		});
		return new Response(null, { status });
	}) as typeof globalThis.fetch;
	return { calls, fetch };
}

async function seedInstallation(org: string, installation: string) {
	await sqlClient.unsafe(
		`INSERT INTO github_app_installation
		 (installation_id, organization_id, account_id, account_login, account_type,
		  repository_selection, permissions, status, installed_by_user_id)
		 VALUES ($1, $2, '1', 'opalinehq', 'Organization', 'selected', '{}'::jsonb,
		         'active', $3)
		 ON CONFLICT (installation_id) DO UPDATE SET status = 'active'`,
		[installation, org, userId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_repository_binding
		 (organization_id, repository_id, installation_id, node_id, owner, name,
		  full_name, default_branch, is_private, status)
		 VALUES ($1, $2, $3, $4, 'opalinehq', 'athena', 'opalinehq/athena', 'main',
		         true, 'active')
		 ON CONFLICT (organization_id, repository_id) DO UPDATE SET status = 'active', installation_id = EXCLUDED.installation_id`,
		[org, `${installation}55`, installation, `node-${installation}`],
	);
}

async function readState(org: string) {
	const [installation] = await sqlClient.unsafe<Array<{ status: string }>>(
		"SELECT status FROM github_app_installation WHERE organization_id = $1",
		[org],
	);
	const bindings = await sqlClient.unsafe<Array<{ status: string }>>(
		"SELECT status FROM github_repository_binding WHERE organization_id = $1",
		[org],
	);
	return {
		bindings: bindings.map(({ status }) => status),
		installation: installation?.status,
	};
}

beforeAll(async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email) VALUES ($1, 'GitHub Disconnect', $2)`,
		[userId, `${userId}@example.test`],
	);
	for (const id of [organizationId, otherOrganizationId, emptyOrganizationId])
		await sqlClient.unsafe(
			"INSERT INTO organization (id, name, slug) VALUES ($1, 'GitHub Disconnect', $1)",
			[id],
		);
});

beforeEach(async () => {
	await seedInstallation(organizationId, installationId);
	await seedInstallation(otherOrganizationId, otherInstallationId);
});

afterAll(async () => {
	await sqlClient.unsafe(
		"DELETE FROM organization WHERE id = ANY($1::text[])",
		[[organizationId, otherOrganizationId, emptyOrganizationId]],
	);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
});

describe("GitHub disconnect", () => {
	test("uninstalls on GitHub, then hides the workspace's installation and repositories", async () => {
		const github = githubResponding(204);

		const result = await disconnectGitHubRepositoryInstallation({
			database: sqlClient,
			fetch: github.fetch,
			organizationId,
			readConfig: () => config,
		});

		expect(result).toBe("disconnected");
		expect(github.calls).toHaveLength(1);
		expect(github.calls[0]).toMatchObject({
			method: "DELETE",
			url: `https://api.github.com/app/installations/${installationId}`,
		});
		expect(github.calls[0]?.authorization).toStartWith("Bearer ");
		expect(await readState(organizationId)).toEqual({
			bindings: ["removed"],
			installation: "deleted",
		});
		const [readiness] = await sqlClient.unsafe<Array<{ active: boolean }>>(
			`SELECT (details->>'activeInstallation')::boolean AS active FROM organization_feature_readiness WHERE organization_id = $1 AND feature = 'pr_totals'`,
			[organizationId],
		);
		expect(readiness?.active).toBe(false);
	});

	test("never touches another workspace's installation", async () => {
		await disconnectGitHubRepositoryInstallation({
			database: sqlClient,
			fetch: githubResponding(204).fetch,
			organizationId,
			readConfig: () => config,
		});

		expect(await readState(otherOrganizationId)).toEqual({
			bindings: ["active"],
			installation: "active",
		});
	});

	test("treats an installation already removed on GitHub as disconnected", async () => {
		const result = await disconnectGitHubRepositoryInstallation({
			database: sqlClient,
			fetch: githubResponding(404).fetch,
			organizationId,
			readConfig: () => config,
		});

		expect(result).toBe("disconnected");
		expect((await readState(organizationId)).installation).toBe("deleted");
	});

	test("changes nothing locally when GitHub refuses", async () => {
		const result = await disconnectGitHubRepositoryInstallation({
			database: sqlClient,
			fetch: githubResponding(500).fetch,
			organizationId,
			readConfig: () => config,
		});

		expect(result).toBe("github-failed");
		expect(await readState(organizationId)).toEqual({
			bindings: ["active"],
			installation: "active",
		});
	});

	test("does not call GitHub for a workspace without a connection", async () => {
		const github = githubResponding(204);

		const result = await disconnectGitHubRepositoryInstallation({
			database: sqlClient,
			fetch: github.fetch,
			organizationId: emptyOrganizationId,
			readConfig: () => config,
		});

		expect(result).toBe("not-connected");
		expect(github.calls).toHaveLength(0);
	});
});
