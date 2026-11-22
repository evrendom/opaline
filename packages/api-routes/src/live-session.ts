import { z } from "zod";
import { SourceSchema } from "./schemas/source.js";

// Live session protocol: the CLI streams new transcript lines of a running
// Claude Code session. opalinehq/cli vendors an identical copy of this
// contract; change both together.

export const LIVE_SESSION_PROTOCOL = "live_session_v1";
export const LIVE_SESSION_MAX_LINE_BYTES = 1_048_576; // UTF-8 bytes of one line
export const LIVE_SESSION_MAX_REQUEST_LINE_BYTES = 1_572_864; // sum of UTF-8 bytes of all lines in one append (Vercel body limit 4.5 MB incl. JSON escaping)
export const LIVE_SESSION_MAX_LINES_PER_STREAM = 10_000;
export const LIVE_SESSION_MAX_STREAMS_PER_REQUEST = 64;
export const LIVE_SESSION_MAX_REQUEST_LINES = 20_000; // lines across all streams of one append
export const LIVE_SESSIONS_DISABLED_CODE = "LIVE_SESSIONS_DISABLED";

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
// null = the main transcript; otherwise the Claude subagent id from agent-<id>.jsonl
export const LiveSessionAgentIdSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,200}$/)
	.nullable();

export const LiveSessionSourceSchema = SourceSchema;

// For Codex, `sessionId` is the thread id and a sub-agent's `agentId` its
// child thread id.
export const LiveSessionTargetSchema = z.object({
	protocol: z.literal(LIVE_SESSION_PROTOCOL),
	source: LiveSessionSourceSchema,
	organizationId: z.string().min(1).max(200),
	sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
});

export const LiveSessionStreamStateSchema = z.object({
	agentId: LiveSessionAgentIdSchema,
	committedLines: z.number().int().min(0),
	lastLineSha256: Sha256HexSchema.nullable(),
});

export const LiveSessionStateInputSchema = LiveSessionTargetSchema;
export const LiveSessionStateOutputSchema = z.object({
	ended: z.boolean(),
	streams: z.array(LiveSessionStreamStateSchema),
});

export const LiveSessionAppendStreamSchema = z.object({
	agentId: LiveSessionAgentIdSchema,
	reset: z.boolean().optional(),
	startLine: z.number().int().min(0),
	previousLineSha256: Sha256HexSchema.nullable(),
	lines: z.array(z.string()).max(LIVE_SESSION_MAX_LINES_PER_STREAM),
});

export const LiveSessionAppendInputSchema = LiveSessionTargetSchema.extend({
	projectPath: z.string().max(4096),
	gitRemote: z.string().max(2048).optional(),
	gitBranch: z.string().max(1024).optional(),
	ended: z.boolean().optional(),
	streams: z
		.array(LiveSessionAppendStreamSchema)
		.max(LIVE_SESSION_MAX_STREAMS_PER_REQUEST),
});

export const LiveSessionAppendOutputSchema = z.object({
	streams: z.array(
		LiveSessionStreamStateSchema.extend({
			status: z.enum(["appended", "already-committed", "out-of-sync"]),
		}),
	),
});

export const LiveSessionErrors = {
	[LIVE_SESSIONS_DISABLED_CODE]: {
		status: 403,
		message: "Live session updates are paused",
		data: z.object({
			pauseSeconds: z.number().int().min(60).max(604_800),
			scope: z.enum(["global", "workspace"]),
		}),
	},
	// The contract adds the existing SESSION_OWNERSHIP_CONFLICT error (409)
	// from the ingest errors.
};

export type LiveSessionSource = z.infer<typeof LiveSessionSourceSchema>;
export type LiveSessionStateInput = z.infer<typeof LiveSessionStateInputSchema>;
export type LiveSessionStateOutput = z.infer<
	typeof LiveSessionStateOutputSchema
>;
export type LiveSessionAppendInput = z.infer<
	typeof LiveSessionAppendInputSchema
>;
export type LiveSessionAppendOutput = z.infer<
	typeof LiveSessionAppendOutputSchema
>;
