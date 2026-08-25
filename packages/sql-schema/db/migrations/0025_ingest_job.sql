CREATE TABLE "ingest_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"object_manifest" jsonb NOT NULL,
	"expected_sizes" jsonb NOT NULL,
	"expected_total_bytes" integer NOT NULL,
	"client_hashes" jsonb NOT NULL,
	"ingest_metadata" jsonb NOT NULL,
	"content_sha256" text,
	"result" jsonb,
	"last_error_code" text,
	"last_error_message" text,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"objects_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_job_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "ingest_job_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
	CONSTRAINT "ingest_job_status_check"
		CHECK ("status" IN ('pending', 'running', 'completed', 'failed')),
	CONSTRAINT "ingest_job_source_check"
		CHECK ("source" IN ('claude_code', 'codex')),
	CONSTRAINT "ingest_job_attempts_check"
		CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts"),
	CONSTRAINT "ingest_job_max_attempts_check"
		CHECK ("max_attempts" > 0),
	CONSTRAINT "ingest_job_expected_total_bytes_check"
		CHECK ("expected_total_bytes" >= 0 AND "expected_total_bytes" <= 134217728),
	CONSTRAINT "ingest_job_json_shape_check"
		CHECK (
			jsonb_typeof("object_manifest") = 'array'
			AND jsonb_typeof("expected_sizes") = 'object'
			AND jsonb_typeof("client_hashes") = 'object'
			AND jsonb_typeof("ingest_metadata") = 'object'
		),
	CONSTRAINT "ingest_job_content_sha256_check"
		CHECK ("content_sha256" IS NULL OR "content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ingest_job_lease_check"
		CHECK (
			(
				"status" = 'running'
				AND "lease_token" IS NOT NULL
				AND length(btrim("lease_token")) > 0
				AND "lease_expires_at" IS NOT NULL
			) OR (
				"status" <> 'running'
				AND "lease_token" IS NULL
				AND "lease_expires_at" IS NULL
			)
		),
	CONSTRAINT "ingest_job_error_check"
		CHECK (("last_error_code" IS NULL) = ("last_error_message" IS NULL)),
	CONSTRAINT "ingest_job_terminal_state_check"
		CHECK (
			(
				"status" = 'completed'
				AND "completed_at" IS NOT NULL
				AND "failed_at" IS NULL
				AND "content_sha256" IS NOT NULL
				AND "result" IS NOT NULL
			) OR (
				"status" = 'failed'
				AND "completed_at" IS NULL
				AND "failed_at" IS NOT NULL
				AND "last_error_code" IS NOT NULL
			) OR (
				"status" IN ('pending', 'running')
				AND "completed_at" IS NULL
				AND "failed_at" IS NULL
			)
		)
);
--> statement-breakpoint
CREATE INDEX "ingest_job_pending_available_idx"
	ON "ingest_job" USING btree ("available_at")
	WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "ingest_job_running_lease_expiry_idx"
	ON "ingest_job" USING btree ("lease_expires_at")
	WHERE "status" = 'running';
--> statement-breakpoint
CREATE INDEX "ingest_job_cleanup_idx"
	ON "ingest_job" USING btree ("completed_at")
	WHERE "status" = 'completed' AND "objects_deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "ingest_job_session_idx"
	ON "ingest_job" USING btree ("organization_id", "session_id");
