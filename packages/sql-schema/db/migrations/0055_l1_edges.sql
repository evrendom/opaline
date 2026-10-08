CREATE SEQUENCE "public"."l1_edge_revision_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "l1_edge_scope" (
	"organization_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"user_id" text,
	"source" text,
	"session_id" text,
	"repository_id" text,
	"priority" smallint DEFAULT 0 NOT NULL,
	"request_count" bigint DEFAULT 1 NOT NULL,
	"built_request_count" bigint DEFAULT 0 NOT NULL,
	"claimed_request_count" bigint,
	"claimed_revision" bigint,
	"built_revision" bigint,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"resolver_version" integer,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"watermark" timestamp with time zone,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"edge_count" integer,
	"unresolved_count" integer,
	"frozen_reason" text,
	"last_error" text,
	"built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "l1_edge_scope_organization_id_scope_kind_scope_id_pk" PRIMARY KEY("organization_id","scope_kind","scope_id"),
	CONSTRAINT "l1_edge_scope_kind_check" CHECK (("l1_edge_scope"."scope_kind" = 'session' AND "l1_edge_scope"."user_id" IS NOT NULL AND "l1_edge_scope"."session_id" IS NOT NULL AND "l1_edge_scope"."source" IN ('claude_code', 'codex')) OR ("l1_edge_scope"."scope_kind" = 'repository' AND "l1_edge_scope"."repository_id" IS NOT NULL AND "l1_edge_scope"."user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "l1_edge_scope_dependency" (
	"organization_id" text NOT NULL,
	"repository_key" text NOT NULL,
	"scope_kind" text DEFAULT 'session' NOT NULL,
	"scope_id" text NOT NULL,
	"open_until" timestamp with time zone NOT NULL,
	CONSTRAINT "l1_edge_scope_dependency_organization_id_repository_key_scope_id_pk" PRIMARY KEY("organization_id","repository_key","scope_id"),
	CONSTRAINT "l1_edge_scope_dependency_kind_check" CHECK ("l1_edge_scope_dependency"."scope_kind" = 'session')
);
--> statement-breakpoint
ALTER TABLE "l1_edge_scope" ADD CONSTRAINT "l1_edge_scope_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "l1_edge_scope" ADD CONSTRAINT "l1_edge_scope_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "l1_edge_scope_dependency" ADD CONSTRAINT "l1_edge_scope_dependency_scope_fk" FOREIGN KEY ("organization_id","scope_kind","scope_id") REFERENCES "public"."l1_edge_scope"("organization_id","scope_kind","scope_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "l1_edge_scope_due_idx" ON "l1_edge_scope" USING btree ("priority","next_attempt_at") WHERE "l1_edge_scope"."request_count" > "l1_edge_scope"."built_request_count";--> statement-breakpoint
CREATE INDEX "l1_edge_scope_dependency_scope_idx" ON "l1_edge_scope_dependency" USING btree ("organization_id","scope_kind","scope_id");