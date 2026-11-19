import { describe, expect, test } from "bun:test";
import { SETUP_SNAPSHOT_COLUMNS } from "./sql-setup-views.js";
import { findSqlView } from "./sql-views.js";

describe("setup_snapshots view", () => {
	const view = findSqlView("setup_snapshots");

	test("is a registered view whose statement returns its documented columns", () => {
		expect(view?.columns).toBe(SETUP_SNAPSHOT_COLUMNS);
		const sql = view?.sql(false) ?? "";
		expect(sql).toStartWith(
			`SELECT ${SETUP_SNAPSHOT_COLUMNS.map((column) => column.name).join(", ")} FROM (`,
		);
		// Files, settings items and runtime fields, each from captures that recorded setup.
		expect(
			sql.match(/ARRAY JOIN (setup_files|setup_settings|runtime_versions) AS/g),
		).toHaveLength(3);
		expect(sql.match(/notEmpty\(context_roots\)/g)).toHaveLength(3);
		expect(sql).toContain("FROM rudel.repository_session_evidence_index FINAL");
	});

	test("reads only the workspace, and only the member's own captures when held to them", () => {
		const workspace = "organization_id = {opaline_workspace:String}";
		const member = `${workspace} AND user_id = {opaline_member:String}`;
		expect(view?.sql(false)).toContain(`WHERE ${workspace} AND notEmpty`);
		expect(view?.sql(false)).not.toContain("opaline_member");
		expect(view?.sql(true).split(`WHERE ${member} AND notEmpty`)).toHaveLength(
			4,
		);
	});

	test("names files as setup_files does, so a file on disk joins what a run received", () => {
		const sql = view?.sql(false) ?? "";
		expect(sql).toContain("concat('repository:', repository, ':', path)");
		expect(sql).toContain("concat('member:', user_id, ':~/', h0[1])");
		expect(sql).toContain("concat('plugin:', p0[2], '@', p0[1], ':', p0[3])");
	});

	test("says when a capture is late, and why", () => {
		const names = SETUP_SNAPSHOT_COLUMNS.map((column) => column.name);
		expect(names).toContain("at_session_time");
		expect(names).toContain("capture_reason");
		expect(view?.sql(false)).toContain(
			"toBool(capture_reason = '') AS at_session_time",
		);
	});
});

describe("runs coverage", () => {
	test("setup_snapshot is a gap only for runs whose session has no capture at session time", () => {
		const sql = findSqlView("runs")?.sql(false) ?? "";
		expect(sql).toContain(
			"if((r.user_id, r.session_id) IN (SELECT user_id, session_id FROM rudel.repository_session_evidence_index",
		);
		expect(sql).toContain(
			"notEmpty(context_roots) AND capture_reason = ''), [], ['setup_snapshot'])",
		);
		expect(sql).not.toContain("['setup_snapshot'],");
	});
});
