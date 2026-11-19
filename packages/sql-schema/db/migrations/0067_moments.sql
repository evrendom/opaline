-- Moment observations, members' votes on them, and fixes recorded against
-- patterns. Their foreign keys briefly lock organization and user, so a short
-- lock wait keeps busy tables from queueing requests.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "moment_feedback" (
	"observation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"useful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moment_feedback_observation_id_user_id_pk" PRIMARY KEY("observation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "moment_fix" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"layer" text NOT NULL,
	"note" text NOT NULL,
	"pattern_observation_id" text NOT NULL,
	"centroid" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moment_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"turn_idx" integer NOT NULL,
	"kind" text NOT NULL,
	"revision" text NOT NULL,
	"run_started_at" timestamp with time zone NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"layer" text NOT NULL,
	"what_happened" text NOT NULL,
	"lesson" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"false_positive" boolean NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moment_feedback" ADD CONSTRAINT "moment_feedback_observation_id_moment_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."moment_observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_feedback" ADD CONSTRAINT "moment_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_fix" ADD CONSTRAINT "moment_fix_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_fix" ADD CONSTRAINT "moment_fix_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_observation" ADD CONSTRAINT "moment_observation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_observation" ADD CONSTRAINT "moment_observation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_observation" ADD CONSTRAINT "moment_observation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moment_feedback_user_id_idx" ON "moment_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "moment_fix_organization_id_idx" ON "moment_fix" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moment_observation_moment_unique" ON "moment_observation" USING btree ("organization_id","user_id","session_id","agent_id","turn_idx","kind","revision","prompt_version");--> statement-breakpoint
CREATE INDEX "moment_observation_organization_created_idx" ON "moment_observation" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "moment_observation_organization_run_started_idx" ON "moment_observation" USING btree ("organization_id","run_started_at");--> statement-breakpoint
CREATE INDEX "moment_observation_user_id_idx" ON "moment_observation" USING btree ("user_id");