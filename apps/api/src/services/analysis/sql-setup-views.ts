import { getSafeClickHouseTable } from "../../clickhouse.js";
import type { SqlScopeParams } from "./sql-l1-views.js";
import type { SqlView, SqlViewColumn } from "./sql-views.js";

/**
 * Setup snapshots (NEW-2): the setup each session evidence capture found on
 * the member's machine, one row per capture and setup item, so a hook,
 * permission rule, skill or instruction added to fix a recurring failure can
 * be dated and the runs before and after it compared. The evidence index
 * stores the manifest's own fields (`repository-evidence-setup.ts`); this
 * names and versions each item:
 *
 * - a file is named as setup_files names it (`<scope>:<owner>:<path>`, see
 *   `setupFileIdentity` in received-setup.ts), so what was on disk joins
 *   what the run received on setup_file; its version is its content hash;
 * - a hook, permission rule, MCP server, plugin or setting is named by the
 *   agent, the settings file it is in and its name (a hook and a rule also by
 *   what they say), and versioned by the SHA-256 of its value;
 * - a runtime field is versioned by the version string itself.
 */

export const SETUP_SNAPSHOTS_VIEW = "setup_snapshots";

const EVIDENCE_INDEX_TABLE = "rudel.repository_session_evidence_index";
const UTC = "UTC.";

/** The roots the CLI walks for plugins (`~/.claude/plugins/cache`, Codex's). */
const PLUGIN_PATHS = [
	// <...>/.claude/plugins/cache/<marketplace>/<plugin>/<version>/<path>
	{
		pattern: String.raw`(?:^|/)\.(?:claude|codex)/plugins/cache/([^/]+)/([^/]+)/[^/]+/(.+)$`,
		plugin: 2,
		market: 1,
		path: 3,
	},
	// <...>/.claude/plugins/marketplaces/<marketplace>/plugins/<plugin>/<path>
	{
		pattern: String.raw`(?:^|/)\.(?:claude|codex)/plugins/marketplaces/([^/]+)/plugins/([^/]+)/(.+)$`,
		plugin: 2,
		market: 1,
		path: 3,
	},
	// A marketplace that is itself the plugin.
	{
		pattern: String.raw`(?:^|/)\.(?:claude|codex)/plugins/marketplaces/([^/]+)/(.+)$`,
		plugin: 1,
		market: 1,
		path: 2,
	},
] as const;
const HOME_PATHS = [
	"^(?:[A-Za-z]:)?/(?:Users|home)/[^/]+/(.+)$",
	"^/root/(.+)$",
] as const;

function column(
	name: string,
	type: string,
	meaning: string,
	traps: readonly string[] = [],
): SqlViewColumn {
	return { name, type, meaning, traps };
}

