-- Transcript search's per-workspace OpenAI quota, and run questions: the
-- catalogue Opaline manages in its internal form, the answering jobs
-- run_questions and form tests queue, and each workspace's answer quota.
-- All four are new tables; their foreign keys briefly lock organization and
-- user, so a short lock wait keeps busy tables from queueing requests.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "run_question" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"replaces" text,
	"criteria_true" text,
	"criteria_false" text,
	"tested_runs" integer,
	"tested_provider" text,
	"tested_precision" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "run_question_state_check" CHECK ("run_question"."state" IN ('draft', 'on', 'retired')),
	CONSTRAINT "run_question_criteria_check" CHECK (("run_question"."criteria_true" IS NULL) = ("run_question"."criteria_false" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "run_question_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"question_ids" text[] NOT NULL,
	"runs" jsonb NOT NULL,
	"owner_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"answers_requested" integer NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_question_job_status_check" CHECK ("run_question_job"."status" IN ('queued', 'done', 'failed')),
	CONSTRAINT "run_question_job_purpose_check" CHECK ("run_question_job"."purpose" IN ('analysis', 'test'))
);
--> statement-breakpoint
CREATE TABLE "run_question_quota" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"answers" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_embedding_quota" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"token_count" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_question_job" ADD CONSTRAINT "run_question_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_question_job" ADD CONSTRAINT "run_question_job_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_question_quota" ADD CONSTRAINT "run_question_quota_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_embedding_quota" ADD CONSTRAINT "transcript_embedding_quota_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_question_live_wording_idx" ON "run_question" USING btree ("question") WHERE "run_question"."state" <> 'retired';--> statement-breakpoint
CREATE INDEX "run_question_job_due_idx" ON "run_question_job" USING btree ("next_attempt_at") WHERE "run_question_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "run_question_job_organization_idx" ON "run_question_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "run_question_job_requested_by_idx" ON "run_question_job" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "run_question_job_owner_ids_idx" ON "run_question_job" USING gin ("owner_ids");