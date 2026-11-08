import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("../db.js", () => ({
	sqlClient: Object.assign(
		() => {
			throw new Error("Postgres reached");
		},
		{ unsafe: () => Promise.reject(new Error("Postgres reached")) },
	),
	db: {},
	ingestProcessingSqlClient: {},
	liveSessionSqlClient: {},
}));

const { WORKSPACE_FEATURES } = await import("@rudel/api-routes");
const { retroToolsEnabled } = await import(
	"../services/analysis/retro-tools.js"
);
const { embedsWorkspace } = await import(
	"../services/transcript-search/config.js"
);
const { analysisLogStore, getAnalysisLog, setAnalysisLogForTests } =
	await import("../services/analysis-log/config.js");
const { environmentDefault } = await import(
	"../services/workspace-features.js"
);
const { readPasswordAuthAllowlist } = await import("../password-auth.js");
const { isL1EdgeWorkerEnabled } = await import(
	"../services/l1-edges/l1-edge-worker.service.js"
);
const { readRunIndexHealConfig } = await import(
	"../services/l1-edges/run-index-heal.service.js"
);
const { assertCanStartOrganizationAgentRun } = await import(
	"../services/billing-entitlements.service.js"
);
const { mcpOpenToEveryone } = await import("../mcp/mcp-availability.js");
const { mcpStatsTool } = await import("../mcp/self-analytics-tools.js");
const { getStripeBillingConfiguration, getStripeClient } = await import(
	"../stripe-client.js"
);

const TOUCHED = [
	"OPALINE_SELF_HOSTED",
	"VITE_ADMIN_ORGANIZATION_ID",
	"RETRO_TOOLS_WORKSPACES",
	"RETRO_TOOLS_NEW_SINCE",
	"TRANSCRIPT_EMBEDDINGS_WORKSPACES",
	"ANALYSIS_LOG_STORE",
	"ANALYSIS_LOG_WORKSPACES",
	"AGENT_TRACES_WORKSPACES",
	"RUN_QUESTION_TAGS_WORKSPACES",
	"MOMENTS_WORKSPACES",
	"MOMENT_OBSERVATIONS_WORKSPACES",
	"FRUSTRATION_CHECK_WORKSPACES",
	"RUN_CI_WORKSPACES",
	"L1_EDGES_WORKER_ENABLED",
	"MCP_PLUGIN_PUBLIC",
	"STRIPE_SECRET_KEY",
	"STRIPE_BILLING_MODE",
	"ANTHROPIC_API_KEY",
	"SUBQ_API_KEY",
	"TYPESAFE_API_KEY",
	"GITHUB_REPOSITORY_APP_ID",
	"GITHUB_REPOSITORY_APP_PRIVATE_KEY",
] as const;
const saved = Object.fromEntries(
	TOUCHED.map((name) => [name, process.env[name]]),
);
beforeEach(() => {
	for (const name of TOUCHED) delete process.env[name];
});
afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	setAnalysisLogForTests(undefined);
});

const OFF_VALUES = [undefined, "0", "true", ""] as const;
function withSwitch(value: string | undefined) {
	if (value === undefined) delete process.env.OPALINE_SELF_HOSTED;
	else process.env.OPALINE_SELF_HOSTED = value;
}

describe("switch off: every gate answers as before", () => {
	for (const value of OFF_VALUES) {
		test(`OPALINE_SELF_HOSTED=${value ?? "(unset)"}`, async () => {
			withSwitch(value);
			process.env.VITE_ADMIN_ORGANIZATION_ID = "team";
			process.env.RETRO_TOOLS_WORKSPACES = "listed";
			expect(retroToolsEnabled({ id: "team", createdAt: null })).toBe(true);
			expect(retroToolsEnabled({ id: "listed", createdAt: null })).toBe(true);
			expect(retroToolsEnabled({ id: "other", createdAt: null })).toBe(false);

			process.env.TRANSCRIPT_EMBEDDINGS_WORKSPACES = "listed";
			expect(embedsWorkspace("listed")).toBe(true);
			expect(embedsWorkspace("other")).toBe(false);

			expect(analysisLogStore()).toBeNull();
			process.env.ANALYSIS_LOG_STORE = "convex";
			expect(analysisLogStore()).toBe("convex");
			process.env.ANALYSIS_LOG_STORE = "memory";
			expect(analysisLogStore()).toBe("memory");
			process.env.ANALYSIS_LOG_STORE = "other";
			expect(analysisLogStore()).toBeNull();
			const log = { marker: "log" } as unknown as NonNullable<
				ReturnType<typeof getAnalysisLog>
			>;
			setAnalysisLogForTests(log);
			process.env.ANALYSIS_LOG_WORKSPACES = "listed";
			expect(getAnalysisLog("listed")).toBe(log);
			expect(getAnalysisLog("other")).toBeNull();

			for (const { key } of WORKSPACE_FEATURES)
				expect(environmentDefault(key, "other")).toBe(false);
			expect(environmentDefault("run_question_tags", "team")).toBe(true);
			process.env.MOMENTS_WORKSPACES = "*";
			expect(environmentDefault("moments", "other")).toBe(true);

			expect(readPasswordAuthAllowlist(process.env)).toEqual({
				kind: "emails",
				emails: new Set(),
			});
			expect(
				readPasswordAuthAllowlist({
					OPALINE_SELF_HOSTED: value,
					PASSWORD_AUTH_EMAILS: "A@x.io",
					DEMO_ACCOUNT_EMAIL: "demo@x.io",
				}),
			).toEqual({ kind: "emails", emails: new Set(["a@x.io", "demo@x.io"]) });

			expect(isL1EdgeWorkerEnabled()).toBe(false);
			process.env.L1_EDGES_WORKER_ENABLED = "true";
			expect(isL1EdgeWorkerEnabled()).toBe(true);
			const heal = readRunIndexHealConfig({
				OPALINE_SELF_HOSTED: value,
				RETRO_TOOLS_WORKSPACES: "listed",
			});
			expect(heal.workerEnabled).toBe(false);
			expect(heal.retroOrganizationIds).toEqual(new Set(["listed"]));

			await expect(
				assertCanStartOrganizationAgentRun("org", "session"),
			).rejects.toThrow("Postgres reached");

			expect(mcpOpenToEveryone()).toBe(false);
			process.env.MCP_PLUGIN_PUBLIC = "true";
			expect(mcpOpenToEveryone()).toBe(true);

			process.env.STRIPE_BILLING_MODE = "live";
			process.env.STRIPE_SECRET_KEY = "sk_live_123";
			expect(getStripeClient()).not.toBeNull();
		});
	}
});