export const SETUP_SNAPSHOT_COLUMNS: readonly SqlViewColumn[] = [
	column("user_id", "String", "The member whose machine the capture read.", [
		"For spotting a team-wide setup or one person's, never for ranking people.",
	]),
	column(
		"source",
		"LowCardinality(String)",
		"The agent of the session: claude_code or codex.",
	),
	column("session_id", "String", "Native session id: runs.session_id.", [
		"Join runs ON user_id and session_id; a capture belongs to its session, so every stream of it (agent_id) shares it.",
	]),
	column(
		"agent_id",
		"String",
		"The stream the capture was taken for; empty for the main transcript (every capture today).",
	),
	column(
		"repository",
		"String",
		"The session's repository as host/owner/name when the workspace connected it on GitHub, else the CLI's local repository id.",
	),
	column(
		"capture_id",
		"String",
		"The capture: one look at the machine's setup at one moment of the session.",
		[
			"Each capture lists every item it found, so an item missing from a later capture of the same member was removed (or moved) in between.",
		],
	),
	column("captured_at", "DateTime64(3, 'UTC')", "When the capture started.", [
		UTC,
	]),
	column(
		"lifecycle",
		"LowCardinality(String)",
		"When in the session the CLI captured: start (session start hook), resume, checkpoint (during it) or end.",
		["Pair with at_session_time: a late capture also says checkpoint."],
	),
	column(
		"at_session_time",
		"Bool",
		"True when the capture was taken by the session's own hooks; false for a later capture (capture_reason), whose items are the setup at the time of that capture, not of the session.",
		["Filter at_session_time before saying which setup a session had."],
	),
	column(
		"capture_reason",
		"LowCardinality(String)",
		"Why a capture was taken outside the session's hooks: task-output-sweep (a later sweep of an earlier session); empty for one at session time.",
	),
	column(
		"kind",
		"LowCardinality(String)",
		"What the item is. Files: instruction (CLAUDE.md, AGENTS.md and other instruction files, ~/.claude/rules), skill (a SKILL.md), memory (Claude Code auto-memory), command, agent, output_style, permission_rule (a Codex rules file) or config (settings.json, .mcp.json, config.toml, hooks.json and other agent configuration). Items of settings: hook, permission_rule (one allow, deny, ask or additionalDirectories rule), mcp_server, plugin (enabled or not), setting (any other settings key, Codex flags and modes). runtime: the OS, the CLI's runtime, node, bun, git, python and the agent's version.",
	),
	column(
		"scope",
		"LowCardinality(String)",
		"Where the item lives: repository (the repository's files, its .claude/settings*.json), user (the member's home and ~/.claude.json, and the runtime), managed (the administrator's managed settings) or plugin (a plugin's files).",
	),
	column(
		"agent",
		"LowCardinality(String)",
		"The agent the item configures: claude_code, codex, or empty for repository files, shared skills and the runtime.",
	),
	column(
		"location",
		"String",
		"Where the capture found it: the CLI's root for a file (repository, claude-user-home, codex-user-home, claude-user-skills, codex-user-skills, agents-user-skills, claude-plugins, codex-plugins, claude-project-memory, home-instructions, claude-managed), the settings file for a settings item (~/.claude/settings.json, .claude/settings.local.json, ~/.claude.json, $CODEX_HOME/config.toml, ...), runtime for a runtime field.",
	),
	column(
		"setup_item",
		"String",
		"The item's stable name across captures. A file is named as setup_files.setup_file names it: repository:<host/owner/name>:<path>, plugin:<plugin@marketplace>:<path>, member:<user_id>:~/<path>. A settings item: <kind>:<agent>:<settings file>:<name>, and a hook or permission rule also :<what it says>. runtime:<field>.",
		[
			"Compare captures on setup_item: the same name with another version changed; a name only in the later capture was added.",
			"Join setup_files ON setup_file = setup_item for what a run received of a file it had on disk.",
		],
	),
	column(
		"name",
		"String",
		"The file's path within its root, or the settings item's name: the hook's event, the rule list (allow, deny, ask, additionalDirectories), the server, the plugin (name@marketplace), the settings key (permissions.defaultMode, Codex approvalPolicy, features.<flag>), the runtime field (tools.node, agentHost.version).",
	),
	column(
		"value",
		"String",
		"What the settings item says, as the CLI recorded it: the hook's JSON (matcher, type, command, timeoutSeconds, async), the rule, the MCP server's JSON (credentials left out by the CLI), true/false for a plugin, the setting's JSON, the runtime version. For a file, its CLI categories.",
		[
			"Cut at 4,096 characters. Commands, URLs and settings passed the CLI's secret filter; a value it removed reads [REDACTED].",
		],
	),
	column(
		"version",
		"String",
		"The item's version: a file's content hash, else the hex SHA-256 of value (a runtime field: its version string). Empty when the CLI did not hash the file.",
		[
			"A hook or permission rule is named by what it says, so it never changes version: edited, it reads as one removed and one added.",
		],
	),
	column(
		"version_kind",
		"LowCardinality(String)",
		"How version was made: sha256-source (the file's bytes), sha256-stored (the bytes after the CLI's secret filter), git-sha1 or git-sha256 (git's blob id of an unchanged tracked file), omitted (not hashed: a size or count limit), item (SHA-256 of value) or literal (the runtime version).",
		[
			"Compare versions of one kind only. A sha256-source version equals setup_files.version when the agent received the whole file as it was on disk.",
		],
	),
	column(
		"bytes",
		"Nullable(UInt32)",
		"The file's size; NULL for settings items and runtime fields.",
	),
	column(
		"modified_at",
		"Nullable(DateTime64(3, 'UTC'))",
		"The file's modification time on the member's machine: when it was last written, often well before the capture; NULL for settings items and runtime fields.",
		[UTC],
	),
];

