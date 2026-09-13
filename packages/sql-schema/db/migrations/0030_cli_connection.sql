CREATE TABLE "cli_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"browser_hash" text NOT NULL,
	"pairing_hash" text NOT NULL,
	"writer_hash" text,
	"source_hash" text NOT NULL,
	"return_origin" text NOT NULL,
	"user_id" text,
	"device_user_code" text,
	"client_sequence" integer DEFAULT 0 NOT NULL,
	"last_update_hash" text,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cli_connection_pairing_hash_unique" UNIQUE("pairing_hash"),
	CONSTRAINT "cli_connection_device_user_code_unique" UNIQUE("device_user_code")
);
--> statement-breakpoint
ALTER TABLE "cli_connection" ADD CONSTRAINT "cli_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cli_connection_source_created_idx" ON "cli_connection" USING btree ("source_hash","created_at");--> statement-breakpoint
CREATE INDEX "cli_connection_browser_expires_idx" ON "cli_connection" USING btree ("browser_hash","expires_at");--> statement-breakpoint
CREATE INDEX "cli_connection_expires_idx" ON "cli_connection" USING btree ("expires_at");