import {
	REPOSITORY_LISTED_SKILL_LIMIT,
	REPOSITORY_MCP_TOOL_LIMIT,
	REPOSITORY_SETUP_FILE_LIMIT,
	REPOSITORY_SETUP_SESSION_LIMIT,
	REPOSITORY_SETUP_TEXT_VERSION_LIMIT,
	type RepositoryMcpTools,
	type RepositorySetup,
	type RepositorySetupSessions,
	type RepositorySetupText,
	resolveRepoIdentity,
} from "@rudel/api-routes";
import {
	RUN_SETUP_TABLE,
	SETUP_TEXTS_TABLE,
} from "@rudel/ch-schema/received-setup";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { committedBuildSql } from "./analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import { RUN_INDEX_TABLE } from "./l1-edges/l1-edge-tables.js";
import type { SessionRunCiScope } from "./run-ci/session-run-ci.js";

const FINGERPRINT_SQL =
	"hex(MD5(toJSONString(tuple(sa.git_remote, sa.package_name, sa.project_path))))";
const REPO_SESSION_LIMIT = 20_000;

export type RepoScope = {
	params: Record<string, unknown>;
	sessionsCte: string;
	owner: string;
};

export async function repositorySetup(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	repoKey: string | undefined,
	range?: RepoRange,
): Promise<RepositorySetup> {
	const repo = await repoScopeOf(env.executor, scope, repoKey, range);
	if (!repo) return { files: [] };
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const setupFiles = query(env.executor, SetupFileRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte}
			SELECT setup_file, any(kind) AS kind, any(scope) AS scope,
				any(owner) AS owner, any(path) AS path,
				uniqExact(version) AS versions,
				uniqExact((user_id, session_id, agent_id, run_start_record)) AS runs,
				uniqExact((user_id, session_id)) AS sessions,
				max(agent_id != '') AS subagents, max(chars) AS chars,
				toUnixTimestamp64Milli(min(run_started_at)) AS first_ms,
				toUnixTimestamp64Milli(max(run_started_at)) AS last_ms
			FROM ${getSafeClickHouseTable(RUN_SETUP_TABLE)} FINAL
			WHERE ${repo.owner}
				AND ${committedBuildSql(runIndex, repo.owner, ["user_id", "session_id"])}
			GROUP BY setup_file
			ORDER BY sessions DESC, first_ms, setup_file
			LIMIT ${REPOSITORY_SETUP_FILE_LIMIT}`,
		query_params: repo.params,
	});
	const listed = query(env.executor, ListedSkillRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte}
			SELECT name, any(description) AS description,
				uniqExact((user_id, session_id)) AS sessions,
				toUnixTimestamp64Milli(max(ts)) AS last_ms
			FROM (
				SELECT user_id, session_id, ts,
					if(position(line, ': ') > 0,
						trimBoth(substring(line, 1, position(line, ': ') - 1)),
						trimBoth(line)) AS name,
					if(position(line, ': ') > 0,
						trimBoth(substring(line, position(line, ': ') + 2)), '') AS description
				FROM ${getSafeClickHouseTable("rudel.transcript_records")}
				ARRAY JOIN extractAll(text, '(?m)^- ([^\\n]+)') AS line
				WHERE ${repo.owner}
					AND kind = 'injected_context' AND subtype = 'skill_listing'
			)
			WHERE name != ''
			GROUP BY name
			ORDER BY sessions DESC, name
			LIMIT ${REPOSITORY_LISTED_SKILL_LIMIT}`,
		query_params: repo.params,
	});
	const [rows, listedRows] = await Promise.all([setupFiles, listed]);
	return {
		files: rows.map((row) => ({
			setupFile: row.setup_file,
			kind: row.kind,
			scope: row.scope,
			owner: row.owner,
			path: row.path,
			versions: row.versions,
			runs: row.runs,
			sessions: row.sessions,
			subagents: row.subagents,
			chars: row.chars,
			firstAt: new Date(row.first_ms).toISOString(),
			lastAt: new Date(row.last_ms).toISOString(),
		})),
		listedSkills: listedRows.map((row) => ({
			name: row.name,
			description: row.description,
			sessions: row.sessions,
			lastAt: new Date(row.last_ms).toISOString(),
		})),
	};
}

