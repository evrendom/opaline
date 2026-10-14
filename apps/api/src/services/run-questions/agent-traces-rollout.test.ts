import { afterEach, expect, test } from "bun:test";
import { agentTracesEnabled } from "./agent-traces-rollout.js";

/**
 * Which workspaces may open Agent traces: only those AGENT_TRACES_WORKSPACES
 * lists, every one with `*`, and nobody while it is unset.
 */

const LIST = "AGENT_TRACES_WORKSPACES";
const TEAM = "VITE_ADMIN_ORGANIZATION_ID";
const saved = { [LIST]: process.env[LIST], [TEAM]: process.env[TEAM] };
afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

test("only a listed workspace opens Agent traces, not even the team's otherwise", () => {
	process.env[TEAM] = "ws-team";
	process.env[LIST] = "ws-customer, ws-other";

	expect(agentTracesEnabled("ws-customer")).toBe(true);
	expect(agentTracesEnabled("ws-other")).toBe(true);
	expect(agentTracesEnabled("ws-team")).toBe(false);
	expect(agentTracesEnabled("")).toBe(false);
});

test("unset lists nobody; * lists everyone; * mixed with ids lists nobody", () => {
	process.env[TEAM] = "ws-team";
	delete process.env[LIST];
	expect(agentTracesEnabled("ws-team")).toBe(false);

	process.env[LIST] = "*";
	expect(agentTracesEnabled("ws-customer")).toBe(true);

	process.env[LIST] = "*,ws-customer";
	expect(agentTracesEnabled("ws-customer")).toBe(false);
});
