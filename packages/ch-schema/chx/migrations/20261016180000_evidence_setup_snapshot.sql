-- NEW-2: the setup each evidence capture recorded, so a hook, permission
-- rule, skill or instruction can be dated and compared before and after
-- (apps/api setup_snapshots SQL view). The columns copy manifest fields as
-- the CLI wrote them; the view names and versions each item. Captures indexed
-- before this keep the empty defaults, which the view reads as not recorded.
-- Adding columns is a metadata change on a small table. Applied, and read
-- back, by scripts/migrate-repository-evidence-index.ts after the table's
-- create migration.

ALTER TABLE `rudel`.`repository_session_evidence_index`
	ADD COLUMN IF NOT EXISTS `capture_reason` LowCardinality(String) COMMENT 'manifest.captureReason: empty for a capture taken at the session\'s own time (its hooks); task-output-sweep for a later capture of an earlier session, whose setup is from the time of the sweep.',
	ADD COLUMN IF NOT EXISTS `context_roots` Array(Tuple(String, LowCardinality(String), LowCardinality(String), LowCardinality(String), String)) COMMENT 'manifest.roots: (id, origin repository/user/admin/system, scope, status, absolutePath) of each directory the capture read. Empty for captures indexed before setup columns existed.',
	ADD COLUMN IF NOT EXISTS `setup_files` Array(Tuple(String, String, Array(LowCardinality(String)), LowCardinality(String), String, UInt32, DateTime64(3, 'UTC'))) COMMENT 'manifest.entries that are agent setup: (rootId, path, categories, hash status and scope: sha256-source, sha256-stored, git-object or omitted, hash value, size, modifiedAt). Kept: files of every root but the saved tool outputs; in the repository only instruction, skill-definition, agent-config, mcp-config and hook-config files; never a skill\'s other files nor unclassified files of skill and plugin directories.',
	ADD COLUMN IF NOT EXISTS `setup_settings` Array(Tuple(LowCardinality(String), LowCardinality(String), String, LowCardinality(String), String, String)) COMMENT 'manifest.userConfiguration, one item per row: (agent claude_code/codex, settings layer scope, layer path, item kind hook/permission/mcp_server/plugin/setting, name, value). A hook\'s value is its JSON (matcher, type, command, timeoutSeconds, async), a permission\'s the rule under its list name, an MCP server\'s its sanitised JSON, a plugin\'s true/false/null, a setting\'s its JSON value.',
	ADD COLUMN IF NOT EXISTS `runtime_versions` Array(Tuple(String, String)) COMMENT 'manifest.runtime as (field, value): os.platform, os.release, os.arch, cli.runtime, cli.version, tools.node, tools.bun, tools.git, tools.python, agentHost.name, agentHost.version, agentHost.originator; a field the CLI did not find is left out.';
