ALTER TABLE rudel.usage_session_rollups
    ADD COLUMN IF NOT EXISTS estimated_costs Array(Nullable(Float64)) DEFAULT arrayMap(kind -> CAST(NULL, 'Nullable(Float64)'), record_kinds) COMMENT 'Per pricing group: estimated cost in USD against the rate card the row was built with; NULL when the group cannot be priced, and on rows written before the column existed.' AFTER output_tokens,
    ADD COLUMN IF NOT EXISTS pricing_models Array(LowCardinality(String)) DEFAULT arrayMap(kind -> '', record_kinds) COMMENT 'Per pricing group: the rate card model its pricing identity resolves to; empty when none does, and on rows written before the column existed.' AFTER estimated_costs,
    COMMENT COLUMN build_version 'Fingerprint of the grouping and pricing rules that built the row, rate card included; rows of another fingerprint are rebuilt.';

ALTER TABLE rudel.usage_session_rollups
    MODIFY COMMENT 'Request usage of a session summed per pricing group (date, model identity, provider, tier, speed, geography, context band), one row per session from its latest usage-event generation; each group priced against the rate card when the row is built.';
