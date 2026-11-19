-- Compass settings per workspace, and SubQ's frustration answers about member
-- prompts. Their foreign keys briefly lock organization and user, so a short
-- lock timeout keeps a busy table from stalling the deploy.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "compass_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_frustration" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"turn_idx" integer NOT NULL,
	"prompt_sha256" text NOT NULL,
	"probability" real NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_frustration_organization_id_user_id_session_id_agent_id_turn_idx_prompt_sha256_pk" PRIMARY KEY("organization_id","user_id","session_id","agent_id","turn_idx","prompt_sha256")
);
--> statement-breakpoint
ALTER TABLE "compass_settings" ADD CONSTRAINT "compass_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compass_settings" ADD CONSTRAINT "compass_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_frustration" ADD CONSTRAINT "prompt_frustration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_frustration" ADD CONSTRAINT "prompt_frustration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompt_frustration_organization_id_created_at_idx" ON "prompt_frustration" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "prompt_frustration_user_id_idx" ON "prompt_frustration" USING btree ("user_id");
