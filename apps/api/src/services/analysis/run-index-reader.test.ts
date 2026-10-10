import { describe, expect, test } from "bun:test";
import { RUN_INDEX_TEXT_COLUMNS } from "@rudel/ch-schema/run-index";
import { buildRunIndexCensusStatement } from "../l1-edges/run-index-census.service.js";
import {
	buildCommittedRunIndexStatement,
	expireRunIndexText,
	isRunIndexTextExpired,
} from "./run-index-reader.js";

const DAY = 86_400_000;
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

	test("expired text reads NULL whatever the merges did", () => {
		const { query } = buildCommittedRunIndexStatement(scope, ["s"]);
		for (const column of RUN_INDEX_TEXT_COLUMNS)
			expect(query).toContain(
				`if(toDate(session_date) + toIntervalDay(365) <= today(), NULL, ${column}) AS ${column}`,
			);
		expect(query).toContain("toString(revision) AS revision");
	});

	test("text expires on the day the column TTL is reached", () => {
		const sessionDate = Date.UTC(2025, 9, 9, 23, 0);
		expect(isRunIndexTextExpired(sessionDate, sessionDate + 364 * DAY)).toBe(
			false,
		);
		expect(isRunIndexTextExpired(sessionDate, Date.UTC(2026, 9, 9))).toBe(true);
		const row = { prompt_head: "fix", goal: "ship", tool_calls: 3 };
		expect(
			expireRunIndexText(row, sessionDate, Date.UTC(2026, 9, 9)),
		).toMatchObject({
			prompt_head: null,
			goal: null,
			title: null,
			tool_calls: 3,
		});
		expect(expireRunIndexText(row, sessionDate, sessionDate)).toBe(row);
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
