-- Per-workspace feature switches from the admin features page: a row
-- overrides the feature's environment list for that workspace. Its foreign
-- keys briefly lock organization and user, so a short lock wait keeps busy
-- tables from queueing requests.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "workspace_feature" (
	"organization_id" text NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_feature_organization_id_feature_pk" PRIMARY KEY("organization_id","feature")
);
--> statement-breakpoint
ALTER TABLE "workspace_feature" ADD CONSTRAINT "workspace_feature_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_feature" ADD CONSTRAINT "workspace_feature_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;