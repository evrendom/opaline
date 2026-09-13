import {
	HISTORICAL_SKILL_CONTENT_MAX_BYTES,
	HISTORICAL_SKILL_VERSION_LIMIT,
	type HistoricalSkillAgent,
	type HistoricalSkillDetail,
	type HistoricalSkillSummary,
	type HistoricalSkillVersion,
	resolveRepoIdentity,
} from "@rudel/api-routes";
import { queryClickhouse } from "../clickhouse.js";
import { buildActiveSkillUsesCte } from "./skill-extraction-ingest.service.js";

interface HistoricalSkillSummaryRow {
	claude_session_count: number;
	codex_session_count: number;
	content_preview: string;
	name: string;
	repo_count: number;
	session_count: number;
	top_repo_git_remotes: string[];
	top_repo_package_names: string[];
	top_repo_project_paths: string[];
	top_repo_session_counts: number[];
	top_user_ids: string[];
	top_user_session_counts: number[];
	user_count: number;
}

interface HistoricalSkillAgentSummaryRow {
	agent: string;
	session_count: number;
	unavailable_session_count: number;
}

export interface HistoricalSkillVersionUseRow {
	agent: string;
	content_sha256: string;
	first_used_at: string;
	last_used_at: string;
	session_count: number;
}

export interface HistoricalSkillContentRow {
	content: string;
	content_sha256: string;
}

const HISTORICAL_SKILL_PREVIEW_CHARACTER_LIMIT = 1_600;
const HISTORICAL_SKILL_ATTRIBUTION_LIMIT = 3;
// Distinct raw repo triples over-fetch so that worktree paths resolving to the
// same repo identity can merge server-side before the display cap; the count
// is exact while raw triples stay within this bound and a floor beyond it.
const HISTORICAL_SKILL_REPO_CANDIDATE_LIMIT = 32;
const HISTORICAL_SKILL_QUERY_SETTINGS = {
	max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
	max_execution_time: 30,
	max_bytes_in_set: String(64 * 1024 * 1024),
	max_result_bytes: String(128 * 1024 * 1024),
	max_result_rows: "10000",
	max_rows_in_set: "1000000",
	max_rows_to_read: "10000000",
	result_overflow_mode: "throw",
	timeout_before_checking_execution_speed: 0,
} as const;

const HISTORICAL_SKILL_CONTENT_QUERY_SETTINGS = {
	...HISTORICAL_SKILL_QUERY_SETTINGS,
	max_result_bytes: String(3 * 1024 * 1024),
	max_result_rows: String(HISTORICAL_SKILL_VERSION_LIMIT),
} as const;

