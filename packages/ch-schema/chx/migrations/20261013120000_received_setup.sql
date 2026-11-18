-- OPL-391: received setup (CONTEXT.md "Received setup"). setup_texts holds each
-- distinct setup text (instruction files, skill bodies, MCP instructions, system
-- prompts) once per member under its SHA-256, the setup file version; the
-- transcript-records writer stores it before the generation's receipt (parser
-- 10). run_setup ties each run of a run index build to the setup file versions
-- it had, written with the build's runs and committed by its receipt (run index
-- 6), like run_requests. Both are kept until a deletion request and purged with
-- the account and the workspace. Applied by scripts/migrate-received-setup.ts.

CREATE TABLE IF NOT EXISTS rudel.setup_texts
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Member whose session received the text; each member\'s copy is deleted with their account.',
  `version` String COMMENT 'SHA-256 (hex) of the whole text as UTF-8: the setup file version.',
  `chars` UInt32 COMMENT 'Code points of the whole text.',
  `text` String COMMENT 'The text as the agent received it; its first 1,048,576 UTF-16 code units when longer (text_cut).',
  `text_cut` Bool COMMENT 'Whether text holds only the start of a longer text.',
  `written_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the writer stored this copy.'
) ENGINE = ReplacingMergeTree(written_at)
PRIMARY KEY (`organization_id`, `user_id`, `version`)
ORDER BY (`organization_id`, `user_id`, `version`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Received setup texts (instruction files, skill bodies, MCP instructions, system prompts), each distinct text once per member under its SHA-256; written by the transcript-records writer.';

CREATE TABLE IF NOT EXISTS rudel.run_setup
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `session_id` String COMMENT 'Native session ID within organization and user.',
  `revision` UInt64 COMMENT 'Raw transcript revision of the run index build\'s generation.',
  `parser_version` UInt16 COMMENT 'Transcript records parser version of the generation.',
  `index_version` UInt16 COMMENT 'Run index rules version of the build.',
  `build_revision` UInt64 COMMENT 'Run index build that wrote the row; the session\'s newest run index receipt names the build readers read.',
  `agent_id` String COMMENT 'Transcript stream; empty for the main stream.',
  `run_start_record` UInt32 COMMENT 'start_record of the run (run_index.start_record).',
  `setup_file` String COMMENT 'The setup file, named by where it lives rather than by a machine path: repository:<repository>:<path>, plugin:<plugin>:<path>, member:<member>:<path>, harness:<agent>:<part> or mcp:<server>.',
  `version` String COMMENT 'SHA-256 (hex) of the text received: the setup file version; setup_texts holds the text.',
  `source` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex.',
  `run_id` String COMMENT 'Run node id of the run (run_index.run_id).',
  `turn_idx` UInt32 COMMENT 'Run number within the stream.',
  `built_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the worker wrote the row.',
  `session_date` DateTime64(3, 'UTC') COMMENT 'Session date of the generation.',
  `run_started_at` DateTime64(3, 'UTC') COMMENT 'When the run started (run_index.started_at).',
  `kind` LowCardinality(String) COMMENT 'What was received: system_prompt, instructions (CLAUDE.md files loaded at the start), nested_memory (a CLAUDE.md loaded on entering its directory), skill_body, mcp_instructions, agents_md, developer (a block of a Codex developer message).',
  `scope` LowCardinality(String) COMMENT 'Where the setup file lives: repository, plugin, member (the member\'s home or another machine path), harness (the agent\'s own text) or mcp (an MCP server).',
  `owner` String COMMENT 'The repository (host/owner/name), plugin (name@marketplace), member (user id), agent (claude_code, codex) or MCP server the setup file belongs to.',
  `path` String COMMENT 'Path of the setup file within its owner: relative to the repository or plugin root, ~/… in a member\'s home; the harness part or empty for harness and MCP text.',
  `recorded_path` String COMMENT 'The machine path the transcript names; empty for harness and MCP text.',
  `cwd` String COMMENT 'Working directory the transcript recorded when the text was received; empty when not recorded.',
  `chars` UInt32 COMMENT 'Code points of the text received.',
  `version_name` String COMMENT 'The version as shown: its first 12 hex digits, followed by \'uncommitted by <member>\' when the text was uncommitted in that member\'s checkout.',
  `uncommitted` Nullable(Bool) COMMENT 'For a repository file: true when the git status the session recorded at its start lists the file as changed, or the session changed the file before receiving it; false when that status was recorded whole without it; NULL when unknown (no git status recorded, a cut status, not a repository file).',
  `carried` Bool COMMENT 'True when the text was received before the run started (earlier in its stream) and was still the latest version of its setup file; false when received during the run.',
  `compacted_since` Bool COMMENT 'True when the stream recorded a compaction between receiving the text and the run\'s end: the text may have left the context.',
  `received_record` UInt32 COMMENT 'Raw record index of the line that carried the text.',
  `received_block` UInt16 COMMENT 'Block of that line\'s record.',
  `received_at` DateTime64(3, 'UTC') COMMENT 'Time of the line that carried the text.'
) ENGINE = ReplacingMergeTree(build_revision)
PRIMARY KEY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `index_version`, `build_revision`, `agent_id`, `run_start_record`, `setup_file`, `version`)
ORDER BY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `index_version`, `build_revision`, `agent_id`, `run_start_record`, `setup_file`, `version`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Received setup of each run of a run index build: one row per run and setup file version it had, committed by the build\'s run index receipt; written only by the reconciliation worker.';
