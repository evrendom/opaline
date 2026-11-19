import { describe, expect, test } from "bun:test";
import {
	RepositorySetupSchema,
	RepositorySetupTextSchema,
} from "@rudel/api-routes";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	repositorySetup,
	repositorySetupText,
} from "./repository-setup.service.js";

type Rows = readonly Record<string, unknown>[];

function executorOf(tables: {
	fingerprints: Rows;
	files?: Rows;
	listed?: Rows;
	texts?: Rows;
}) {
	const statements: ClickHouseStatement[] = [];
	const executor = {
		statements,
		async close() {},
		async execute() {},
		async query<T>(statement: ClickHouseStatement) {
			statements.push(statement);
			const sql = statement.query;
			const rows = sql.includes("rudel.transcript_records")
				? (tables.listed ?? [])
				: sql.includes("rudel.setup_texts")
					? tables.texts
					: sql.includes("rudel.run_setup")
						? tables.files
						: sql.includes("rudel.session_analytics")
							? tables.fingerprints
							: undefined;
			if (!rows) throw new Error(`unexpected statement: ${sql}`);
			return rows as T[];
		},
		async insert() {},
	};
	return executor satisfies ClickHouseExecutor & {
		statements: ClickHouseStatement[];
	};
}

const REPO_KEY = "remote:github.com/opalinehq/athena";
const ATHENA = {
	git_remote: "git@github.com:opalinehq/athena.git",
	package_name: "",
	project_path: "/Users/evren/coding-projects/athena",
	fingerprint: "AA",
};
const OTHER = {
	git_remote: "git@github.com:opalinehq/cli.git",
	package_name: "",
	project_path: "/Users/evren/coding-projects/opaline-cli",
	fingerprint: "BB",
};
const WORKSPACE = { workspaceId: "org_1", member: null };
const ms = (iso: string) => String(Date.parse(iso));

