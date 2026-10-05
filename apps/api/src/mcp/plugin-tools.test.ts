import { describe, expect, test } from "bun:test";
import {
	PLUGIN_PROCEDURES,
	PLUGIN_TOOLS,
	pluginInputSchema,
	withoutPersonalScores,
} from "./plugin-tools.js";

describe("plugin tools", () => {
	test("expose only analytics reads", () => {
		const names = PLUGIN_TOOLS.map((tool) => tool.name);

		expect(
			PLUGIN_PROCEDURES.every((path) => path.startsWith("analytics.")),
		).toBe(true);
		expect(new Set(names).size).toBe(PLUGIN_PROCEDURES.length);
		for (const write of [
			"profile__updateMine",
			"deleteOrganization",
			"billing__createCheckout",
			"teamInviteLink__create",
			"ingestSession",
		]) {
			expect(names).not.toContain(`app_${write}`);
		}
		// Plain names: no procedure paths or internal terms.
		for (const name of names)
			expect({ name, plain: /^app_[a-z]+(?:_[a-z]+)*$/u.test(name) }).toEqual({
				name,
				plain: true,
			});
		expect(names).toContain("app_dashboard_metrics");
		expect(names).toContain("app_session_outline");
		for (const tool of PLUGIN_TOOLS) {
			expect(tool.annotations).toEqual({
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			});
		}
	});

	test("are app-only with closed schemas that require a workspace", () => {
		for (const tool of PLUGIN_TOOLS) {
			const schema = JSON.stringify(tool.inputSchema);

			expect(tool.meta).toEqual({ ui: { visibility: ["app"] } });
			expect(schema).toContain('"workspace"');
			expect(schema).not.toContain('"additionalProperties":true');
		}
	});

	test("no success score is ever broken down by person", async () => {
		const breakdown = pluginInputSchema("analytics.sessions.dimensionAnalysis");
		const base = { workspace: "team", days: 30, dimension: "user_id" };
		expect(
			breakdown.safeParse({ ...base, metric: "avg_success_score" }).success,
		).toBe(false);
		expect(
			breakdown.safeParse({
				...base,
				dimension: "model_used",
				metric: "avg_success_score",
			}).success,
		).toBe(false);
		expect(
			breakdown.safeParse({ ...base, metric: "session_count" }).success,
		).toBe(true);
		const tool = PLUGIN_TOOLS.find(
			(candidate) => candidate.name === "app_sessions_breakdown",
		);
		expect(JSON.stringify(tool?.inputSchema)).not.toContain("success");

		const members = PLUGIN_TOOLS.find(
			(candidate) => candidate.name === "app_team_members",
		);
		const client = {
			analytics: {
				developers: {
					list: async () => [
						{
							user_id: "u1",
							total_sessions: 3,
							success_rate: 0.4,
							success_rate_trend: -0.1,
						},
					],
				},
			},
		};
		expect(
			await members?.run(
				client as never,
				{ workspace: "team", days: 7 },
				{
					userId: "u1",
					workspace: { id: "w", slug: "team" },
					authSession: {} as never,
				},
			),
		).toEqual([{ user_id: "u1", total_sessions: 3 }]);
		expect(
			withoutPersonalScores({
				rows: [{ user_id: "u", success_score: 1, model: "m" }],
				success_rate: 0.5,
			}),
		).toEqual({ rows: [{ user_id: "u", model: "m" }], success_rate: 0.5 });
	});

	test("the session filter options take only a date range", () => {
		const filters = PLUGIN_TOOLS.find(
			(tool) => tool.name === "app_sessions_filters",
		);
		const properties = Object.keys(
			(filters?.inputSchema.properties ?? {}) as Record<string, unknown>,
		).sort();
		expect(properties).toEqual(["days", "endDate", "startDate", "workspace"]);
		const schema = pluginInputSchema("analytics.sessions.filterCatalog");
		expect(
			schema.safeParse({
				workspace: "team",
				startDate: "2026-09-01",
				limit: 50,
			}).success,
		).toBe(false);
	});

	test("keep the contract's limits and variants", () => {
		const detail = pluginInputSchema("analytics.sessions.detailInitial");
		const list = pluginInputSchema("analytics.sessions.list");
		const window = pluginInputSchema("analytics.sessions.detailWindow");

		expect(
			detail.safeParse({ workspace: "team", sessionId: "s" }).success,
		).toBe(true);
		expect(detail.safeParse({ sessionId: "s" }).success).toBe(false);
		expect(
			detail.safeParse({ workspace: "team", sessionId: "s", extra: 1 }).success,
		).toBe(false);
		expect(list.safeParse({ workspace: "team", limit: -1 }).success).toBe(
			false,
		);
		expect(
			window.safeParse({
				workspace: "team",
				sessionId: "s",
				mode: "initial",
				includeBodies: true,
			}).success,
		).toBe(true);
		expect(
			window.safeParse({ workspace: "team", sessionId: "s", mode: "anchor" })
				.success,
		).toBe(false);
	});
});
