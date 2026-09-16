CREATE TABLE IF NOT EXISTS "dependency_health_probe" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dependency_health_probe_created_at_idx" ON "dependency_health_probe" USING btree ("created_at");
