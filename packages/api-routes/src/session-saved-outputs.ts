import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Saved outputs of a session (gap A1): what a background task wrote to its
 * output file, and a tool output too large for the transcript, as the CLI
 * captured them next to the session. One output is found by the task id (the
 * L1 join key, `facts['task_id']`), by the tool call that started the task or
 * produced the output, or by its path within its root.
 *
 * `not_captured`: no capture of the session names it (an older CLI, or a
 * session captured before the output existed). `missing`: the transcript names
 * the task, but its output file was not on disk when the session was captured.
 */

export const SAVED_OUTPUT_KINDS = ["task_output", "tool_result"] as const;
export const SavedOutputKindSchema = z.enum(SAVED_OUTPUT_KINDS);
export type SavedOutputKind = z.infer<typeof SavedOutputKindSchema>;

export const SAVED_OUTPUT_STATUSES = [
	/** The whole file. */
	"captured",
	/** Only the end of the file (a long task log). */
	"truncated",
	/** The file as an earlier capture of the session sent it. */
	"reused",
	/** The file was seen, its content not kept (`omittedReason`). */
	"omitted",
	/** An async agent's output: a link to its subagent transcript, never read. */
	"symlink",
	"missing",
	"not_captured",
] as const;
export const SavedOutputStatusSchema = z.enum(SAVED_OUTPUT_STATUSES);
export type SavedOutputStatus = z.infer<typeof SavedOutputStatusSchema>;

/** Largest stored text returned; a larger one comes back without `text`. */
export const SAVED_OUTPUT_MAX_TEXT_BYTES = 4 * 1024 * 1024;

const Identifier = z.string().min(1).max(256);

export const SessionSavedOutputInputSchema = z
	.object({
		sessionId: z.string().min(1).max(200),
		/** Claude Code's background task id. */
		taskId: z
			.string()
			.regex(/^[A-Za-z0-9_-]{1,64}$/u)
			.optional(),
		/** The tool call that started the task or produced the saved output. */
		toolUseId: Identifier.optional(),
		/** Path relative to the output's root, with `kind`. */
		path: z.string().min(1).max(512).optional(),
		/** Narrows a `toolUseId` lookup; required with `path`. */
		kind: SavedOutputKindSchema.optional(),
	})
	.refine(
		(input) =>
			[input.taskId, input.toolUseId, input.path].filter(
				(value) => value !== undefined,
			).length === 1,
		{ message: "Give exactly one of taskId, toolUseId or path." },
	)
	.refine((input) => input.path === undefined || input.kind !== undefined, {
		message: "A path lookup needs its kind.",
	});
export type SessionSavedOutputInput = z.infer<
	typeof SessionSavedOutputInputSchema
>;

export const SessionSavedOutputSchema = z.object({
	status: SavedOutputStatusSchema,
	kind: SavedOutputKindSchema.nullable(),
	/** Path relative to the root (`<task id>.output`, `rerooted/<task id>.output`, a tool output's name). */
	path: z.string().nullable(),
	taskId: z.string().nullable(),
	toolUseId: z.string().nullable(),
	/** Transcript stream of the record that names the output; null for the main stream. */
	agentId: z.string().nullable(),
	/** 1-based JSONL line of that record. */
	recordIndex: z.number().int().positive().nullable(),
	truncated: z.boolean(),
	/** The whole file's size when only its end was kept. */
	originalBytes: z.number().int().nonnegative().nullable(),
	sourceBytes: z.number().int().nonnegative().nullable(),
	storedBytes: z.number().int().nonnegative().nullable(),
	omittedReason: z.string().nullable(),
	/** When the capture that last saw the output completed. */
	capturedAt: z.string().nullable(),
	/** `task-output-sweep`: captured later than the session, by a one-time sweep. */
	captureReason: z.literal("task-output-sweep").nullable(),
	/** The secret-filtered text, when it has one and could be read. */
	text: z.string().optional(),
	/** Why an output with content came back without `text`. */
	textUnavailable: z
		.enum(["too-large", "blob-unavailable", "storage-unavailable"])
		.optional(),
});
export type SessionSavedOutput = z.infer<typeof SessionSavedOutputSchema>;

export const sessionSavedOutputsContract = {
	/** One saved output of a session the caller may read. */
	get: oc.input(SessionSavedOutputInputSchema).output(SessionSavedOutputSchema),
};
