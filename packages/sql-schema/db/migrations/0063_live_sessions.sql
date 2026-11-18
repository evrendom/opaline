-- Live sessions: the transcript lines of running Claude Code and Codex
-- sessions (rows here, line bytes in R2), keyed by source so a Claude session
-- id and a Codex thread id never collide. The three tables are new; their
-- foreign keys briefly lock organization and user. The live session append
-- budget gets its own ingest_rate_limit_counter row per user (limiter_key
-- 'live_session_user:<id>'), so user_id is no longer unique there; a plain
-- index keeps the user deletion cascade indexed. Both statements on that
-- small table take a short exclusive lock, so a short lock wait keeps busy
-- tables from queueing requests.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "live_session" (
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"source" text NOT NULL,
	"user_id" text NOT NULL,
	"project_path" text NOT NULL,
	"git_remote" text,
	"git_branch" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "live_session_pkey" PRIMARY KEY("organization_id","source","session_id"),
	CONSTRAINT "live_session_source_check" CHECK ("live_session"."source" IN ('claude_code', 'codex'))
);
--> statement-breakpoint
CREATE TABLE "live_session_chunk" (
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"generation" integer NOT NULL,
	"start_line" integer NOT NULL,
	"line_count" integer NOT NULL,
	"byte_length" bigint NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_session_chunk_pkey" PRIMARY KEY("organization_id","source","session_id","agent_id","generation","start_line"),
	CONSTRAINT "live_session_chunk_value_check" CHECK ("live_session_chunk"."generation" >= 0 AND "live_session_chunk"."start_line" >= 0 AND "live_session_chunk"."line_count" > 0 AND "live_session_chunk"."byte_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "live_session_stream" (
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"committed_lines" integer DEFAULT 0 NOT NULL,
	"committed_bytes" bigint DEFAULT 0 NOT NULL,
	"last_line_sha256" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_session_stream_pkey" PRIMARY KEY("organization_id","source","session_id","agent_id"),
	CONSTRAINT "live_session_stream_value_check" CHECK ("live_session_stream"."generation" >= 0 AND "live_session_stream"."committed_lines" >= 0 AND "live_session_stream"."committed_bytes" >= 0),
	CONSTRAINT "live_session_stream_last_line_check" CHECK (("live_session_stream"."committed_lines" = 0) = ("live_session_stream"."last_line_sha256" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "live_session" ADD CONSTRAINT "live_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_session" ADD CONSTRAINT "live_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_session_chunk" ADD CONSTRAINT "live_session_chunk_stream_fk" FOREIGN KEY ("organization_id","source","session_id","agent_id") REFERENCES "public"."live_session_stream"("organization_id","source","session_id","agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_session_stream" ADD CONSTRAINT "live_session_stream_session_fk" FOREIGN KEY ("organization_id","source","session_id") REFERENCES "public"."live_session"("organization_id","source","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_session_activity_idx" ON "live_session" USING btree ("organization_id","last_activity_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "live_session_last_activity_idx" ON "live_session" USING btree ("last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_session_chunk_object_key_idx" ON "live_session_chunk" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "live_session_stream_reset_idx" ON "live_session_stream" USING btree ("organization_id","source","session_id","agent_id") WHERE "live_session_stream"."generation" > 0;--> statement-breakpoint
CREATE INDEX "ingest_rate_limit_counter_user_id_idx" ON "ingest_rate_limit_counter" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "ingest_rate_limit_counter" DROP CONSTRAINT "ingest_rate_limit_counter_user_id_unique";