/** Every column but the item's own, in the view's order. */
const CAPTURE_COLUMNS = [
	"user_id",
	"source",
	"session_id",
	"agent_id",
	"repository",
	"capture_id",
	"captured_at",
	"lifecycle",
	"at_session_time",
	"capture_reason",
];

export function setupSnapshotsView(params: SqlScopeParams): SqlView {
	const owner = (memberOnly: boolean) =>
		`organization_id = {${params.workspace}:String}${
			memberOnly ? ` AND user_id = {${params.member}:String}` : ""
		}`;
	return {
		name: SETUP_SNAPSHOTS_VIEW,
		grain:
			"One row per session evidence capture and setup item it found on the member's machine: instruction, skill, memory, command and config files with their content hash, each hook, permission rule, MCP server, plugin and setting of each settings file, and runtime versions.",
		traps: [
			"Only sessions you may read in this workspace (every member's, unless the workspace keeps members to their own). The server adds the workspace; never filter by it.",
			"What was on disk, never what the agent received or used: join setup_files for what a run received, calls for what it ran.",
			"Only sessions the CLI captured evidence for (repositories with evidence upload on, from the CLI version that uploads it), captured since the setup columns existed: a session with no rows is unknown, not without setup (runs.coverage_gaps has setup_snapshot). A capture lists only what the CLI reads: the repository's agent files, ~/.claude, $CODEX_HOME, user skill and plugin directories, instruction files above the repository and the project's auto-memory.",
			"A session has several captures (start, checkpoints, end); for the setup a session started with, keep lifecycle = 'start' AND at_session_time. For the setup a run had, take its session's last capture at or before runs.started_at: argMax(capture_id, captured_at) over the session's captures WHERE captured_at <= started_at.",
			"To date a change, compare consecutive captures of one member (ORDER BY captured_at) on setup_item and version; modified_at says when a file was last written.",
			"Joined to runs, every run repeats every item of every capture of its session: reduce setup_snapshots to one row per session first (GROUP BY user_id, session_id with countIf(<the item>) > 0), then join.",
			"Times are UTC.",
		],
		columns: SETUP_SNAPSHOT_COLUMNS,
		recent: { column: "captured_at", rows: "setup items captured" },
		sql(memberOnly) {
			return setupSnapshotsSql(owner(memberOnly));
		},
	};
}

/**
 * The view's statement over the captures of `owner` that recorded setup
 * (`context_roots` empty: indexed before the setup columns). FINAL keeps the
 * latest index row of each capture: a re-indexed capture is one capture.
 */
