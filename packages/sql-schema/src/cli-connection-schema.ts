import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export const cliConnection = pgTable(
	"cli_connection",
	{
		id: text("id").primaryKey(),
		browserHash: text("browser_hash").notNull(),
		pairingHash: text("pairing_hash").notNull().unique(),
		writerHash: text("writer_hash"),
		sourceHash: text("source_hash").notNull(),
		returnOrigin: text("return_origin").notNull(),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		deviceUserCode: text("device_user_code").unique(),
		clientSequence: integer("client_sequence").default(0).notNull(),
		lastUpdateHash: text("last_update_hash"),
		snapshot: jsonb("snapshot").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		codeExpiresAt: timestamp("code_expires_at", {
			withTimezone: true,
		}).notNull(),
	},
	(table) => [
		index("cli_connection_source_created_idx").on(
			table.sourceHash,
			table.createdAt,
		),
		index("cli_connection_browser_expires_idx").on(
			table.browserHash,
			table.expiresAt,
		),
		index("cli_connection_expires_idx").on(table.expiresAt),
	],
);
