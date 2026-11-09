import { expect, test } from "bun:test";
import { WORKSPACE_FEATURES } from "@rudel/api-routes";
import type postgres from "postgres";
import {
	disableExternalProviders,
	isSelfHosted,
	isSelfHostedAdmin,
	parseGitHubHistoryDays,
	SELF_HOSTED_DISABLED_ENV,
	selfHostedFeatureDefault,
} from "./self-hosted.js";

test("only OPALINE_SELF_HOSTED=1 turns the switch on", () => {
	expect(isSelfHosted({})).toBe(false);
	for (const value of ["", "0", "true", "yes", " 1", "1 "])
		expect(isSelfHosted({ OPALINE_SELF_HOSTED: value })).toBe(false);
	expect(isSelfHosted({ OPALINE_SELF_HOSTED: "1" })).toBe(true);
});

test("disabling external providers removes every billing, CRM, chat, analytics, error-reporting and GitHub App variable and nothing else", () => {
	const env: Record<string, string | undefined> = {
		PG_CONNECTION_STRING: "postgres://x",
		OPENAI_API_KEY: "sk-keep",
		RESEND_API_KEY: "re_keep",
		...Object.fromEntries(
			SELF_HOSTED_DISABLED_ENV.map((name) => [name, "set"]),
		),
	};
	expect(disableExternalProviders(env).sort()).toEqual(
		[...SELF_HOSTED_DISABLED_ENV].sort(),
	);
	expect(env).toEqual({
		PG_CONNECTION_STRING: "postgres://x",
		OPENAI_API_KEY: "sk-keep",
		RESEND_API_KEY: "re_keep",
	});
	expect(disableExternalProviders(env)).toEqual([]);
	for (const prefix of [
		"STRIPE_",
		"CRM_",
		"SLACK_",
		"POSTHOG_",
		"SENTRY_",
		"GITHUB_REPOSITORY_APP_",
	])
		expect(SELF_HOSTED_DISABLED_ENV.some((name) => name.includes(prefix))).toBe(
			true,
		);
});

test("self-hosted workspace features default on unless they need a provider that is not configured", () => {
	const bare = Object.fromEntries(
		WORKSPACE_FEATURES.map(({ key }) => [
			key,
			selfHostedFeatureDefault(key, {}),
		]),
	);
	expect(bare).toEqual({
		agent_traces: true,
		run_question_tags: false,
		moments: true,
		moment_observations: false,
		frustration_check: false,
		run_ci: true,
	});
	const providers = {
		ANTHROPIC_API_KEY: "a",
		SUBQ_API_KEY: "s",
	};
	for (const { key } of WORKSPACE_FEATURES)
		expect(selfHostedFeatureDefault(key, providers)).toBe(true);
	expect(
		selfHostedFeatureDefault("run_question_tags", { TYPESAFE_API_KEY: "t" }),
	).toBe(true);
});

test("the GitHub history horizon is 90 days unless set to 1 to 730 days", () => {
	expect(parseGitHubHistoryDays(undefined)).toBe(90);
	expect(parseGitHubHistoryDays(" ")).toBe(90);
	expect(parseGitHubHistoryDays("7")).toBe(7);
	expect(parseGitHubHistoryDays("730")).toBe(730);
	for (const value of ["0", "731", "-1", "1.5", "90d", "ninety"])
		expect(parseGitHubHistoryDays(value)).toBeNull();
});

test("a self-hosted admin is an owner or admin of the first workspace", async () => {
	const queries: string[] = [];
	const fakeSql = (answer: boolean) =>
		((strings: TemplateStringsArray, ...values: unknown[]) => {
			queries.push(strings.join("?"));
			expect(values).toEqual(["user-1"]);
			return Promise.resolve([{ admin: answer }]);
		}) as unknown as postgres.Sql;
	expect(await isSelfHostedAdmin(fakeSql(true), "user-1")).toBe(true);
	expect(await isSelfHostedAdmin(fakeSql(false), "user-1")).toBe(false);
	expect(queries[0]).toContain("m.role IN ('owner', 'admin')");
	expect(queries[0]).toContain("ORDER BY created_at, id LIMIT 1");
});