export function setupSnapshotsSql(owner: string): string {
	const table = getSafeClickHouseTable(EVIDENCE_INDEX_TABLE);
	const captures = `SELECT user_id, session_source AS source, session_id, agent_id,
				if(repository_provider = '', repository_id,
					concat(repository_host, '/', repository_owner, '/', repository_name)) AS repository,
				toString(context_id) AS capture_id, capture_started_at AS captured_at,
				toString(capture_lifecycle) AS lifecycle, toBool(capture_reason = '') AS at_session_time,
				capture_reason, context_roots, setup_files, setup_settings, runtime_versions
			FROM ${table} FINAL
			WHERE ${owner} AND notEmpty(context_roots)`;
	const capture = CAPTURE_COLUMNS.join(", ");
	const groups = (pattern: string) =>
		`extractGroups(full_path, ${sqlString(pattern)})`;
	const plugins = PLUGIN_PATHS.map(
		(rule, index) => [`p${index}`, rule] as const,
	);
	const pluginName = plugins
		.flatMap(([name, rule]) => [
			`notEmpty(${name})`,
			`concat('plugin:', ${name}[${rule.plugin}], '@', ${name}[${rule.market}], ':', ${name}[${rule.path}])`,
		])
		.join(", ");
	const files = `SELECT ${capture},
				multiIf(has(categories, 'skill-definition'), 'skill',
					root_id = 'claude-project-memory', 'memory',
					root_id = 'codex-user-home' AND startsWith(path, 'rules/'), 'permission_rule',
					has(categories, 'instruction') OR root_id = 'home-instructions'
						OR (root_id = 'claude-user-home' AND startsWith(path, 'rules/')), 'instruction',
					match(path, '(^|/)commands/'), 'command',
					match(path, '(^|/)agents/'), 'agent',
					match(path, '(^|/)output-styles/'), 'output_style',
					'config') AS kind,
				multiIf(root_origin = 'repository', 'repository', root_origin = 'admin', 'managed',
					startsWith(setup_item, 'plugin:'), 'plugin', 'user') AS scope,
				multiIf(startsWith(root_id, 'claude-'), 'claude_code', startsWith(root_id, 'codex-'), 'codex', '') AS agent,
				root_id AS location, setup_item, path AS name, arrayStringConcat(categories, ',') AS value,
				hash AS version, hash_kind AS version_kind,
				CAST(file_bytes AS Nullable(UInt32)) AS bytes,
				CAST(file_modified_at AS Nullable(DateTime64(3, 'UTC'))) AS modified_at
			FROM (
				SELECT *,
					multiIf(root_origin = 'repository', concat('repository:', repository, ':', path),
						${pluginName},
						notEmpty(h0), concat('member:', user_id, ':~/', h0[1]),
						notEmpty(h1), concat('member:', user_id, ':~/', h1[1]),
						concat('member:', user_id, ':', full_path)) AS setup_item
				FROM (
					SELECT *,
						${plugins.map(([name, rule]) => `${groups(rule.pattern)} AS ${name}`).join(",\n\t\t\t\t\t\t")},
						${HOME_PATHS.map((pattern, index) => `${groups(pattern)} AS h${index}`).join(",\n\t\t\t\t\t\t")}
					FROM (
						SELECT ${capture}, file.1 AS root_id, file.2 AS path, file.3 AS categories,
							file.4 AS hash_kind, file.5 AS hash, file.6 AS file_bytes, file.7 AS file_modified_at,
							arrayFirst(candidate -> candidate.1 = file.1, context_roots) AS root,
							root.2 AS root_origin,
							replaceAll(concat(root.5, '/', file.2), '\\\\', '/') AS full_path
						FROM (${captures}) ARRAY JOIN setup_files AS file
					)
				)
			)`;
	const settings = `SELECT ${capture}, kind,
				multiIf(layer IN ('project', 'project-local') AND kind != 'mcp_server', 'repository',
					layer = 'managed', 'managed', 'user') AS scope,
				agent, location,
				concat(kind, ':', agent, ':', location, ':', name,
					if(kind IN ('hook', 'permission_rule'), concat(':', value), '')) AS setup_item,
				name, value, lower(hex(SHA256(value))) AS version, 'item' AS version_kind,
				CAST(NULL AS Nullable(UInt32)) AS bytes,
				CAST(NULL AS Nullable(DateTime64(3, 'UTC'))) AS modified_at
			FROM (
				SELECT ${capture}, item.1 AS agent, item.2 AS layer, item.3 AS location,
					if(item.4 = 'permission', 'permission_rule', item.4) AS kind,
					item.5 AS name, item.6 AS value
				FROM (${captures}) ARRAY JOIN setup_settings AS item
			)`;
	const runtime = `SELECT ${capture}, 'runtime' AS kind, 'user' AS scope, '' AS agent,
				'runtime' AS location, concat('runtime:', field.1) AS setup_item, field.1 AS name,
				field.2 AS value, field.2 AS version, 'literal' AS version_kind,
				CAST(NULL AS Nullable(UInt32)) AS bytes,
				CAST(NULL AS Nullable(DateTime64(3, 'UTC'))) AS modified_at
			FROM (${captures}) ARRAY JOIN runtime_versions AS field`;
	const columns = SETUP_SNAPSHOT_COLUMNS.map((item) => item.name).join(", ");
	return `SELECT ${columns} FROM (
			${files}
			UNION ALL
			${settings}
			UNION ALL
			${runtime}
		)`;
}

/**
 * The sessions of `owner` with a capture at session time that recorded
 * setup: their runs have no setup_snapshot coverage gap.
 */
export function capturedSetupSessionsSql(owner: string): string {
	return `SELECT user_id, session_id FROM ${getSafeClickHouseTable(EVIDENCE_INDEX_TABLE)}
					WHERE ${owner} AND notEmpty(context_roots) AND capture_reason = ''`;
}

function sqlString(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
