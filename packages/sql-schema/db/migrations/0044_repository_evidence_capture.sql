CREATE TABLE "clickhouse_purge_object" (
	"purge_job_id" text NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clickhouse_purge_object_pkey" PRIMARY KEY("purge_job_id","object_key"),
	CONSTRAINT "clickhouse_purge_object_key_check" CHECK (length(btrim("clickhouse_purge_object"."object_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "repository_evidence_capture" (
	"organization_id" text NOT NULL,
	"context_id" text NOT NULL,
	"user_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"manifest_object_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"local_repository_id" text NOT NULL,
	"local_worktree_id" text NOT NULL,
	"provider" text,
	"provider_host" text,
	"provider_repository_id" text,
	"provider_repository_node_id" text,
	"provider_owner" text,
	"provider_name" text,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"agent_id" text,
	"parent_agent_id" text,
	"source" text NOT NULL,
	"lifecycle" text NOT NULL,
	"base_git_commit" text,
	"head_git_commit" text,
	"captured_at" timestamp with time zone NOT NULL,
	"coverage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_evidence_capture_pkey" PRIMARY KEY("organization_id","context_id"),
	CONSTRAINT "repository_evidence_capture_source_check" CHECK ("repository_evidence_capture"."source" IN ('claude_code', 'codex')),
	CONSTRAINT "repository_evidence_capture_lifecycle_check" CHECK ("repository_evidence_capture"."lifecycle" IN ('start', 'resume', 'checkpoint', 'end')),
	CONSTRAINT "repository_evidence_capture_provider_check" CHECK (("repository_evidence_capture"."provider" IS NULL AND "repository_evidence_capture"."provider_host" IS NULL AND "repository_evidence_capture"."provider_repository_id" IS NULL AND "repository_evidence_capture"."provider_repository_node_id" IS NULL AND "repository_evidence_capture"."provider_owner" IS NULL AND "repository_evidence_capture"."provider_name" IS NULL) OR ("repository_evidence_capture"."provider" = 'github' AND "repository_evidence_capture"."provider_host" IS NOT NULL AND "repository_evidence_capture"."provider_repository_id" IS NOT NULL AND "repository_evidence_capture"."provider_repository_node_id" IS NOT NULL AND "repository_evidence_capture"."provider_owner" IS NOT NULL AND "repository_evidence_capture"."provider_name" IS NOT NULL)),
	CONSTRAINT "repository_evidence_capture_coverage_check" CHECK (jsonb_typeof("repository_evidence_capture"."coverage") = 'array')
);
--> statement-breakpoint
CREATE TABLE "repository_evidence_object" (
	"organization_id" text NOT NULL,
	"object_id" text NOT NULL,
	"object_key" text NOT NULL,
	"kind" text NOT NULL,
	"byte_length" integer NOT NULL,
	"media_type" text NOT NULL,
	"content_encoding" text NOT NULL,
	"filter_version" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_evidence_object_pkey" PRIMARY KEY("organization_id","object_id"),
	CONSTRAINT "repository_evidence_object_id_check" CHECK ("repository_evidence_object"."object_id" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "repository_evidence_object_kind_check" CHECK ("repository_evidence_object"."kind" IN ('context-manifest', 'source-blob', 'git-diff', 'transcript-chunk', 'ci-metadata', 'ci-log')),
	CONSTRAINT "repository_evidence_object_encoding_check" CHECK ("repository_evidence_object"."content_encoding" IN ('identity', 'gzip')),
	CONSTRAINT "repository_evidence_object_status_check" CHECK ("repository_evidence_object"."status" IN ('pending', 'available')),
	CONSTRAINT "repository_evidence_object_size_check" CHECK ("repository_evidence_object"."byte_length" > 0 AND "repository_evidence_object"."byte_length" <= 67108864),
	CONSTRAINT "repository_evidence_object_availability_check" CHECK (("repository_evidence_object"."status" = 'available') = ("repository_evidence_object"."available_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "repository_evidence_upload" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"context_id" text NOT NULL,
	"manifest_object_id" text NOT NULL,
	"status" text DEFAULT 'initialized' NOT NULL,
	"request" jsonb NOT NULL,
	"missing_object_ids" jsonb NOT NULL,
	"receipt_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_evidence_upload_status_check" CHECK ("repository_evidence_upload"."status" IN ('initialized', 'committed', 'failed', 'expired')),
	CONSTRAINT "repository_evidence_upload_json_check" CHECK (jsonb_typeof("repository_evidence_upload"."request") = 'object' AND jsonb_typeof("repository_evidence_upload"."missing_object_ids") = 'array'),
	CONSTRAINT "repository_evidence_upload_terminal_check" CHECK (("repository_evidence_upload"."status" = 'committed' AND "repository_evidence_upload"."receipt_id" IS NOT NULL AND "repository_evidence_upload"."committed_at" IS NOT NULL) OR ("repository_evidence_upload"."status" <> 'committed' AND "repository_evidence_upload"."receipt_id" IS NULL AND "repository_evidence_upload"."committed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "repository_evidence_upload_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"upload_receipt_id" text NOT NULL,
	"object_key" text NOT NULL,
	"upload_id" text,
	"delete_object" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_evidence_upload_intent_key_check" CHECK (length(btrim("repository_evidence_upload_intent"."object_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "repository_evidence_upload_object" (
	"upload_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"object_id" text NOT NULL,
	CONSTRAINT "repository_evidence_upload_object_pkey" PRIMARY KEY("upload_id","object_id")
);
--> statement-breakpoint
ALTER TABLE "clickhouse_purge_object" ADD CONSTRAINT "clickhouse_purge_object_purge_job_id_clickhouse_purge_job_id_fk" FOREIGN KEY ("purge_job_id") REFERENCES "public"."clickhouse_purge_job"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "repository_evidence_capture" ADD CONSTRAINT "repository_evidence_capture_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_evidence_capture" ADD CONSTRAINT "repository_evidence_capture_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_evidence_capture" ADD CONSTRAINT "repository_evidence_capture_upload_id_repository_evidence_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."repository_evidence_upload"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_evidence_object" ADD CONSTRAINT "repository_evidence_object_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_evidence_upload" ADD CONSTRAINT "repository_evidence_upload_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_evidence_upload" ADD CONSTRAINT "repository_evidence_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_evidence_upload_object" ADD CONSTRAINT "repository_evidence_upload_object_upload_id_repository_evidence_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."repository_evidence_upload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_evidence_upload_object" ADD CONSTRAINT "repository_evidence_upload_object_object_fk" FOREIGN KEY ("organization_id","object_id") REFERENCES "public"."repository_evidence_object"("organization_id","object_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_evidence_capture_upload_uidx" ON "repository_evidence_capture" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "repository_evidence_capture_session_idx" ON "repository_evidence_capture" USING btree ("organization_id","session_id","captured_at");--> statement-breakpoint
CREATE INDEX "repository_evidence_capture_repo_idx" ON "repository_evidence_capture" USING btree ("organization_id","local_repository_id","captured_at");--> statement-breakpoint
CREATE INDEX "repository_evidence_capture_provider_repo_idx" ON "repository_evidence_capture" USING btree ("organization_id","provider","provider_repository_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_evidence_object_key_uidx" ON "repository_evidence_object" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "repository_evidence_object_pending_idx" ON "repository_evidence_object" USING btree ("updated_at") WHERE "repository_evidence_object"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "repository_evidence_upload_operation_uidx" ON "repository_evidence_upload" USING btree ("organization_id","user_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_evidence_upload_receipt_uidx" ON "repository_evidence_upload" USING btree ("receipt_id") WHERE "repository_evidence_upload"."receipt_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "repository_evidence_upload_expiry_idx" ON "repository_evidence_upload" USING btree ("expires_at") WHERE "repository_evidence_upload"."status" = 'initialized';--> statement-breakpoint
CREATE INDEX "repository_evidence_upload_intent_due_idx" ON "repository_evidence_upload_intent" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "repository_evidence_upload_intent_receipt_idx" ON "repository_evidence_upload_intent" USING btree ("upload_receipt_id");--> statement-breakpoint
CREATE INDEX "repository_evidence_upload_intent_organization_idx" ON "repository_evidence_upload_intent" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "repository_evidence_upload_intent_user_idx" ON "repository_evidence_upload_intent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "repository_evidence_upload_object_object_idx" ON "repository_evidence_upload_object" USING btree ("organization_id","object_id");