describe("repositorySetup", () => {
	test("no session of the repo: no files and no setup read", async () => {
		const executor = executorOf({ fingerprints: [OTHER] });
		const result = await repositorySetup({ executor }, WORKSPACE, REPO_KEY);
		expect(result).toEqual({ files: [] });
		expect(executor.statements).toHaveLength(1);
	});

	test("files across the repo's sessions, shaped and scoped", async () => {
		const executor = executorOf({
			fingerprints: [ATHENA, OTHER, { ...ATHENA, fingerprint: "AC" }],
			files: [
				{
					setup_file: "repository:opalinehq/athena:CLAUDE.md",
					kind: "instructions",
					scope: "repository",
					owner: "opalinehq/athena",
					path: "CLAUDE.md",
					versions: "3",
					runs: "41",
					sessions: "12",
					subagents: 1,
					chars: "5120",
					first_ms: ms("2026-10-01T09:00:00.000Z"),
					last_ms: ms("2026-11-01T18:00:00.000Z"),
				},
			],
		});
		const result = await repositorySetup({ executor }, WORKSPACE, REPO_KEY);
		expect(RepositorySetupSchema.parse(result)).toEqual(result);
		expect(result.files).toEqual([
			{
				setupFile: "repository:opalinehq/athena:CLAUDE.md",
				kind: "instructions",
				scope: "repository",
				owner: "opalinehq/athena",
				path: "CLAUDE.md",
				versions: 3,
				runs: 41,
				sessions: 12,
				subagents: true,
				chars: 5120,
				firstAt: "2026-10-01T09:00:00.000Z",
				lastAt: "2026-11-01T18:00:00.000Z",
			},
		]);
		const statement = executor.statements[1];
		expect(statement?.query_params).toEqual({
			workspaceId: "org_1",
			fingerprints: ["AA", "AC"],
		});
		expect(statement?.query).toContain("repo_sessions");
		expect(statement?.query).not.toContain("{member:String}");
	});

	test("no repo: files across every session of the workspace", async () => {
		const executor = executorOf({ fingerprints: [], files: [] });
		const range = { startDate: "2026-10-30", endDate: "2026-11-06" };
		const result = await repositorySetup(
			{ executor },
			WORKSPACE,
			undefined,
			range,
		);
		expect(result).toEqual({ files: [], listedSkills: [] });
		expect(executor.statements).toHaveLength(2);
		for (const statement of executor.statements) {
			expect(statement.query).toContain("repo_sessions");
			expect(statement.query).not.toContain("{fingerprints:");
			expect(statement.query_params).toEqual({
				workspaceId: "org_1",
				rangeStart: "2026-10-30",
				rangeEnd: "2026-11-06",
			});
		}
	});

	test("skills offered in the repo's sessions, called or not", async () => {
		const executor = executorOf({
			fingerprints: [ATHENA],
			files: [],
			listed: [
				{
					name: "opaline:opaline",
					description: "Analyse a team's sessions",
					sessions: "9",
					last_ms: ms("2026-11-02T10:00:00.000Z"),
				},
			],
		});
		const result = await repositorySetup({ executor }, WORKSPACE, REPO_KEY);
		expect(RepositorySetupSchema.parse(result)).toEqual(result);
		expect(result.listedSkills).toEqual([
			{
				name: "opaline:opaline",
				description: "Analyse a team's sessions",
				sessions: 9,
				lastAt: "2026-11-02T10:00:00.000Z",
			},
		]);
		const statement = executor.statements[2];
		expect(statement?.query).toContain("subtype = 'skill_listing'");
		expect(statement?.query).toContain("repo_sessions");
	});

	test("a member who reads only their own sessions gets only theirs", async () => {
		const executor = executorOf({ fingerprints: [ATHENA], files: [] });
		await repositorySetup(
			{ executor },
			{ workspaceId: "org_1", member: "user_7" },
			REPO_KEY,
		);
		const statement = executor.statements[1];
		expect(statement?.query).toContain("sa.user_id = {member:String}");
		expect(statement?.query_params).toMatchObject({ member: "user_7" });
	});
});

describe("repositorySetupText", () => {
	test("versions oldest first with their sessions", async () => {
		const executor = executorOf({
			fingerprints: [ATHENA],
			texts: [
				{
					version: "b2",
					version_name: "Nov 1",
					chars: "80",
					runs: "4",
					sessions: "2",
					first_ms: ms("2026-11-01T09:00:00.000Z"),
					last_ms: ms("2026-11-02T09:00:00.000Z"),
					text: "# Athena\nnew",
					text_cut: 0,
				},
				{
					version: "a1",
					version_name: "Oct 1",
					chars: "70",
					runs: "9",
					sessions: "5",
					first_ms: ms("2026-10-01T09:00:00.000Z"),
					last_ms: ms("2026-10-30T09:00:00.000Z"),
					text: "# Athena",
					text_cut: 1,
				},
			],
		});
		const result = await repositorySetupText(
			{ executor },
			WORKSPACE,
			REPO_KEY,
			"repository:opalinehq/athena:CLAUDE.md",
		);
		expect(RepositorySetupTextSchema.parse(result)).toEqual(result);
		expect(result.versions.map((version) => version.version)).toEqual([
			"a1",
			"b2",
		]);
		expect(result.versions[0]).toMatchObject({
			sessions: 5,
			runs: 9,
			textCut: true,
			lastAt: "2026-10-30T09:00:00.000Z",
		});
		expect(executor.statements[1]?.query_params).toMatchObject({
			setupFile: "repository:opalinehq/athena:CLAUDE.md",
		});
	});

	test("unknown repo: no versions", async () => {
		const executor = executorOf({ fingerprints: [] });
		const result = await repositorySetupText(
			{ executor },
			WORKSPACE,
			REPO_KEY,
			"x",
		);
		expect(result).toEqual({ versions: [] });
	});
});