export async function listHistoricalSkills(
	organizationId: string,
): Promise<HistoricalSkillSummary[]> {
	const rows = await queryClickhouse<HistoricalSkillSummaryRow>({
		clickhouse_settings: HISTORICAL_SKILL_QUERY_SETTINGS,
		query: `
			WITH ${buildActiveSkillUsesCte()},
			attributed_skill_uses AS (
				SELECT
					su.skill_name,
					su.user_id,
					su.agent,
					su.session_id,
					su.content_sha256,
					su.used_at,
					coalesce(sa.git_remote, '') AS git_remote,
					coalesce(sa.package_name, '') AS package_name,
					coalesce(sa.project_path, '') AS project_path
				FROM active_skill_uses AS su
				LEFT JOIN (
					SELECT
						organization_id,
						user_id,
						session_id,
						source,
						git_remote,
						package_name,
						project_path
					FROM rudel.session_analytics FINAL
					WHERE organization_id = {organizationId:String}
				) AS sa
					ON sa.organization_id = su.organization_id
					AND sa.user_id = su.user_id
					AND sa.session_id = su.session_id
					AND (
						(su.agent = 'claude' AND sa.source = 'claude_code')
						OR (su.agent = 'codex' AND sa.source = 'codex')
					)
			),
			skill_summaries AS (
				SELECT
					skill_name AS name,
					uniqExact(tuple(user_id, agent, session_id)) AS session_count,
					uniqExactIf(tuple(user_id, session_id), agent = 'claude') AS claude_session_count,
					uniqExactIf(tuple(user_id, session_id), agent = 'codex') AS codex_session_count,
					argMaxIf(
						content_sha256,
						tuple(used_at, agent, user_id, session_id, content_sha256),
						content_sha256 != ''
					) AS preview_content_sha256
				FROM attributed_skill_uses
				GROUP BY skill_name
			),
			skill_user_totals AS (
				SELECT
					skill_name AS name,
					user_id,
					uniqExact(tuple(agent, session_id)) AS session_count
				FROM attributed_skill_uses
				GROUP BY skill_name, user_id
			),
			skill_user_attribution AS (
				SELECT
					name,
					count() AS user_count,
					arraySlice(
						arraySort(
							user -> tuple(-toInt64(user.2), user.1),
							groupArray(tuple(user_id, session_count))
						),
						1,
						{attributionLimit:UInt64}
					) AS top_users
				FROM skill_user_totals
				GROUP BY name
			),
			skill_repo_totals AS (
				SELECT
					skill_name AS name,
					git_remote,
					package_name,
					project_path,
					uniqExact(tuple(user_id, agent, session_id)) AS session_count
				FROM attributed_skill_uses
				GROUP BY skill_name, git_remote, package_name, project_path
			),
			skill_repo_attribution AS (
				SELECT
					name,
					count() AS repo_count,
					arraySlice(
						arraySort(
							repo -> tuple(
								-toInt64(repo.4),
								repo.1,
								repo.2,
								repo.3
							),
							groupArray(tuple(
								git_remote,
								package_name,
								project_path,
								session_count
							))
						),
						1,
						{repoCandidateLimit:UInt64}
					) AS top_repos
				FROM skill_repo_totals
				GROUP BY name
			)
			SELECT
				summaries.name AS name,
				summaries.session_count AS session_count,
				summaries.claude_session_count AS claude_session_count,
				summaries.codex_session_count AS codex_session_count,
				contents.content_preview AS content_preview,
				users.user_count AS user_count,
				arrayMap(user -> user.1, users.top_users) AS top_user_ids,
				arrayMap(user -> user.2, users.top_users) AS top_user_session_counts,
				repos.repo_count AS repo_count,
				arrayMap(repo -> repo.1, repos.top_repos) AS top_repo_git_remotes,
				arrayMap(repo -> repo.2, repos.top_repos) AS top_repo_package_names,
				arrayMap(repo -> repo.3, repos.top_repos) AS top_repo_project_paths,
				arrayMap(repo -> repo.4, repos.top_repos) AS top_repo_session_counts
			FROM skill_summaries AS summaries
			INNER ANY JOIN skill_user_attribution AS users USING (name)
			INNER ANY JOIN skill_repo_attribution AS repos USING (name)
			LEFT ANY JOIN (
				SELECT
					skill_name,
					toString(content_sha256) AS content_sha256,
					substringUTF8(
						content,
						1,
						{previewCharacterLimit:UInt32}
					) AS content_preview
				FROM rudel.skill_version_contents
				PREWHERE organization_id = {organizationId:String}
			) AS contents
				ON contents.skill_name = summaries.name
				AND contents.content_sha256 = summaries.preview_content_sha256
			ORDER BY session_count DESC, name ASC
		`,
		query_params: {
			attributionLimit: HISTORICAL_SKILL_ATTRIBUTION_LIMIT,
			organizationId,
			previewCharacterLimit: HISTORICAL_SKILL_PREVIEW_CHARACTER_LIMIT,
			repoCandidateLimit: HISTORICAL_SKILL_REPO_CANDIDATE_LIMIT,
		},
	});
	return rows.map((row) => ({
		name: row.name,
		sessionCount: Number(row.session_count),
		claudeSessionCount: Number(row.claude_session_count),
		codexSessionCount: Number(row.codex_session_count),
		contentPreview: row.content_preview || null,
		attribution: {
			userCount: Number(row.user_count),
			topUsers: row.top_user_ids.map((userId, index) => ({
				userId,
				sessionCount: Number(row.top_user_session_counts[index] ?? 0),
			})),
			...mergeRepoAttribution(row),
		},
	}));
}

