-- chkit-migration-format: v1
-- generated-at: 2026-08-25T09:31:33.326Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 8
-- rename-suggestion-count: 0
-- risk-summary: safe=0, caution=8, danger=0

-- operation: alter_table_modify_setting key=table:rudel.claude_sessions:setting:non_replicated_deduplication_window risk=caution
ALTER TABLE rudel.claude_sessions MODIFY SETTING non_replicated_deduplication_window = 1000;

-- operation: alter_table_modify_setting key=table:rudel.codex_sessions:setting:non_replicated_deduplication_window risk=caution
ALTER TABLE rudel.codex_sessions MODIFY SETTING non_replicated_deduplication_window = 1000;

-- operation: alter_table_modify_setting key=table:rudel.session_analytics:setting:non_replicated_deduplication_window risk=caution
ALTER TABLE rudel.session_analytics MODIFY SETTING non_replicated_deduplication_window = 1000;

-- operation: alter_table_modify_setting key=table:rudel.session_language_signals:setting:non_replicated_deduplication_window risk=caution
ALTER TABLE rudel.session_language_signals MODIFY SETTING non_replicated_deduplication_window = 1000;

-- operation: alter_table_modify_setting key=table:rudel.skill_receipts:setting:non_replicated_deduplication_window risk=caution
ALTER TABLE rudel.skill_receipts MODIFY SETTING non_replicated_deduplication_window = 1000;

-- operation: alter_table_modify_setting key=table:rudel.skill_uses:setting:non_replicated_deduplication_window risk=caution
ALTER TABLE rudel.skill_uses MODIFY SETTING non_replicated_deduplication_window = 1000;

-- operation: alter_table_modify_setting key=table:rudel.skill_version_contents:setting:non_replicated_deduplication_window risk=caution
ALTER TABLE rudel.skill_version_contents MODIFY SETTING non_replicated_deduplication_window = 1000;

-- operation: alter_table_modify_setting key=table:rudel.usage_events:setting:non_replicated_deduplication_window risk=caution
ALTER TABLE rudel.usage_events MODIFY SETTING non_replicated_deduplication_window = 1000;