describe("switch on: a single-team install", () => {
	beforeEach(() => {
		withSwitch("1");
	});

	test("every workspace gets the retro tools, search and the analysis log in memory", () => {
		expect(retroToolsEnabled({ id: "any", createdAt: null })).toBe(true);
		expect(retroToolsEnabled({ id: "", createdAt: null })).toBe(false);
		expect(embedsWorkspace("any")).toBe(true);
		expect(embedsWorkspace("")).toBe(false);
		process.env.ANALYSIS_LOG_STORE = "convex";
		expect(analysisLogStore()).toBe("memory");
		const log = { marker: "log" } as unknown as NonNullable<
			ReturnType<typeof getAnalysisLog>
		>;
		setAnalysisLogForTests(log);
		expect(getAnalysisLog("any")).toBe(log);
		expect(getAnalysisLog("")).toBeNull();
	});

	test("workspace features follow the providers configured, not the environment lists", () => {
		process.env.RUN_QUESTION_TAGS_WORKSPACES = "*";
		expect(environmentDefault("agent_traces", "any")).toBe(true);
		expect(environmentDefault("moments", "any")).toBe(true);
		expect(environmentDefault("run_question_tags", "any")).toBe(false);
		expect(environmentDefault("moment_observations", "any")).toBe(false);
		process.env.ANTHROPIC_API_KEY = "key";
		expect(environmentDefault("moment_observations", "any")).toBe(true);
	});

	test("password sign-in, the L1 worker, MCP and the run limit are open", async () => {
		expect(readPasswordAuthAllowlist()).toEqual({ kind: "everyone" });
		process.env.L1_EDGES_WORKER_ENABLED = "false";
		expect(isL1EdgeWorkerEnabled()).toBe(true);
		const heal = readRunIndexHealConfig(process.env);
		expect(heal.workerEnabled).toBe(true);
		expect(heal.retroOrganizationIds).toBe("all");
		expect(mcpOpenToEveryone()).toBe(true);
		await expect(
			assertCanStartOrganizationAgentRun("org", "session"),
		).resolves.toBeUndefined();
	});

	test("Stripe is never configured or constructed", () => {
		process.env.STRIPE_BILLING_MODE = "live";
		process.env.STRIPE_SECRET_KEY = "sk_live_123";
		expect(getStripeClient()).toBeNull();
		expect(getStripeBillingConfiguration().configured).toBe(false);
	});
});

describe("mcp_stats", () => {
	const context = (id: string) => ({
		userId: "owner",
		workspace: { id, slug: id, createdAt: null },
		authSession: {} as never,
	});
	const executor = () => ({
		query: async <T>() => [] as T[],
	});
	const client = {} as never;

	test("refuses outside the team workspace unless self-hosted and the caller is the install's admin", async () => {
		const admin = mock(async () => true);
		const tool = mcpStatsTool(executor, Date.now, admin);
		process.env.VITE_ADMIN_ORGANIZATION_ID = "team";
		await expect(
			tool.run(client, { action: "stats" }, context("mine")),
		).rejects.toThrow("only available");
		expect(admin).not.toHaveBeenCalled();
		await expect(
			tool.run(client, { action: "stats" }, context("team")),
		).resolves.toContain("mcp_stats action=stats");

		withSwitch("1");
		await expect(
			tool.run(client, { action: "stats" }, context("mine")),
		).resolves.toContain("mcp_stats action=stats");
		expect(admin).toHaveBeenCalledWith("owner");
		const notAdmin = mcpStatsTool(executor, Date.now, async () => false);
		await expect(
			notAdmin.run(client, { action: "stats" }, context("mine")),
		).rejects.toThrow("only available");
	});
});
