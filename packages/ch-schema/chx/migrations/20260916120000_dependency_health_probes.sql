-- Operational canaries only: no sessions, users, or product analytics events.
-- Match the session tables' MergeTree family and s3 storage policy so the probe
-- exercises persistent storage, not a Memory/Null table or SELECT 1 frontend.
CREATE TABLE IF NOT EXISTS rudel.dependency_health_probes
(
    probe_id UUID,
    probed_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(probed_at)
ORDER BY probe_id
TTL probed_at + INTERVAL 1 DAY
SETTINGS storage_policy = 's3';
