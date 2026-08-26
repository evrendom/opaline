ALTER TABLE "session_ownership"
	ADD COLUMN "revision_head" bigint DEFAULT 0 NOT NULL,
	ADD COLUMN "last_revision" bigint;
--> statement-breakpoint
CREATE TABLE "session_ingest_revision" (
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"content_sha256" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_ingest_revision_pkey"
		PRIMARY KEY("organization_id", "session_id", "operation_id", "content_sha256"),
	CONSTRAINT "session_ingest_revision_hash_check"
		CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "session_ingest_revision_value_check"
		CHECK ("revision" > 0),
	CONSTRAINT "session_ingest_revision_session_ownership_fk"
		FOREIGN KEY ("organization_id", "session_id")
		REFERENCES "session_ownership"("organization_id", "session_id")
		ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "session_ingest_revision_value_idx"
	ON "session_ingest_revision" USING btree (
		"organization_id",
		"session_id",
		"revision"
	);
--> statement-breakpoint
CREATE INDEX "session_ingest_revision_created_at_idx"
	ON "session_ingest_revision" USING btree ("created_at");
