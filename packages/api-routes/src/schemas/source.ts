import { z } from "zod";

export const SourceSchema = z.enum(["claude_code", "codex", "gemini"]);
export type Source = z.infer<typeof SourceSchema>;

/**
 * The transcript shape a source's sessions are stored in. Gemini sessions
 * (Gemini CLI and Antigravity) are translated into Claude Code's shape when
 * they are imported, so every Claude Code reader reads them too.
 */
export type TranscriptFormat = "claude_code" | "codex";

export function transcriptFormat(source: Source): TranscriptFormat {
	return source === "codex" ? "codex" : "claude_code";
}

/** Whether a source's stored transcript is in Claude Code's shape. */
export function usesClaudeTranscript(source: string): boolean {
	return source === "claude_code" || source === "gemini";
}

export type RawSessionTable =
	| "rudel.claude_sessions"
	| "rudel.codex_sessions"
	| "rudel.gemini_sessions";

export const RAW_SESSION_TABLES: Readonly<Record<Source, RawSessionTable>> = {
	claude_code: "rudel.claude_sessions",
	codex: "rudel.codex_sessions",
	gemini: "rudel.gemini_sessions",
};

export const SOURCE_LABELS: Readonly<Record<Source, string>> = {
	claude_code: "Claude Code",
	codex: "Codex",
	gemini: "Gemini",
};

/** A stored source string as a Source; anything unknown reads as Claude Code. */
export function toSource(value: string): Source {
	return value === "codex" || value === "gemini" ? value : "claude_code";
}
