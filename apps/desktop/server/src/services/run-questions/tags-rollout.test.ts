import { afterEach, expect, test } from "bun:test";
import { runQuestionTagsEnabled } from "./tags-rollout.js";

/**
 * Which workspaces see run question tags in the dashboard: those
 * RUN_QUESTION_TAGS_WORKSPACES lists, every one with `*`, and only Opaline's
 * own (VITE_ADMIN_ORGANIZATION_ID) while it is unset.
 */

const LIST = "RUN_QUESTION_TAGS_WORKSPACES";
const TEAM = "VITE_ADMIN_ORGANIZATION_ID";
const saved = { [LIST]: process.env[LIST], [TEAM]: process.env[TEAM] };
afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

test("a listed workspace sees the tags; one that is not listed, the team's included, does not", () => {
	process.env[TEAM] = "ws-team";
	process.env[LIST] = "ws-owner, ws-data-1,ws-data-2";

	expect(runQuestionTagsEnabled("ws-owner")).toBe(true);
	expect(runQuestionTagsEnabled("ws-data-2")).toBe(true);
	expect(runQuestionTagsEnabled("ws-customer")).toBe(false);
	expect(runQuestionTagsEnabled("ws-team")).toBe(false);
	expect(runQuestionTagsEnabled("")).toBe(false);
});

test("* shows the tags to every workspace; * mixed with ids shows them to nobody", () => {
	process.env[LIST] = "*";
	expect(runQuestionTagsEnabled("ws-customer")).toBe(true);

	process.env[LIST] = "*,ws-owner";
	expect(runQuestionTagsEnabled("ws-owner")).toBe(false);
	expect(runQuestionTagsEnabled("ws-customer")).toBe(false);
});

test("unset or empty, only the team's workspace sees the tags; without a team workspace nobody does", () => {
	process.env[TEAM] = "ws-team";
	delete process.env[LIST];
	expect(runQuestionTagsEnabled("ws-team")).toBe(true);
	expect(runQuestionTagsEnabled("ws-customer")).toBe(false);

	process.env[LIST] = " ";
	expect(runQuestionTagsEnabled("ws-team")).toBe(true);

	delete process.env[LIST];
	delete process.env[TEAM];
	expect(runQuestionTagsEnabled("ws-team")).toBe(false);
});
