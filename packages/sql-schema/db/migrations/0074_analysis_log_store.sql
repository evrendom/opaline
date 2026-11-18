CREATE TABLE "analysis_log_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"workspace_id" text NOT NULL,
	"author_id" text NOT NULL,
	"host" text NOT NULL,
	"question" text NOT NULL,
	"status" text NOT NULL,
	"draft" boolean NOT NULL,
	"shared" boolean NOT NULL,
	"pinned" boolean NOT NULL,
	"created_at" text NOT NULL,
	"cutoff" text NOT NULL,
	"scope" jsonb NOT NULL,
	"final_answer" text,
	"topics" jsonb NOT NULL,
	"updates" text,
	"changes" jsonb NOT NULL,
	"notes" jsonb NOT NULL,
	"cost" jsonb,
	"query_count" integer NOT NULL,
	"step_count" integer NOT NULL,
	"visibility_revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_log_embedding" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"analysis_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"step_id" text,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"model" text NOT NULL,
	"vector" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_log_query" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"analysis_id" text NOT NULL,
	"step_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"author_id" text NOT NULL,
	"tool" text NOT NULL,
	"args_json" text NOT NULL,
	"output_chars" integer NOT NULL,
	"has_output" boolean NOT NULL,
	"owner_ids" text[] NOT NULL,
	"created_at" text NOT NULL,
	"removed" boolean NOT NULL,
	"counts" boolean NOT NULL,
	"redaction_args_json" text,
	"redaction_label" text
);
--> statement-breakpoint
CREATE TABLE "analysis_log_query_output" (
	"query_id" text PRIMARY KEY NOT NULL,
	"json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_log_query_session" (
	"query_id" text NOT NULL,
	"session_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"revision" text NOT NULL,
	"parser_version" integer NOT NULL,
	CONSTRAINT "analysis_log_query_session_query_id_session_id_pk" PRIMARY KEY("query_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "analysis_log_session_link" (
	"analysis_id" text NOT NULL,
	"source" text NOT NULL,
	"session_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"uploaded_at" text NOT NULL,
	CONSTRAINT "analysis_log_session_link_analysis_id_source_session_id_pk" PRIMARY KEY("analysis_id","source","session_id")
);
--> statement-breakpoint
CREATE TABLE "analysis_log_step" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"analysis_id" text NOT NULL,
	"parent_id" text,
	"ordinal" double precision NOT NULL,
	"question" text NOT NULL,
	"reply" text,
	"finding" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_log_embedding" ADD CONSTRAINT "analysis_log_embedding_analysis_id_analysis_log_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analysis_log_analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_log_query" ADD CONSTRAINT "analysis_log_query_analysis_id_analysis_log_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analysis_log_analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_log_query_output" ADD CONSTRAINT "analysis_log_query_output_query_id_analysis_log_query_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."analysis_log_query"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_log_query_session" ADD CONSTRAINT "analysis_log_query_session_query_id_analysis_log_query_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."analysis_log_query"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_log_session_link" ADD CONSTRAINT "analysis_log_session_link_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analysis_log_analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_log_step" ADD CONSTRAINT "analysis_log_step_analysis_id_analysis_log_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analysis_log_analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_log_analysis_workspace_idx" ON "analysis_log_analysis" USING btree ("workspace_id","author_id");--> statement-breakpoint
CREATE INDEX "analysis_log_analysis_author_idx" ON "analysis_log_analysis" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "analysis_log_analysis_updates_idx" ON "analysis_log_analysis" USING btree ("workspace_id","updates");--> statement-breakpoint
CREATE INDEX "analysis_log_analysis_draft_idx" ON "analysis_log_analysis" USING btree ("draft","created_at");--> statement-breakpoint
CREATE INDEX "analysis_log_embedding_space_idx" ON "analysis_log_embedding" USING btree ("workspace_id","model");--> statement-breakpoint
CREATE INDEX "analysis_log_embedding_analysis_idx" ON "analysis_log_embedding" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "analysis_log_query_analysis_idx" ON "analysis_log_query" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "analysis_log_query_owner_ids_idx" ON "analysis_log_query" USING gin ("owner_ids");--> statement-breakpoint
CREATE INDEX "analysis_log_query_output_created_idx" ON "analysis_log_query" USING btree ("has_output","created_at");--> statement-breakpoint
CREATE INDEX "analysis_log_query_session_owner_idx" ON "analysis_log_query_session" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "analysis_log_session_link_owner_idx" ON "analysis_log_session_link" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "analysis_log_step_analysis_idx" ON "analysis_log_step" USING btree ("analysis_id");