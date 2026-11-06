import { describe, expect, test } from "bun:test";
import {
	PLUGIN_PROCEDURES,
	PLUGIN_TOOLS,
	pluginInputSchema,
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
				idempotentHint: true,
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

	test("no tool offers a success score", () => {
		const breakdown = pluginInputSchema("analytics.sessions.dimensionAnalysis");
		const base = { workspace: "team", days: 30, dimension: "user_id" };
		expect(
			breakdown.safeParse({ ...base, metric: "avg_success_score" }).success,
		).toBe(false);
		expect(
			breakdown.safeParse({ ...base, metric: "session_count" }).success,
		).toBe(true);
		for (const tool of PLUGIN_TOOLS) {
			expect(JSON.stringify(tool.inputSchema)).not.toMatch(
				/success_score|success_rate|avg_success/u,
			);
		}
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