export async function repositorySetupText(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	repoKey: string | undefined,
	setupFile: string,
	range?: RepoRange,
): Promise<RepositorySetupText> {
	const repo = await repoScopeOf(env.executor, scope, repoKey, range);
	if (!repo) return { versions: [] };
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const rows = await query(env.executor, SetupTextRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte},
			received AS (
				SELECT version,
					argMin(version_name, run_started_at) AS version_name,
					argMin(user_id, run_started_at) AS text_user,
					max(chars) AS chars,
					uniqExact((user_id, session_id, agent_id, run_start_record)) AS runs,
					uniqExact((user_id, session_id)) AS sessions,
					toUnixTimestamp64Milli(min(run_started_at)) AS first_ms,
					toUnixTimestamp64Milli(max(run_started_at)) AS last_ms
				FROM ${getSafeClickHouseTable(RUN_SETUP_TABLE)} FINAL
				WHERE ${repo.owner} AND setup_file = {setupFile:String}
					AND ${committedBuildSql(runIndex, repo.owner, ["user_id", "session_id"])}
				GROUP BY version
				ORDER BY first_ms DESC, version DESC
				LIMIT ${REPOSITORY_SETUP_TEXT_VERSION_LIMIT}
			)
			SELECT r.version AS version, r.version_name AS version_name,
				r.chars AS chars, r.runs AS runs, r.sessions AS sessions,
				r.first_ms AS first_ms, r.last_ms AS last_ms,
				t.text AS text, toUInt8(t.text_cut) AS text_cut
			FROM received AS r
			INNER JOIN (
				SELECT user_id, version, text, text_cut
				FROM ${getSafeClickHouseTable(SETUP_TEXTS_TABLE)} FINAL
				WHERE organization_id = {workspaceId:String}
					AND (user_id, version) IN (SELECT text_user, version FROM received)
			) AS t ON t.user_id = r.text_user AND t.version = r.version
			ORDER BY first_ms DESC, version DESC
			LIMIT ${REPOSITORY_SETUP_TEXT_VERSION_LIMIT}`,
		query_params: { ...repo.params, setupFile },
	});
	return {
		versions: rows.reverse().map((row) => ({
			version: row.version,
			versionName: row.version_name,
			text: row.text,
			textCut: row.text_cut,
			chars: row.chars,
			runs: row.runs,
			sessions: row.sessions,
			firstAt: new Date(row.first_ms).toISOString(),
			lastAt: new Date(row.last_ms).toISOString(),
		})),
	};
}

export async function repositorySetupSessions(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	repoKey: string | undefined,
	setupFile: string,
	range?: RepoRange,
): Promise<RepositorySetupSessions> {
	const repo = await repoScopeOf(env.executor, scope, repoKey, range);
	if (!repo) return { sessions: [], truncated: false };
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const rows = await query(env.executor, SetupSessionRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte}
			SELECT session_id, version,
				uniqExact((agent_id, run_start_record)) AS runs,
				toUnixTimestamp64Milli(min(run_started_at)) AS first_ms,
				toUnixTimestamp64Milli(max(run_started_at)) AS last_ms
			FROM ${getSafeClickHouseTable(RUN_SETUP_TABLE)} FINAL
			WHERE ${repo.owner} AND setup_file = {setupFile:String}
				AND ${committedBuildSql(runIndex, repo.owner, ["user_id", "session_id"])}
			GROUP BY user_id, session_id, version
			ORDER BY last_ms DESC, session_id
			LIMIT ${REPOSITORY_SETUP_SESSION_LIMIT + 1}`,
		query_params: { ...repo.params, setupFile },
	});
	return {
		sessions: rows.slice(0, REPOSITORY_SETUP_SESSION_LIMIT).map((row) => ({
			sessionId: row.session_id,
			version: row.version,
			runs: row.runs,
			firstAt: new Date(row.first_ms).toISOString(),
			lastAt: new Date(row.last_ms).toISOString(),
		})),
		truncated: rows.length > REPOSITORY_SETUP_SESSION_LIMIT,
	};
}

