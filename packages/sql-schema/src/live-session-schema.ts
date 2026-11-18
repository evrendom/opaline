import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

// Live sessions: transcript lines of a running Claude Code or Codex session, streamed
// by the CLI while the session runs (`liveSession.append`). The line bytes
// live in R2 (one object per chunk); these rows describe what is committed.
// Purely additive to session ingest: nothing here is read by analytics, and
// the cleanup cron deletes sessions 72 hours after their last activity.

export const liveSession = pgTable(
	"live_session",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		source: text("source").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		projectPath: text("project_path").notNull(),
		gitRemote: text("git_remote"),
		gitBranch: text("git_branch"),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
		lastActivityAt: timestamp("last_activity_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		// Claude Code session ids and Codex thread ids are separate namespaces.
		primaryKey({
			columns: [table.organizationId, table.source, table.sessionId],
			name: "live_session_pkey",
		}),
		check(
			"live_session_source_check",
			sql`${table.source} IN ('claude_code', 'codex')`,
		),
		index("live_session_activity_idx").on(
			table.organizationId,
			table.lastActivityAt.desc(),
		),
		// The hourly cleanup's scan for sessions quiet for 72 hours.
		index("live_session_last_activity_idx").on(table.lastActivityAt),
	],
);

/** One transcript of a live session: the main transcript (`agent_id` '') or a subagent. */
export const liveSessionStream = pgTable(
	"live_session_stream",
	{
		organizationId: text("organization_id").notNull(),
		source: text("source").notNull(),
		sessionId: text("session_id").notNull(),
		agentId: text("agent_id").notNull(),
		generation: integer("generation").default(0).notNull(),
		committedLines: integer("committed_lines").default(0).notNull(),
		committedBytes: bigint("committed_bytes", { mode: "number" })
			.default(0)
			.notNull(),
		lastLineSha256: text("last_line_sha256"),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [
				table.organizationId,
				table.source,
				table.sessionId,
				table.agentId,
			],
			name: "live_session_stream_pkey",
		}),
		foreignKey({
			name: "live_session_stream_session_fk",
			columns: [table.organizationId, table.source, table.sessionId],
			foreignColumns: [
				liveSession.organizationId,
				liveSession.source,
				liveSession.sessionId,
			],
		}).onDelete("cascade"),
		check(
			"live_session_stream_value_check",
			sql`${table.generation} >= 0 AND ${table.committedLines} >= 0 AND ${table.committedBytes} >= 0`,
		),
		check(
			"live_session_stream_last_line_check",
			sql`(${table.committedLines} = 0) = (${table.lastLineSha256} IS NULL)`,
		),
		// Reset streams, the only ones whose older generations' chunks the
		// hourly cleanup deletes.
		index("live_session_stream_reset_idx")
			.on(table.organizationId, table.source, table.sessionId, table.agentId)
			.where(sql`${table.generation} > 0`),
	],
);

/** Consecutive lines of one stream generation, stored as one R2 object. */
export const liveSessionChunk = pgTable(
	"live_session_chunk",
	{
		organizationId: text("organization_id").notNull(),
		source: text("source").notNull(),
		sessionId: text("session_id").notNull(),
		agentId: text("agent_id").notNull(),
		generation: integer("generation").notNull(),
		startLine: integer("start_line").notNull(),
		lineCount: integer("line_count").notNull(),
		byteLength: bigint("byte_length", { mode: "number" }).notNull(),
		objectKey: text("object_key").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [
				table.organizationId,
				table.source,
				table.sessionId,
				table.agentId,
				table.generation,
				table.startLine,
			],
			name: "live_session_chunk_pkey",
		}),
		foreignKey({
			name: "live_session_chunk_stream_fk",
			columns: [
				table.organizationId,
				table.source,
				table.sessionId,
				table.agentId,
			],
			foreignColumns: [
				liveSessionStream.organizationId,
				liveSessionStream.source,
				liveSessionStream.sessionId,
				liveSessionStream.agentId,
			],
		}).onDelete("cascade"),
		// Deterministic keys name one chunk; the orphan sweep looks them up.
		uniqueIndex("live_session_chunk_object_key_idx").on(table.objectKey),
		check(
			"live_session_chunk_value_check",
			sql`${table.generation} >= 0 AND ${table.startLine} >= 0 AND ${table.lineCount} > 0 AND ${table.byteLength} > 0`,
		),
	],
);

export type LiveSessionSelect = typeof liveSession.$inferSelect;
export type LiveSessionStreamSelect = typeof liveSessionStream.$inferSelect;
export type LiveSessionChunkSelect = typeof liveSessionChunk.$inferSelect;
