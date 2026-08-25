CREATE TABLE "ingest_processing_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"filtered_content_sha256" text NOT NULL,
	"filter_version" integer NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"raw_ingested_at" timestamp with time zone NOT NULL,
	"usage_generation" bigint,
	"result" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_processing_ledger_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "ingest_processing_ledger_hash_check"
		CHECK ("filtered_content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ingest_processing_ledger_filter_version_check"
		CHECK ("filter_version" >= 0),
	CONSTRAINT "ingest_processing_ledger_status_check"
		CHECK ("status" IN ('processing', 'completed')),
	CONSTRAINT "ingest_processing_ledger_terminal_check"
		CHECK (
			(
				"status" = 'completed'
				AND "result" IS NOT NULL
				AND "completed_at" IS NOT NULL
			) OR (
				"status" = 'processing'
				AND "completed_at" IS NULL
			)
		)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_processing_ledger_identity_idx"
	ON "ingest_processing_ledger" USING btree (
		"organization_id",
		"session_id",
		"filtered_content_sha256",
		"filter_version"
	);
--> statement-breakpoint
CREATE TABLE "ingest_processing_target_receipt" (
	"ledger_id" text NOT NULL,
	"target" text NOT NULL,
	"expected_row_count" integer NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_processing_target_receipt_pkey"
		PRIMARY KEY ("ledger_id", "target"),
	CONSTRAINT "ingest_processing_target_receipt_ledger_id_ingest_processing_ledger_id_fk"
		FOREIGN KEY ("ledger_id") REFERENCES "ingest_processing_ledger"("id") ON DELETE CASCADE,
	CONSTRAINT "ingest_processing_target_receipt_target_check"
		CHECK (
			"target" IN (
				'rudel.claude_sessions',
				'rudel.codex_sessions',
				'rudel.session_language_signals',
				'rudel.skill_receipts',
				'rudel.skill_uses',
				'rudel.skill_version_contents',
				'rudel.usage_events'
			)
		),
	CONSTRAINT "ingest_processing_target_receipt_row_count_check"
		CHECK ("expected_row_count" > 0)
);
--> statement-breakpoint
DROP INDEX "ingest_job_cleanup_idx";
--> statement-breakpoint
CREATE INDEX "ingest_job_cleanup_idx"
	ON "ingest_job" USING btree ("updated_at")
	WHERE "status" IN ('completed', 'failed') AND "objects_deleted_at" IS NULL;
