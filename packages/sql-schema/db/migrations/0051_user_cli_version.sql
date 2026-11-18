CREATE TABLE "user_cli_version" (
	"user_id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_cli_version" ADD CONSTRAINT "user_cli_version_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;