CREATE TABLE "github_repository_sweep" (
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"dataset" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retention_boundary" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" varchar(512),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_repository_sweep_pkey" PRIMARY KEY("organization_id","repository_id","dataset","window_start","window_end"),
	CONSTRAINT "github_repository_sweep_status_check" CHECK ("github_repository_sweep"."status" IN ('pending', 'complete', 'split', 'unavailable')),
	CONSTRAINT "github_repository_sweep_dataset_check" CHECK ("github_repository_sweep"."dataset" IN ('actions', 'jobs', 'attempts', 'pulls', 'external', 'commits'))
);
--> statement-breakpoint
ALTER TABLE "github_app_installation" ADD COLUMN "sweep_rate_remaining" integer;--> statement-breakpoint
ALTER TABLE "github_app_installation" ADD COLUMN "sweep_rate_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_repository_sweep" ADD CONSTRAINT "github_repository_sweep_binding_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."github_repository_binding"("organization_id","repository_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_repository_sweep_pending_idx" ON "github_repository_sweep" USING btree ("status","dataset","window_start");