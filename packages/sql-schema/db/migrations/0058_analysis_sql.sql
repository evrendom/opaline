-- Stored results of the analysis sql tool and its per-workspace quota
-- (docs/adr/0005-agents-query-l1-with-sql.md). Both are new tables, so the
-- migration takes no lock on existing data.
CREATE TABLE "analysis_sql_quota" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"query_count" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_sql_result" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"query" text NOT NULL,
	"output" jsonb NOT NULL,
	"owner_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_sql_quota" ADD CONSTRAINT "analysis_sql_quota_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sql_result" ADD CONSTRAINT "analysis_sql_result_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sql_result" ADD CONSTRAINT "analysis_sql_result_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_sql_result_organization_idx" ON "analysis_sql_result" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "analysis_sql_result_author_idx" ON "analysis_sql_result" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "analysis_sql_result_owner_ids_idx" ON "analysis_sql_result" USING gin ("owner_ids");--> statement-breakpoint
CREATE INDEX "analysis_sql_result_created_at_idx" ON "analysis_sql_result" USING btree ("created_at");
