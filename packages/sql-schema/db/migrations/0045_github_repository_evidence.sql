CREATE TABLE "github_app_installation" (
	"installation_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"installed_by_user_id" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_installation_workspace_uidx" UNIQUE("organization_id","installation_id"),
	CONSTRAINT "github_app_installation_account_type_check" CHECK ("github_app_installation"."account_type" IN ('Organization', 'User')),
	CONSTRAINT "github_app_installation_selection_check" CHECK ("github_app_installation"."repository_selection" IN ('all', 'selected')),
	CONSTRAINT "github_app_installation_status_check" CHECK ("github_app_installation"."status" IN ('active', 'suspended', 'deleted')),
	CONSTRAINT "github_app_installation_permissions_check" CHECK (jsonb_typeof("github_app_installation"."permissions") = 'object')
);
--> statement-breakpoint
CREATE TABLE "github_ci_log_receipt" (
	"organization_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"run_attempt" integer NOT NULL,
	"job_id" text NOT NULL,
	"job_name" text NOT NULL,
	"status" text NOT NULL,
	"conclusion" text,
	"object_id" text,
	"object_key" text,
	"original_byte_length" integer,
	"stored_byte_length" integer,
	"filter_version" integer NOT NULL,
	"redaction_counts" jsonb NOT NULL,
	"truncated" boolean,
	"unavailable_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_ci_log_receipt_pkey" PRIMARY KEY("collection_id","job_id"),
	CONSTRAINT "github_ci_log_receipt_attempt_check" CHECK ("github_ci_log_receipt"."run_attempt" > 0),
	CONSTRAINT "github_ci_log_receipt_sizes_check" CHECK (("github_ci_log_receipt"."original_byte_length" IS NULL OR "github_ci_log_receipt"."original_byte_length" >= 0) AND ("github_ci_log_receipt"."stored_byte_length" IS NULL OR "github_ci_log_receipt"."stored_byte_length" >= 0)),
	CONSTRAINT "github_ci_log_receipt_object_check" CHECK (("github_ci_log_receipt"."object_id" IS NULL) = ("github_ci_log_receipt"."object_key" IS NULL)),
	CONSTRAINT "github_ci_log_receipt_redactions_check" CHECK (jsonb_typeof("github_ci_log_receipt"."redaction_counts") = 'object')
);
--> statement-breakpoint
CREATE TABLE "github_evidence_collection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"initiated_by_user_id" text,
	"session_id" text DEFAULT '' NOT NULL,
	"session_source" text DEFAULT '' NOT NULL,
	"session_user_id" text DEFAULT '' NOT NULL,
	"context_id" text DEFAULT '' NOT NULL,
	"commit_sha" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"retry_of_collection_id" text,
	"status" text DEFAULT 'collecting' NOT NULL,
	"source_version" text NOT NULL,
	"coverage" jsonb NOT NULL,
	"metadata_object_id" text,
	"metadata_object_key" text,
	"metadata_chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observation_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refresh_due_at" timestamp with time zone,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"retry_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_evidence_collection_sha_check" CHECK ("github_evidence_collection"."commit_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "github_evidence_collection_status_check" CHECK ("github_evidence_collection"."status" IN ('queued', 'collecting', 'complete', 'partial', 'failed', 'cancelled')),
	CONSTRAINT "github_evidence_collection_attempt_check" CHECK ("github_evidence_collection"."attempt_number" > 0 AND "github_evidence_collection"."retry_count" >= 0),
	CONSTRAINT "github_evidence_collection_lease_check" CHECK (("github_evidence_collection"."status" = 'collecting') = ("github_evidence_collection"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "github_evidence_collection_coverage_check" CHECK (jsonb_typeof("github_evidence_collection"."coverage") = 'object'),
	CONSTRAINT "github_evidence_collection_receipt_check" CHECK (("github_evidence_collection"."metadata_object_id" IS NULL) = ("github_evidence_collection"."metadata_object_key" IS NULL)),
	CONSTRAINT "github_evidence_collection_metadata_chunks_check" CHECK (jsonb_typeof("github_evidence_collection"."metadata_chunks") = 'array')
);
--> statement-breakpoint
CREATE TABLE "github_evidence_object_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"object_key" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_evidence_object_intent_key_check" CHECK (length(btrim("github_evidence_object_intent"."object_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_snapshot" (
	"organization_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"provider_pull_request_id" text NOT NULL,
	"pull_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"merged_at" timestamp with time zone,
	"session_id" text DEFAULT '' NOT NULL,
	"session_source" text DEFAULT '' NOT NULL,
	"session_user_id" text DEFAULT '' NOT NULL,
	"coverage_complete" boolean NOT NULL,
	"ci_coverage_complete" boolean NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_pull_request_snapshot_pkey" PRIMARY KEY("collection_id","provider_pull_request_id"),
	CONSTRAINT "github_pull_request_snapshot_provider_check" CHECK ("github_pull_request_snapshot"."provider" = 'github')
);
--> statement-breakpoint
CREATE TABLE "github_repository_binding" (
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"node_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"is_private" boolean NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_repository_binding_pkey" PRIMARY KEY("organization_id","repository_id"),
	CONSTRAINT "github_repository_binding_status_check" CHECK ("github_repository_binding"."status" IN ('active', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "github_app_installation" ADD CONSTRAINT "github_app_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_installation" ADD CONSTRAINT "github_app_installation_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_ci_log_receipt" ADD CONSTRAINT "github_ci_log_receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_ci_log_receipt" ADD CONSTRAINT "github_ci_log_receipt_collection_id_github_evidence_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."github_evidence_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_evidence_collection" ADD CONSTRAINT "github_evidence_collection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_evidence_collection" ADD CONSTRAINT "github_evidence_collection_initiated_by_user_id_user_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_evidence_collection" ADD CONSTRAINT "github_evidence_collection_workspace_installation_fk" FOREIGN KEY ("organization_id","installation_id") REFERENCES "public"."github_app_installation"("organization_id","installation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_snapshot" ADD CONSTRAINT "github_pull_request_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_snapshot" ADD CONSTRAINT "github_pull_request_snapshot_collection_id_github_evidence_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."github_evidence_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repository_binding" ADD CONSTRAINT "github_repository_binding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repository_binding" ADD CONSTRAINT "github_repository_binding_workspace_installation_fk" FOREIGN KEY ("organization_id","installation_id") REFERENCES "public"."github_app_installation"("organization_id","installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_app_installation_org_idx" ON "github_app_installation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_ci_log_receipt_job_idx" ON "github_ci_log_receipt" USING btree ("organization_id","repository_id","workflow_run_id","run_attempt","job_id");--> statement-breakpoint
CREATE INDEX "github_evidence_collection_refresh_idx" ON "github_evidence_collection" USING btree ("refresh_due_at") WHERE "github_evidence_collection"."refresh_due_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "github_evidence_collection_identity_uidx" ON "github_evidence_collection" USING btree ("organization_id","repository_id","commit_sha","session_id","context_id","attempt_number");--> statement-breakpoint
CREATE INDEX "github_evidence_collection_pending_idx" ON "github_evidence_collection" USING btree ("started_at") WHERE "github_evidence_collection"."status" = 'collecting';--> statement-breakpoint
CREATE INDEX "github_evidence_collection_queue_idx" ON "github_evidence_collection" USING btree ("retry_after") WHERE "github_evidence_collection"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "github_evidence_collection_commit_idx" ON "github_evidence_collection" USING btree ("organization_id","repository_id","commit_sha");--> statement-breakpoint
CREATE INDEX "github_evidence_collection_retry_idx" ON "github_evidence_collection" USING btree ("retry_after") WHERE "github_evidence_collection"."status" IN ('failed', 'partial') AND "github_evidence_collection"."retry_after" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "github_evidence_object_intent_due_idx" ON "github_evidence_object_intent" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "github_evidence_object_intent_collection_idx" ON "github_evidence_object_intent" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "github_evidence_object_intent_key_idx" ON "github_evidence_object_intent" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "github_evidence_object_intent_organization_idx" ON "github_evidence_object_intent" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_snapshot_dashboard_idx" ON "github_pull_request_snapshot" USING btree ("organization_id","merged_at","repository_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_snapshot_identity_idx" ON "github_pull_request_snapshot" USING btree ("organization_id","repository_id","provider","provider_pull_request_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "github_repository_binding_name_uidx" ON "github_repository_binding" USING btree ("organization_id","owner","name");--> statement-breakpoint
CREATE INDEX "github_repository_binding_installation_idx" ON "github_repository_binding" USING btree ("installation_id");