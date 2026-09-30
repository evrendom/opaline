import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import repositoryEvidenceIndexSchema from "../db/schema/repository-evidence-index.js";
import {
	buildRepositoryEvidenceIndexDdl,
	REPOSITORY_EVIDENCE_INDEX_TABLE,
} from "../repository-evidence-index.js";

const REQUIRED_COLUMNS = [
	"organization_id",
	"user_id",
	"repository_id",
	"worktree_id",
	"context_id",
	"capture_id",
	"session_source",
	"session_id",
	"run_id",
	"segment_id",
	"agent_id",
	"capture_lifecycle",
	"capture_status",
	"capture_started_at",
	"capture_completed_at",
	"first_action_at",
	"coverage_status",
	"coverage_areas",
	"available_skills",
	"skill_assessments",
	"context_facets",
	"index_version",
	"indexed_at",
] as const;

const REPLACEMENT_KEY: string[] = [
	"organization_id",
	"repository_id",
	"worktree_id",
	"session_source",
	"session_id",
	"run_id",
	"segment_id",
	"agent_id",
	"context_id",
];

describe("repository evidence index physical schema", () => {
	test("keeps query scope and immutable capture identity in the replacing key", () => {
		const definition = findTableDefinition(repositoryEvidenceIndexSchema);

		expect(definition.engine).toBe("SharedReplacingMergeTree(index_version)");
		expect(definition.primaryKey).toEqual(REPLACEMENT_KEY);
		expect(definition.orderBy).toEqual(REPLACEMENT_KEY);
		expect(definition).not.toHaveProperty("partitionBy");
		expect(definition.settings).toMatchObject({
			index_granularity: "8192",
			non_replicated_deduplication_window: "1000",
		});
	});

	test("indexes lifecycle, coverage, available skill use, and context facets", () => {
		const definition = findTableDefinition(repositoryEvidenceIndexSchema);
		const columns = new Map(
			definition.columns.map((column) => [column.name, column]),
		);

		for (const name of REQUIRED_COLUMNS) expect(columns.has(name)).toBe(true);
		expect(columns.get("capture_lifecycle")?.type).toContain("Enum8(");
		expect(columns.get("capture_status")?.type).toContain("Enum8(");
		expect(columns.get("coverage_status")?.type).toContain("Enum8(");
		expect(columns.get("available_skills")?.type).toBe("Array(String)");
		expect(columns.get("skill_assessments")?.type).toContain("observed-used");
		expect(columns.get("skill_assessments")?.type).toContain("no-observed-use");
		expect(columns.get("skill_assessments")?.type).toContain("unknown");
		expect(columns.get("context_facets")?.type).toContain(
			"agents-instructions",
		);
		expect(columns.get("context_facets")?.type).toContain(
			"claude-instructions",
		);
		expect(columns.get("context_facets")?.type).toContain("plans");
		expect(columns.get("context_facets")?.type).toContain("hooks");
		expect(columns.get("context_facets")?.type).toContain("mcp");
		expect(columns.get("context_facets")?.type).toContain("package-context");
		expect(columns.get("context_facets")?.type).toContain("present");
		expect(columns.get("context_facets")?.type).toContain("absent");
		expect(columns.get("context_facets")?.type).toContain("unknown");
		expect(columns.get("capture_completed_at")?.nullable).toBe(true);
		expect(columns.get("first_action_at")?.nullable).toBe(true);
	});

	test("builds database-scoped portable DDL without a baked-in product database", () => {
		const ddl = buildRepositoryEvidenceIndexDdl("evidence_test_db");

		expect(ddl).toContain(
			`CREATE TABLE IF NOT EXISTS \`evidence_test_db\`.\`${REPOSITORY_EVIDENCE_INDEX_TABLE}\``,
		);
		expect(ddl).toContain("ENGINE = ReplacingMergeTree(index_version)");
		expect(ddl).toContain(
			"ORDER BY (organization_id, repository_id, worktree_id, session_source, session_id, run_id, segment_id, agent_id, context_id)",
		);
		expect(ddl).not.toContain("rudel");
		expect(ddl).not.toContain("PARTITION BY");
		expect(() =>
			buildRepositoryEvidenceIndexDdl("unsafe; DROP DATABASE default"),
		).toThrow("Unsafe ClickHouse identifier");
	});

	test("checks in the production create-table migration", async () => {
		const migration = await readFile(
			fileURLToPath(
				new URL(
					"../../chx/migrations/20260930120000_repository_evidence_index.sql",
					import.meta.url,
				),
			),
			"utf8",
		);

		expect(migration).toContain(
			"CREATE TABLE IF NOT EXISTS rudel.repository_session_evidence_index",
		);
		expect(migration).toContain("ENGINE = ReplacingMergeTree(index_version)");
		expect(migration).toContain("`skill_assessments` Array(Tuple(");
		expect(migration).toContain("`context_facets` Array(Tuple(");
		expect(migration).toContain(
			"ORDER BY (`organization_id`, `repository_id`, `worktree_id`, `session_source`, `session_id`, `run_id`, `segment_id`, `agent_id`, `context_id`)",
		);
		expect(migration).not.toContain("DEFAULT '''");
		expect(migration).not.toContain("PARTITION BY");
	});
});

interface SchemaColumn {
	name: string;
	nullable?: boolean;
	type: string;
}

interface TableDefinition {
	columns: SchemaColumn[];
	engine: string;
	name: string;
	orderBy: string[];
	primaryKey: string[];
	settings: Record<string, string>;
}

function findTableDefinition(value: unknown): TableDefinition {
	if (typeof value === "object" && value !== null) {
		const candidate = value as Partial<TableDefinition>;
		if (
			candidate.name === REPOSITORY_EVIDENCE_INDEX_TABLE &&
			Array.isArray(candidate.columns)
		) {
			return candidate as TableDefinition;
		}
		for (const nested of Object.values(value)) {
			try {
				return findTableDefinition(nested);
			} catch {
				// Continue through the schema wrapper until the table is found.
			}
		}
	}
	throw new Error("Repository evidence index table definition was not found");
}
