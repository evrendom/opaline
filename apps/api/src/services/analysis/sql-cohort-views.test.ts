import { expect, test } from "bun:test";
import { SQL_VIEWS } from "./sql-views.js";

const COHORT = "(user_id, session_id) IN (SELECT arrayJoin(opaline_cohort))";
const view = (name: string) => {
	const found = SQL_VIEWS.find((item) => item.name === name);
	if (!found) throw new Error(`no view ${name}`);
	return found;
};

test("a cohort holds the session views to its sessions and leaves them whole without one", () => {
	for (const name of ["runs", "calls", "prompts", "setup_files"]) {
		expect({
			name,
			held: view(name)
				.sql(false, { cohort: "opaline_cohort" })
				.includes(COHORT),
		}).toEqual({ name, held: true });
		expect({
			name,
			held: view(name).sql(false, {}).includes("opaline_cohort"),
		}).toEqual({ name, held: false });
	}
});

test("calls still finds the calls a forked Codex session replays from a parent outside the cohort", () => {
	const calls = view("calls").sql(false, { cohort: "opaline_cohort" });
	const parent = calls.slice(
		calls.indexOf("parent_calls AS ("),
		calls.indexOf("replayed_calls AS ("),
	);
	expect(parent).toContain("organization_id = {opaline_workspace:String}");
	expect(parent).not.toContain("opaline_cohort");
});
