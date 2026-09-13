-- chkit-migration-format: v1
-- generated-at: 2026-08-21T11:00:28.592Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 6
-- rename-suggestion-count: 0
-- risk-summary: safe=6, caution=0, danger=0

-- operation: alter_table_add_column key=table:rudel.session_language_signals:column:member_apology_matches risk=safe
ALTER TABLE rudel.session_language_signals ADD COLUMN IF NOT EXISTS `member_apology_matches` Array(String) DEFAULT [];

-- operation: alter_table_add_column key=table:rudel.session_language_signals:column:member_positive_matches risk=safe
ALTER TABLE rudel.session_language_signals ADD COLUMN IF NOT EXISTS `member_positive_matches` Array(String) DEFAULT [];

-- operation: alter_table_add_column key=table:rudel.session_language_signals:column:member_swear_matches risk=safe
ALTER TABLE rudel.session_language_signals ADD COLUMN IF NOT EXISTS `member_swear_matches` Array(String) DEFAULT [];

-- operation: alter_table_add_column key=table:rudel.session_language_signals:column:model_apology_matches risk=safe
ALTER TABLE rudel.session_language_signals ADD COLUMN IF NOT EXISTS `model_apology_matches` Array(String) DEFAULT [];

-- operation: alter_table_add_column key=table:rudel.session_language_signals:column:model_positive_matches risk=safe
ALTER TABLE rudel.session_language_signals ADD COLUMN IF NOT EXISTS `model_positive_matches` Array(String) DEFAULT [];

-- operation: alter_table_add_column key=table:rudel.session_language_signals:column:model_swear_matches risk=safe
ALTER TABLE rudel.session_language_signals ADD COLUMN IF NOT EXISTS `model_swear_matches` Array(String) DEFAULT [];
