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
