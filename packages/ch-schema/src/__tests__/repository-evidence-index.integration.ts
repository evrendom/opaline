import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import {
	buildRepositoryEvidenceIndexDdl,
	REPOSITORY_EVIDENCE_INDEX_TABLE,
} from "../repository-evidence-index.js";

setDefaultTimeout(120_000);

const executor = createClickHouseExecutor({
	url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
	username:
		process.env.CLICKHOUSE_USERNAME ?? process.env.CLICKHOUSE_USER ?? "default",
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
	database: process.env.CLICKHOUSE_DB ?? "default",
});
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const database = `opaline_repository_evidence_test_${suffix}`;
const table = `\`${database}\`.\`${REPOSITORY_EVIDENCE_INDEX_TABLE}\``;
const contextId = "018f3e5a-7b2c-7d11-8abc-001122334455";

afterAll(async () => {
	await executor
		.execute(`DROP DATABASE IF EXISTS \`${database}\``)
		.catch(() => {});
});

describe("repository evidence index replacement state", () => {
	test("creates in an isolated database and selects the latest capture state", async () => {
		await executor.execute(`CREATE DATABASE \`${database}\``);
		await executor.execute(buildRepositoryEvidenceIndexDdl(database));

		await executor.execute(`${insertPrefix()} VALUES
			(${baseValues()}, 'collecting', NULL, 'partial',
				[('available-skills', 'partial', 'transcript coverage is incomplete')],
				['clickhouse-best-practices'],
				[('clickhouse-best-practices', 'unknown', 'session', 'session-1', 'partial', 'readable')],
				[('agents-instructions', 'repository', 'present', 'complete', 'readable', toUInt32(1)), ('plans', 'repository', 'unknown', 'truncated', 'truncated', toUInt32(0))],
				toUInt64(1), toDateTime64('2026-09-19 10:00:01.000', 3, 'UTC')),
			(${baseValues()}, 'complete', toDateTime64('2026-09-19 10:00:02.000', 3, 'UTC'), 'complete',
				[('available-skills', 'complete', '')],
				['clickhouse-best-practices'],
				[('clickhouse-best-practices', 'observed-used', 'session', 'session-1', 'complete', 'readable')],
				[('agents-instructions', 'repository', 'present', 'complete', 'readable', toUInt32(1)), ('plans', 'repository', 'absent', 'complete', 'unknown', toUInt32(0))],
				toUInt64(2), toDateTime64('2026-09-19 10:00:03.000', 3, 'UTC'))`);

		const rows = await executor.query<{
			capture_status: string;
			coverage_status: string;
			index_version: string;
			plan_presence: string;
			skill_assessment: string;
		}>(`SELECT
				toString(capture_status) AS capture_status,
				toString(coverage_status) AS coverage_status,
				toString(index_version) AS index_version,
				toString(tupleElement(arrayElement(context_facets, 2), 3)) AS plan_presence,
				toString(tupleElement(arrayElement(skill_assessments, 1), 2)) AS skill_assessment
			FROM ${table} FINAL
			WHERE organization_id = 'org-1'
				AND repository_id = 'github:123'
				AND worktree_id = 'worktree-1'
				AND session_source = 'codex'
				AND session_id = 'session-1'
				AND run_id = 'run-1'
				AND segment_id = 'segment-1'
				AND agent_id = 'agent-1'
				AND context_id = toUUID('${contextId}')`);

		expect(rows).toEqual([
			{
				capture_status: "complete",
				coverage_status: "complete",
				index_version: "2",
				plan_presence: "absent",
				skill_assessment: "observed-used",
			},
		]);
	});
});

function insertPrefix(): string {
	return `INSERT INTO ${table} (
		organization_id, user_id, repository_id, repository_provider, repository_host,
		repository_owner, repository_name, worktree_id, context_id, capture_id,
		parent_context_id, manifest_object_id, session_source, session_id, run_id,
		segment_id, agent_id, parent_agent_id, capture_lifecycle,
		capture_started_at, first_action_at, first_action_basis,
		first_action_relationship, capture_status, capture_completed_at,
		coverage_status, coverage_areas, available_skills, skill_assessments,
		context_facets, index_version, indexed_at
	)`;
}

function baseValues(): string {
	return `'org-1', 'user-1', 'github:123', 'github', 'github.com', 'opaline', 'api',
		'worktree-1', toUUID('${contextId}'), 'capture-1', NULL,
		'sha256:${"a".repeat(64)}', 'codex', 'session-1', 'run-1', 'segment-1',
		'agent-1', '', 'checkpoint',
		toDateTime64('2026-09-19 10:00:00.000', 3, 'UTC'), NULL,
		'unavailable', 'unknown'`;
}
