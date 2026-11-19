import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	index,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { apikey, user } from "./auth-schema.js";

// Better Auth owns one request counter/window on apikey. Ingest needs separate
// request and byte windows, so those plugin columns cannot represent this cap.
// `limiter_key` names the budget (`<subject kind>:<subject id>`): a user has
// one row per budget (session ingest, live session appends).
export const ingestRateLimitCounter = pgTable(
	"ingest_rate_limit_counter",
	{
		limiterKey: text("limiter_key").primaryKey(),
		// Dormant until a future per-key secondary throttle is introduced. The
		// authoritative limiters write user-subject rows only.
		apiKeyId: text("api_key_id")
			.unique()
			.references(() => apikey.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		requestWindowStartedAt: timestamp("request_window_started_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		requestCount: bigint("request_count", { mode: "number" }).notNull(),
		byteWindowStartedAt: timestamp("byte_window_started_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		byteCount: bigint("byte_count", { mode: "number" }).notNull(),
		lastRequestAllowed: boolean("last_request_allowed").notNull(),
		lastByteAllowed: boolean("last_byte_allowed").notNull(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("ingest_rate_limit_counter_user_id_idx").on(table.userId),
		check(
			"ingest_rate_limit_counter_subject_check",
			sql`(
				${table.apiKeyId} IS NOT NULL
				AND ${table.userId} IS NULL
			) OR (
				${table.apiKeyId} IS NULL
				AND ${table.userId} IS NOT NULL
			)`,
		),
		check(
			"ingest_rate_limit_counter_value_check",
			sql`${table.requestCount} >= 0 AND ${table.byteCount} >= 0`,
		),
		check(
			"ingest_rate_limit_counter_decision_check",
			sql`${table.lastByteAllowed} = false OR ${table.lastRequestAllowed} = true`,
		),
	],
);

export type IngestRateLimitCounterSelect =
	typeof ingestRateLimitCounter.$inferSelect;
export type IngestRateLimitCounterInsert =
	typeof ingestRateLimitCounter.$inferInsert;