export async function repositoryMcpTools(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	repoKey: string | undefined,
	range?: RepoRange,
): Promise<RepositoryMcpTools> {
	const repo = await repoScopeOf(env.executor, scope, repoKey, range);
	if (!repo) return { tools: [] };
	const rows = await query(env.executor, McpToolRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte}
			SELECT mcp_server AS server, tool_name AS tool,
				uniqExact(session_id, call_id) AS calls,
				uniqExact(session_id) AS sessions
			FROM ${getSafeClickHouseTable("rudel.transcript_records")}
			WHERE ${repo.owner}
				AND kind = 'tool_call' AND mcp_server != '' AND call_id != ''
			GROUP BY mcp_server, tool_name
			ORDER BY calls DESC, server, tool
			LIMIT ${REPOSITORY_MCP_TOOL_LIMIT}`,
		query_params: repo.params,
	});
	return { tools: rows };
}

export type RepoRange = { startDate: string; endDate: string };

export async function repoScopeOf(
	executor: ClickHouseExecutor,
	scope: SessionRunCiScope,
	repoKey: string | undefined,
	range?: RepoRange,
): Promise<RepoScope | null> {
	const fingerprints =
		repoKey === undefined
			? null
			: await repoFingerprints(executor, scope, repoKey);
	if (fingerprints?.length === 0) return null;
	const member =
		scope.member === null ? "" : " AND sa.user_id = {member:String}";
	const dates = range
		? " AND toDate(sa.session_date) BETWEEN {rangeStart:Date} AND {rangeEnd:Date}"
		: "";
	const inRepo = fingerprints
		? ` AND ${FINGERPRINT_SQL} IN {fingerprints:Array(String)}`
		: "";
	return {
		params: {
			workspaceId: scope.workspaceId,
			...(fingerprints ? { fingerprints } : {}),
			...(scope.member === null ? {} : { member: scope.member }),
			...(range
				? { rangeStart: range.startDate, rangeEnd: range.endDate }
				: {}),
		},
		sessionsCte: `repo_sessions AS (
				SELECT sa.user_id AS user_id, sa.session_id AS session_id,
					any(sa.project_path) AS project_path
				FROM ${getSafeClickHouseTable("rudel.session_analytics")} AS sa FINAL
				WHERE sa.organization_id = {workspaceId:String}${member}${dates}${inRepo}
				GROUP BY user_id, session_id
				LIMIT ${REPO_SESSION_LIMIT}
			)`,
		owner: `organization_id = {workspaceId:String}
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM repo_sessions)`,
	};
}

async function repoFingerprints(
	executor: ClickHouseExecutor,
	scope: SessionRunCiScope,
	repoKey: string,
): Promise<string[]> {
	const rows = await query(executor, FingerprintRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT DISTINCT sa.git_remote AS git_remote,
				sa.package_name AS package_name, sa.project_path AS project_path,
				${FINGERPRINT_SQL} AS fingerprint
			FROM ${getSafeClickHouseTable("rudel.session_analytics")} AS sa FINAL
			WHERE sa.organization_id = {workspaceId:String}
			LIMIT 10001`,
		query_params: { workspaceId: scope.workspaceId },
	});
	return [
		...new Set(
			rows
				.filter(
					(row) =>
						resolveRepoIdentity({
							gitRemote: row.git_remote,
							packageName: row.package_name,
							projectPath: row.project_path,
						}).repoKey === repoKey,
				)
				.map((row) => row.fingerprint),
		),
	].sort();
}

const FingerprintRowSchema = z.object({
	git_remote: z.string(),
	package_name: z.string(),
	project_path: z.string(),
	fingerprint: z.string(),
});

const SetupFileRowSchema = z.object({
	setup_file: z.string(),
	kind: z.string(),
	scope: z.string(),
	owner: z.string(),
	path: z.string(),
	versions: z.coerce.number(),
	runs: z.coerce.number(),
	sessions: z.coerce.number(),
	subagents: z.coerce.boolean(),
	chars: z.coerce.number(),
	first_ms: z.coerce.number(),
	last_ms: z.coerce.number(),
});

const ListedSkillRowSchema = z.object({
	name: z.string(),
	description: z.string(),
	sessions: z.coerce.number(),
	last_ms: z.coerce.number(),
});

const McpToolRowSchema = z.object({
	server: z.string(),
	tool: z.string(),
	calls: z.coerce.number(),
	sessions: z.coerce.number(),
});

const SetupSessionRowSchema = z.object({
	session_id: z.string(),
	version: z.string(),
	runs: z.coerce.number(),
	first_ms: z.coerce.number(),
	last_ms: z.coerce.number(),
});

const SetupTextRowSchema = z.object({
	version: z.string(),
	version_name: z.string(),
	chars: z.coerce.number(),
	runs: z.coerce.number(),
	sessions: z.coerce.number(),
	first_ms: z.coerce.number(),
	last_ms: z.coerce.number(),
	text: z.string(),
	text_cut: z.coerce.number().transform((cut) => cut === 1),
});
