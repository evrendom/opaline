import { describe, expect, test } from "bun:test";
import { buildRunIndexCensusStatement } from "../l1-edges/run-index-census.service.js";
import { buildCommittedRunIndexStatement } from "./run-index-reader.js";

const scope = { organizationId: "org", userId: "u" };

describe("run index reads", () => {
	test("read only the committed snapshot: the newest receipt's build", () => {
		const { query, query_params } = buildCommittedRunIndexStatement(
			scope,
			["s"],
			"run",
		);
		expect(query).toContain(
			"(session_id, revision, parser_version, index_version, build_revision) IN",
		);
		expect(query).toContain(
			"max((revision, parser_version, index_version, build_revision)) AS committed",
		);
		expect(query).toContain("WHERE organization_id = {organizationId:String}");
		expect(query_params).toMatchObject({ sessionIds: ["s"], kind: "run" });
	});

	test("keeps every column as stored: no text is nulled by its age", () => {
		const { query } = buildCommittedRunIndexStatement(scope, ["s"]);
		expect(query).not.toMatch(/toIntervalDay|today\(\)|NULL, /);
		expect(query).not.toContain("prompt_head");
		expect(query).toContain("toString(revision) AS revision");
	});

	test("the census queues missing or stale snapshots against the newest usage receipt", () => {
		const { query, query_params } = buildRunIndexCensusStatement(
			"codex",
			Date.UTC(2026, 9, 9),
		);
		expect(query).toContain("WHERE indexed.present = 0");
		expect(query).toContain(
			"splitByChar(':', indexed.committed.5)[1] != usage_receipts.usage_generation",
		);
		expect(query).toContain("FROM rudel.codex_sessions");
		expect(query_params).toMatchObject({ source: "codex", limit: 500 });
	});
});