// Distinct raw triples (git_remote, package_name, project_path) can resolve to
// the same repo identity — several worktrees of one repo, for example — so the
// resolved chips must merge by repoKey before the display cap or the card
// shows duplicate labels. repoCount is the merged count, exact while the raw
// triple count fits the candidate fetch bound and a floor beyond it.
function mergeRepoAttribution(row: HistoricalSkillSummaryRow): {
	repoCount: number;
	topRepos: { repoKey: string; repoLabel: string; sessionCount: number }[];
} {
	const merged = new Map<
		string,
		{ repoKey: string; repoLabel: string; sessionCount: number }
	>();
	for (const [index, projectPath] of row.top_repo_project_paths.entries()) {
		const repoIdentity = resolveRepoIdentity({
			gitRemote: row.top_repo_git_remotes[index] || null,
			packageName: row.top_repo_package_names[index] || null,
			projectPath,
		});
		const sessionCount = Number(row.top_repo_session_counts[index] ?? 0);
		const existing = merged.get(repoIdentity.repoKey);
		if (existing) {
			existing.sessionCount += sessionCount;
		} else {
			merged.set(repoIdentity.repoKey, {
				repoKey: repoIdentity.repoKey,
				repoLabel: repoIdentity.repoName ?? "No repository",
				sessionCount,
			});
		}
	}
	const mergedRepos = [...merged.values()].sort(
		(left, right) =>
			right.sessionCount - left.sessionCount ||
			left.repoLabel.localeCompare(right.repoLabel),
	);
	const unresolvedTripleCount = Math.max(
		0,
		Number(row.repo_count) - row.top_repo_project_paths.length,
	);
	return {
		repoCount: mergedRepos.length + unresolvedTripleCount,
		topRepos: mergedRepos.slice(0, HISTORICAL_SKILL_ATTRIBUTION_LIMIT),
	};
}

