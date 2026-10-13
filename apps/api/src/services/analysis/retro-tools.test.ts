import { afterEach, expect, test } from "bun:test";
import { RETRO_TOOLS_OFF, retroToolsEnabled } from "./retro-tools.js";

/**
 * Which workspaces may call the retro tools (schema, sql, search, run,
 * estimate_questions, run_questions): those RETRO_TOOLS_WORKSPACES lists,
 * every one with `*`, and only Opaline's own (VITE_ADMIN_ORGANIZATION_ID)
 * while it is unset.
 */

const LIST = "RETRO_TOOLS_WORKSPACES";
const TEAM = "VITE_ADMIN_ORGANIZATION_ID";
const saved = { [LIST]: process.env[LIST], [TEAM]: process.env[TEAM] };
afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

test("a listed workspace has the retro tools; one that is not listed, the team's included, does not", () => {
	process.env[TEAM] = "ws-team";
	process.env[LIST] = "ws-owner, ws-data-1,ws-data-2";

	expect(retroToolsEnabled("ws-owner")).toBe(true);
	expect(retroToolsEnabled("ws-data-1")).toBe(true);
	expect(retroToolsEnabled("ws-data-2")).toBe(true);
	expect(retroToolsEnabled("ws-customer")).toBe(false);
	expect(retroToolsEnabled("ws-team")).toBe(false);
	expect(retroToolsEnabled("")).toBe(false);
});

test("* gives every workspace the retro tools", () => {
	process.env[LIST] = "*";

	expect(retroToolsEnabled("ws-customer")).toBe(true);
	expect(retroToolsEnabled("ws-other")).toBe(true);
});

test("* mixed with ids is invalid and gives nobody the retro tools", () => {
	process.env[LIST] = "*,ws-owner";

	expect(retroToolsEnabled("ws-owner")).toBe(false);
	expect(retroToolsEnabled("ws-customer")).toBe(false);
});

test("unset or empty, only the team's workspace has the retro tools; without a team workspace nobody does", () => {
	process.env[TEAM] = "ws-team";
	delete process.env[LIST];
	expect(retroToolsEnabled("ws-team")).toBe(true);
	expect(retroToolsEnabled("ws-customer")).toBe(false);

	process.env[LIST] = " ";
	expect(retroToolsEnabled("ws-team")).toBe(true);
	expect(retroToolsEnabled("ws-customer")).toBe(false);

	delete process.env[LIST];
	delete process.env[TEAM];
	expect(retroToolsEnabled("ws-team")).toBe(false);
	expect(retroToolsEnabled("")).toBe(false);
});

test("the refusal tells the agent not to retry and to use find and read", () => {
	expect(RETRO_TOOLS_OFF).toBe(
		"refused, do not retry: The retro tools are not enabled for this workspace yet; use find and read.",
	);
});
