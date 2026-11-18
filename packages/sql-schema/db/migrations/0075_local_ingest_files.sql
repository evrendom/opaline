CREATE TABLE "local_ingest_file" (
	"path" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"role" text NOT NULL,
	"session_path" text NOT NULL,
	"session_id" text,
	"organization_id" text,
	"user_id" text,
	"device" text NOT NULL,
	"inode" text NOT NULL,
	"size" bigint NOT NULL,
	"mtime_ms" double precision NOT NULL,
	"head_sha256" text,
	"ingested_size" bigint,
	"ingested_tail_sha256" text,
	"ingested_mtime_ms" double precision,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"ingested_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "local_ingest_file_session_path_idx" ON "local_ingest_file" USING btree ("session_path");