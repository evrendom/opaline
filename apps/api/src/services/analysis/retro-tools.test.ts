import { afterEach, expect, test } from "bun:test";
import {
	RETRO_TOOLS_OFF,
	type RetroWorkspace,
	retroToolsEnabled,
	retroToolsNewSince,
} from "./retro-tools.js";

/**
 * Which workspaces may call the retro tools (schema, sql, search, run,
 * estimate_questions, run_questions): Opaline's own
 * (VITE_ADMIN_ORGANIZATION_ID) always, those created on or after
 * RETRO_TOOLS_NEW_SINCE, and those RETRO_TOOLS_WORKSPACES lists or every one
 * with `*`.
 */

const LIST = "RETRO_TOOLS_WORKSPACES";
const TEAM = "VITE_ADMIN_ORGANIZATION_ID";
const SINCE = "RETRO_TOOLS_NEW_SINCE";
const saved = {
	[LIST]: process.env[LIST],
	[TEAM]: process.env[TEAM],
	[SINCE]: process.env[SINCE],
};
afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

const OLD = new Date("2026-10-01T12:00:00Z");
const NEW = new Date("2026-11-06T00:00:00Z");
const ws = (
	id: string,
	createdAt: Date | string | null = OLD,
): RetroWorkspace => ({
	id,
	createdAt,
});

test("a listed workspace has the retro tools; one that is not listed does not", () => {
	process.env[TEAM] = "ws-team";
	process.env[LIST] = "ws-owner, ws-data-1,ws-data-2";
	delete process.env[SINCE];

	expect(retroToolsEnabled(ws("ws-owner"))).toBe(true);
	expect(retroToolsEnabled(ws("ws-data-1"))).toBe(true);
	expect(retroToolsEnabled(ws("ws-data-2"))).toBe(true);
	expect(retroToolsEnabled(ws("ws-customer"))).toBe(false);
	expect(retroToolsEnabled(ws(""))).toBe(false);
});

test("the admin workspace always has the retro tools, whatever the list says", () => {
	process.env[TEAM] = "ws-team";
	for (const list of [undefined, " ", "ws-owner", "*", "*,ws-owner"]) {
		if (list === undefined) delete process.env[LIST];
		else process.env[LIST] = list;
		expect(retroToolsEnabled(ws("ws-team"))).toBe(true);
		expect(retroToolsEnabled(ws("ws-team", null))).toBe(true);
	}
	delete process.env[TEAM];
	delete process.env[LIST];
	expect(retroToolsEnabled(ws("ws-team"))).toBe(false);
	expect(retroToolsEnabled(ws(""))).toBe(false);
});

test("a workspace created on or after RETRO_TOOLS_NEW_SINCE has the retro tools; an older one only when listed", () => {
	process.env[TEAM] = "ws-team";
	process.env[LIST] = "ws-owner";
	process.env[SINCE] = "2026-11-06";

	expect(retroToolsEnabled(ws("ws-new", NEW))).toBe(true);
	expect(
		retroToolsEnabled(ws("ws-later", new Date("2026-12-24T08:00:00Z"))),
	).toBe(true);
	expect(
		retroToolsEnabled(ws("ws-eve", new Date("2026-11-05T23:59:59.999Z"))),
	).toBe(false);
	expect(retroToolsEnabled(ws("ws-old", OLD))).toBe(false);
	expect(retroToolsEnabled(ws("ws-owner", OLD))).toBe(true);
	expect(retroToolsEnabled(ws("ws-unknown", null))).toBe(false);

	delete process.env[LIST];
	expect(retroToolsEnabled(ws("ws-new", NEW))).toBe(true);
	expect(retroToolsEnabled(ws("ws-old", OLD))).toBe(false);
});

test("a creation time read as Postgres text is compared as a time", () => {
	process.env[SINCE] = "2026-11-06";
	expect(retroToolsEnabled(ws("ws-new", "2026-11-06 01:00:00.5+02"))).toBe(
		false,
	);
	expect(retroToolsEnabled(ws("ws-new", "2026-11-06 00:00:00+00"))).toBe(true);
	expect(retroToolsEnabled(ws("ws-new", "2026-11-05 23:00:00-02"))).toBe(true);
	expect(retroToolsEnabled(ws("ws-garbled", "not a time"))).toBe(false);
});

test("RETRO_TOOLS_NEW_SINCE takes a UTC time too", () => {
	process.env[SINCE] = "2026-11-06T12:00:00Z";
	expect(retroToolsNewSince()?.toISOString()).toBe("2026-11-06T12:00:00.000Z");
	expect(retroToolsEnabled(ws("ws-morning", NEW))).toBe(false);
	expect(
		retroToolsEnabled(ws("ws-noon", new Date("2026-11-06T12:00:00Z"))),
	).toBe(true);
});

test("unset or empty, RETRO_TOOLS_NEW_SINCE gates nothing by date", () => {
	process.env[TEAM] = "ws-team";
	delete process.env[LIST];
	for (const since of [undefined, "", " "]) {
		if (since === undefined) delete process.env[SINCE];
		else process.env[SINCE] = since;
		expect(retroToolsNewSince()).toBeNull();
		expect(retroToolsEnabled(ws("ws-new", NEW))).toBe(false);
		expect(retroToolsEnabled(ws("ws-team", NEW))).toBe(true);
	}
});

test("an invalid RETRO_TOOLS_NEW_SINCE gives nobody the retro tools by date", () => {
	process.env[TEAM] = "ws-team";
	process.env[LIST] = "ws-owner";
	for (const since of [
		"yesterday",
		"2026-02-30",
		"2026-11-6",
		"2026-11-06T00:00:00",
		"2026-11-06T00:00:00+01:00",
		"0",
	]) {
		process.env[SINCE] = since;
		expect(retroToolsNewSince()).toBeNull();
		expect(retroToolsEnabled(ws("ws-new", NEW))).toBe(false);
		expect(retroToolsEnabled(ws("ws-owner"))).toBe(true);
		expect(retroToolsEnabled(ws("ws-team"))).toBe(true);
	}
});

test("* gives every workspace the retro tools, old or new", () => {
	process.env[LIST] = "*";
	process.env[SINCE] = "2026-11-06";

	expect(retroToolsEnabled(ws("ws-customer", OLD))).toBe(true);
	expect(retroToolsEnabled(ws("ws-other", null))).toBe(true);
	expect(retroToolsEnabled(ws("ws-new", NEW))).toBe(true);
});

test("* mixed with ids is invalid and lists nobody; the admin and new workspaces keep the retro tools", () => {
	process.env[TEAM] = "ws-team";
	process.env[LIST] = "*,ws-owner";
	process.env[SINCE] = "2026-11-06";

	expect(retroToolsEnabled(ws("ws-owner"))).toBe(false);
	expect(retroToolsEnabled(ws("ws-customer"))).toBe(false);
	expect(retroToolsEnabled(ws("ws-team"))).toBe(true);
	expect(retroToolsEnabled(ws("ws-new", NEW))).toBe(true);
});

test("the refusal tells the agent not to retry and to use find and read", () => {
	expect(RETRO_TOOLS_OFF).toBe(
		"refused, do not retry: The retro tools are not enabled for this workspace yet; use find and read.",
	);
});
