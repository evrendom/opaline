CREATE TABLE "repository_upload_report" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"repositories" jsonb NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_upload_report_pkey" PRIMARY KEY("organization_id","user_id","installation_id")
);
--> statement-breakpoint
ALTER TABLE "repository_upload_report" ADD CONSTRAINT "repository_upload_report_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_upload_report" ADD CONSTRAINT "repository_upload_report_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;