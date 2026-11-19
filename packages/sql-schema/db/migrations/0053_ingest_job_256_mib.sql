-- Direct-to-R2 ingest accepts sessions up to 256 MiB (direct ingestSession
-- stays at 128 MiB). Online-safe: drizzle runs every pending migration in one
-- transaction, so this only swaps the constraint as NOT VALID under a short
-- lock wait (no scan while ACCESS EXCLUSIVE is held). `bun run migrate`
-- validates it afterwards in its own transaction, which takes only SHARE
-- UPDATE EXCLUSIVE (src/post-migrate.ts). Until then new and updated rows are
-- already checked; existing rows all satisfy the wider bound.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ingest_job"
	DROP CONSTRAINT "ingest_job_expected_total_bytes_check",
	ADD CONSTRAINT "ingest_job_expected_total_bytes_check"
		CHECK ("expected_total_bytes" >= 0 AND "expected_total_bytes" <= 268435456) NOT VALID;