export async function getHistoricalSkillDetail(
	organizationId: string,
	name: string,
): Promise<HistoricalSkillDetail> {
	const [agentRows, versionRows] = await Promise.all([
		queryClickhouse<HistoricalSkillAgentSummaryRow>({
			clickhouse_settings: HISTORICAL_SKILL_QUERY_SETTINGS,
			query: `
				WITH ${buildActiveSkillUsesCte({ filterSkillName: true })}
				SELECT
					agent,
					uniqExact(tuple(user_id, session_id)) AS session_count,
					uniqExactIf(tuple(user_id, session_id), content_sha256 = '') AS unavailable_session_count
				FROM active_skill_uses
				WHERE skill_name = {skillName:String}
				GROUP BY agent
			`,
			query_params: { organizationId, skillName: name },
		}),
		queryClickhouse<HistoricalSkillVersionUseRow>({
			clickhouse_settings: {
				...HISTORICAL_SKILL_QUERY_SETTINGS,
				max_result_rows: String(HISTORICAL_SKILL_VERSION_LIMIT),
			},
			query: `
				WITH ${buildActiveSkillUsesCte({ filterSkillName: true })}
				SELECT
					agent,
					content_sha256,
					session_count,
					formatDateTime(first_used_at_raw, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS first_used_at,
					formatDateTime(last_used_at_raw, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS last_used_at
				FROM (
					SELECT
						agent,
						content_sha256,
						uniqExact(tuple(user_id, session_id)) AS session_count,
						min(used_at) AS first_used_at_raw,
						max(used_at) AS last_used_at_raw
					FROM active_skill_uses
					WHERE skill_name = {skillName:String}
						AND content_sha256 != ''
					GROUP BY agent, content_sha256
					ORDER BY last_used_at_raw DESC, agent ASC, content_sha256 ASC
					LIMIT {versionLimit:UInt32}
				)
				ORDER BY last_used_at_raw DESC, agent ASC, content_sha256 ASC
			`,
			query_params: {
				organizationId,
				skillName: name,
				versionLimit: HISTORICAL_SKILL_VERSION_LIMIT,
			},
		}),
	]);
	const contentHashes = [
		...new Set(versionRows.map((row) => row.content_sha256)),
	];
	const contentRows =
		contentHashes.length === 0
			? []
			: await queryClickhouse<HistoricalSkillContentRow>({
					clickhouse_settings: HISTORICAL_SKILL_CONTENT_QUERY_SETTINGS,
					query: `
				SELECT content_sha256, any(contents.content) AS content
				FROM rudel.skill_version_contents AS contents
				WHERE contents.organization_id = {organizationId:String}
					AND contents.skill_name = {skillName:String}
					AND contents.content_sha256 IN {contentHashes:Array(String)}
					AND length(contents.content) <= {contentByteLimit:UInt32}
				GROUP BY
					contents.organization_id,
					contents.skill_name,
					contents.content_sha256
			`,
					query_params: {
						contentByteLimit: HISTORICAL_SKILL_CONTENT_MAX_BYTES,
						contentHashes,
						organizationId,
						skillName: name,
					},
				});

	let unavailableSessionCount = agentRows.reduce(
		(total, row) => total + Number(row.unavailable_session_count),
		0,
	);
	const resolved = resolveHistoricalSkillVersions(versionRows, contentRows);
	unavailableSessionCount += resolved.unavailableSessionCount;

	const claudeSessionCount = getAgentSessionCount(agentRows, "claude");
	const codexSessionCount = getAgentSessionCount(agentRows, "codex");
	const sourceAgents = agentRows.map((row) => parseAgent(row.agent)).sort();
	return {
		name,
		sessionCount: claudeSessionCount + codexSessionCount,
		claudeSessionCount,
		codexSessionCount,
		sourceAgents,
		versions: resolved.versions,
		unavailableSessionCount,
	};
}

export function resolveHistoricalSkillVersions(
	versionRows: readonly HistoricalSkillVersionUseRow[],
	contentRows: readonly HistoricalSkillContentRow[],
): {
	readonly unavailableSessionCount: number;
	readonly versions: HistoricalSkillVersion[];
} {
	const contentByHash = new Map(
		contentRows.map((row) => [row.content_sha256, row.content]),
	);
	let unavailableSessionCount = 0;
	const versions: HistoricalSkillVersion[] = [];
	for (const row of versionRows.slice(0, HISTORICAL_SKILL_VERSION_LIMIT)) {
		const content = contentByHash.get(row.content_sha256);
		if (
			content === undefined ||
			Buffer.byteLength(content, "utf8") > HISTORICAL_SKILL_CONTENT_MAX_BYTES
		) {
			unavailableSessionCount += Number(row.session_count);
			continue;
		}
		versions.push({
			sourceAgent: parseAgent(row.agent),
			contentSha256: row.content_sha256,
			content,
			sessionCount: Number(row.session_count),
			firstUsedAt: row.first_used_at,
			lastUsedAt: row.last_used_at,
		});
	}
	versions.sort(compareVersions);
	return { unavailableSessionCount, versions };
}

function getAgentSessionCount(
	rows: readonly HistoricalSkillAgentSummaryRow[],
	agent: HistoricalSkillAgent,
): number {
	return Number(rows.find((row) => row.agent === agent)?.session_count ?? 0);
}

function parseAgent(value: string): HistoricalSkillAgent {
	if (value === "claude" || value === "codex") return value;
	throw new Error(`Unexpected historical skill agent: ${value}`);
}

function compareVersions(
	left: HistoricalSkillVersion,
	right: HistoricalSkillVersion,
): number {
	return (
		right.lastUsedAt.localeCompare(left.lastUsedAt) ||
		left.sourceAgent.localeCompare(right.sourceAgent) ||
		left.contentSha256.localeCompare(right.contentSha256)
	);
}
