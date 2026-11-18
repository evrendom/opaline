-- Slots for agent ClickHouse queries, shared by every API instance
-- (apps/api/src/services/analysis/agent-query-slots.ts). A new table, so the
-- migration takes no lock on existing data. One row per slot: four agent
-- queries may run at once (AGENT_QUERY_LIMITS.running).
CREATE TABLE "analysis_query_slot" (
	"slot" smallint PRIMARY KEY NOT NULL,
	"organization_id" text,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "analysis_query_slot" ADD CONSTRAINT "analysis_query_slot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "analysis_query_slot" ("slot") SELECT generate_series(0, 3);
