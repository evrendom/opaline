export type SessionToolCall = {
	id: string;
	timestamp: string;
	toolName: string;
	input: Record<string, unknown>;
	provider?: "claude" | "codex";
	result?: { content: unknown; isError: boolean } | undefined;
	activity?: {
		verb: string;
		label?: string;
		files: readonly { operation: string; path: string }[];
		status: string;
	};
};

export type ToolCallStream = {
	turnId: string | null;
	agentId: string;
	calls: Iterable<SessionToolCall>;
	directory?: string;
};

export const WRITE_TOOLS: ReadonlySet<string> = new Set([
	"Write",
	"write",
	"create_file",
]);
export const EDIT_TOOLS: ReadonlySet<string> = new Set([
	"Edit",
	"edit",
	"str_replace",
	"MultiEdit",
]);
export const READ_TOOLS: ReadonlySet<string> = new Set([
	"Read",
	"read",
	"read_file",
]);
export const TRACE_EDIT_TOOLS: ReadonlySet<string> = new Set([
	...WRITE_TOOLS,
	...EDIT_TOOLS,
	"NotebookEdit",
	"apply_patch",
]);
export const TRACE_READ_TOOLS: ReadonlySet<string> = new Set([
	...READ_TOOLS,
	"view_image",
]);

export function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part && typeof part === "object" && "text" in part
				? String((part as { text: unknown }).text)
				: "",
		)
		.join("\n");
}

export function readResultText(content: unknown): string {
	return (resultText(content).split("<system-reminder>")[0] ?? "")
		.replace(/\r\n?/gu, "\n")
		.replace(/\n+$/u, "");
}

export const NUMBERED_LINE = /^\s*(\d+)(?:\t|→)(.*)$/u;
