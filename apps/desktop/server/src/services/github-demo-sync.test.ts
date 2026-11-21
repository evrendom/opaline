import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import { readGitHubSyncSkippedOrgIds } from "../lib/env.js";
import {
	collectAndPersistGitHubCommitEvidence,
	enqueueGitHubEvidenceCollection,
} from "./github-evidence-persistence.service.js";
import { runGitHubRepositorySweep } from "./github-repository-sweep.service.js";
import type { R2EvidenceStorageClient } from "./r2-ingest-storage.service.js";

const DEMO_ORG = "1zKtWzbRInKT6uNOqgXdcEGinGo2rXuW";
const DEMO_ENV = { DEMO_ORGANIZATION_ID: DEMO_ORG };
const tokenReads: string[] = [];
const config = {
	kind: "token" as const,
	host: "github.com",
	apiBaseUrl: "https://api.github.com",
	read: async () => {
		tokenReads.push("read");
		return "fixture";
	},
};

function untouchedDatabase(): postgres.Sql {
	const refuse = () => {
		throw new Error("the demo workspace touched Postgres");
	};
	return { unsafe: refuse, begin: refuse } as unknown as postgres.Sql;
}

function recordingDatabase() {
	const statements: Array<{ query: string; params: unknown[] }> = [];
	const database = {
		unsafe: async (query: string, params: unknown[] = []) => {
			statements.push({ query, params });
			return query.includes("SELECT EXISTS") ? [{ exists: false }] : [];
		},
		begin: () => {
			throw new Error("no binding should be swept");
		},
	} as unknown as postgres.Sql;
	return { database, statements };
}

describe("workspaces whose GitHub data is seeded, not synced", () => {
	test("are the demo workspace when DEMO_ORGANIZATION_ID is set", () => {
		expect(readGitHubSyncSkippedOrgIds({})).toEqual([]);
		expect(readGitHubSyncSkippedOrgIds({ DEMO_ORGANIZATION_ID: "  " })).toEqual(
			[],
		);
		expect(
			readGitHubSyncSkippedOrgIds({ DEMO_ORGANIZATION_ID: ` ${DEMO_ORG} ` }),
		).toEqual([DEMO_ORG]);
	});

	test("the sweep leaves their bindings out of every pass and of the pending check", async () => {
		const { database, statements } = recordingDatabase();
		const result = await runGitHubRepositorySweep({
			database,
			config,
			environment: DEMO_ENV,
		});
		expect(result).toEqual({ enabled: true, requests: 0, hasMore: false });
		expect(tokenReads).toEqual([]);
		expect(statements).toHaveLength(2);
		for (const statement of statements) {
			expect(statement.query).toContain("<> ALL($2::text[])");
			expect(statement.params).toEqual([null, [DEMO_ORG]]);
		}
	});

	test("the sweep skips nobody when DEMO_ORGANIZATION_ID is unset", async () => {
		const { database, statements } = recordingDatabase();
		await runGitHubRepositorySweep({ database, config, environment: {} });
		expect(statements.map((statement) => statement.params)).toEqual([
			[null, []],
			[null, []],
		]);
	});

	test("evidence collection is never queued for them", async () => {
		expect(
			await enqueueGitHubEvidenceCollection({
				commitSha: "a".repeat(40),
				contextId: null,
				database: untouchedDatabase(),
				environment: DEMO_ENV,
				initiatedByUserId: "user",
				organizationId: DEMO_ORG,
				repositoryId: "812734519",
				sessionId: "session",
				sessionSource: "claude_code",
				sessionUserId: "user",
			}),
		).toEqual({ collectionId: null, status: "skipped" });
	});

	test("a direct evidence sync finds no binding and asks GitHub for nothing", async () => {
		tokenReads.length = 0;
		await expect(
			collectAndPersistGitHubCommitEvidence({
				commitSha: "a".repeat(40),
				config,
				contextId: null,
				database: untouchedDatabase(),
				environment: DEMO_ENV,
				initiatedByUserId: "user",
				organizationId: DEMO_ORG,
				r2: {} as R2EvidenceStorageClient,
				repositoryId: "812734519",
				sessionId: "session",
			}),
		).rejects.toThrow("GitHub repository binding was not found.");
		expect(tokenReads).toEqual([]);
	});
});
