CREATE TABLE "organization_feature_readiness" (
	"organization_id" text NOT NULL,
	"feature" text NOT NULL,
	"status" text NOT NULL,
	"first_ready_at" timestamp with time zone,
	"computed_at" timestamp with time zone NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "organization_feature_readiness_organization_id_feature_pk" PRIMARY KEY("organization_id","feature"),
	CONSTRAINT "organization_feature_readiness_feature_check" CHECK ("organization_feature_readiness"."feature" IN ('pr_totals', 'pr_attribution')),
	CONSTRAINT "organization_feature_readiness_status_check" CHECK ("organization_feature_readiness"."status" IN ('not_ready', 'ready'))
);
--> statement-breakpoint
ALTER TABLE "organization_feature_readiness" ADD CONSTRAINT "organization_feature_readiness_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;