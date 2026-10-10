import { getRawToolInput, type TraceEvent } from "@rudel/api-routes";
import type { ReactNode } from "react";
import { useTheme } from "@/app/providers/ThemeProvider";
import { usePreparedCodeHighlight } from "@/components/conversation/code-highlight-cache";
import {
	formatShellOutput,
	getShellCommand,
	normalizeToolOutput,
} from "@/components/conversation/conversation-tools";
import { cn } from "@/lib/utils";

// What goes inside the step inspector's Arguments and Result sections: the
// call's fields laid out by meaning rather than as one JSON blob — a command
// as a shell line, a path as a path, an edit as a diff — and results
// highlighted for what they are.

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

type LineKind = "addition" | "deletion";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	cjs: "javascript",
	css: "css",
	cts: "typescript",
	go: "go",
	html: "html",
	js: "javascript",
	json: "json",
	jsonl: "json",
	jsx: "jsx",
	md: "markdown",
	mjs: "javascript",
	mts: "typescript",
	py: "python",
	rs: "rust",
	sh: "bash",
	sql: "sql",
	toml: "toml",
	ts: "typescript",
	tsx: "tsx",
	yaml: "yaml",
	yml: "yaml",
};

function languageOf(path: string | undefined): string {
	const extension = path?.split("/").at(-1)?.split(".").at(-1)?.toLowerCase();
	return (extension && LANGUAGE_BY_EXTENSION[extension]) ?? "text";
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Code in the inspector's muted box, syntax-highlighted off the main thread
 * (plain until the tokens arrive). Optional line numbers, +/− diff markers,
 * and a `$` prompt for shell commands.
 */
export function HighlightedCode({
	code,
	language,
	lineKinds,
	prompt = false,
	startLine,
}: {
	code: string;
	language: string;
	lineKinds?: readonly LineKind[];
	prompt?: boolean;
	/** Number the lines from here; omit for no gutter. */
	startLine?: number;
}) {
	const { resolvedTheme } = useTheme();
	const highlight = usePreparedCodeHighlight({
		code,
		enabled: language !== "text",
		language,
		theme: resolvedTheme === "dark" ? "dark" : "light",
	});
	const lines = code.split("\n");
	const gutter = String((startLine ?? 1) + lines.length - 1).length;
	return (
		<pre className="overflow-hidden rounded-md bg-muted py-2 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
			{lines.map((line, index) => {
				const lineNumber = (startLine ?? 1) + index;
				const kind = lineKinds?.[index];
				const tokens = highlight?.lines[index];
				return (
					<div
						key={lineNumber}
						className={cn(
							"flex px-3",
							kind === "addition" && "bg-emerald-500/10",
							kind === "deletion" && "bg-rose-500/10",
						)}
					>
						{startLine !== undefined ? (
							<span
								aria-hidden="true"
								className="mr-3 shrink-0 text-right text-muted-foreground/50 tabular-nums select-none"
								style={{ width: `${gutter}ch` }}
							>
								{lineNumber}
							</span>
						) : null}
						{kind ? (
							<span
								aria-hidden="true"
								className={cn(
									"mr-2 shrink-0 select-none",
									kind === "addition"
										? "text-emerald-600 dark:text-emerald-400"
										: "text-rose-600 dark:text-rose-400",
								)}
							>
								{kind === "addition" ? "+" : "−"}
							</span>
						) : null}
						{prompt ? (
							<span
								aria-hidden="true"
								className={cn(
									"mr-2 shrink-0 text-muted-foreground select-none",
									index > 0 && "invisible",
								)}
							>
								$
							</span>
						) : null}
						<span className="min-w-0 flex-1">
							{tokens
								? tokens.map((token) => (
										<span
											key={token.offset}
											style={{
												color: token.color,
												fontStyle:
													(token.fontStyle ?? 0) & 1 ? "italic" : undefined,
											}}
										>
											{token.content}
										</span>
									))
								: line || " "}
						</span>
					</div>
				);
			})}
		</pre>
	);
}

/** A path as its folder (muted) and file name. */
function FilePath({ path }: { path: string }) {
	const slash = path.lastIndexOf("/");
	return (
		<span className="font-mono text-xs [overflow-wrap:anywhere]">
			<span className="text-muted-foreground">{path.slice(0, slash + 1)}</span>
			<span className="font-medium">{path.slice(slash + 1)}</span>
		</span>
	);
}

function ArgumentField({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<span className="text-[11px] text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}

/** "old_string" → "Old string". */
function fieldLabel(key: string): string {
	const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function FieldValue({ value }: { value: unknown }) {
	if (typeof value === "string") {
		const long = value.length > 80 || value.includes("\n");
		return long ? (
			<p className="rounded-md bg-muted px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
				{value}
			</p>
		) : (
			<span className="text-[13px] [overflow-wrap:anywhere]">{value}</span>
		);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return <span className="font-mono text-xs">{String(value)}</span>;
	}
	return (
		<HighlightedCode
			code={JSON.stringify(value, null, 2) ?? String(value)}
			language="json"
		/>
	);
}

/** The keys a tool's own layout already shows, so the field list skips them. */
const PATH_KEYS = ["file_path", "notebook_path", "path"] as const;

/** How a call was run rather than what it asked for — output caps, waits,
 * timeouts, sandbox flags. Left to Raw so Arguments shows the request. */
const EXECUTION_SETTING_KEYS = new Set([
	"dangerouslyDisableSandbox",
	"max_output_tokens",
	"run_in_background",
	"sandbox_permissions",
	"timeout",
	"timeout_ms",
	"with_escalated_permissions",
	"yield_time_ms",
]);

/** A tool call's arguments, each field laid out by what it is. */
export function ToolArguments({ event }: { event: ToolEvent }) {
	// What the agent sent, without the bookkeeping the transcript parser adds
	// to Codex calls (`__rudel_codex_operation`, `__rudel_codex_correlation`).
	const input = getRawToolInput(event.input);
	const command = getShellCommand(event.toolName, input);
	const pathKey = PATH_KEYS.find((key) => stringField(input[key]));
	const path = pathKey ? stringField(input[pathKey]) : undefined;
	const language = languageOf(path);
	const oldText = stringField(input.old_string);
	const newText = typeof input.new_string === "string" ? input.new_string : "";
	const content = stringField(input.content);
	const shown = new Set<string>();
	if (command) {
		for (const key of ["command", "cmd"]) shown.add(key);
	}
	if (pathKey) shown.add(pathKey);
	if (oldText !== undefined) {
		shown.add("old_string");
		shown.add("new_string");
	}
	if (content) shown.add("content");
	const rest = Object.entries(input).filter(
		([key]) => !shown.has(key) && !EXECUTION_SETTING_KEYS.has(key),
	);

	const oldLines = oldText?.split("\n") ?? [];
	const newLines = newText === "" ? [] : newText.split("\n");
	return (
		<div className="flex flex-col gap-3">
			{command ? (
				<ArgumentField label="Command">
					<HighlightedCode code={command} language="bash" prompt />
				</ArgumentField>
			) : null}
			{path ? (
				<ArgumentField label={fieldLabel(pathKey ?? "path")}>
					<FilePath path={path} />
				</ArgumentField>
			) : null}
			{oldText !== undefined ? (
				<ArgumentField
					label={`Change · +${newLines.length} −${oldLines.length}`}
				>
					<HighlightedCode
						code={[...oldLines, ...newLines].join("\n")}
						language={language}
						lineKinds={[
							...oldLines.map((): LineKind => "deletion"),
							...newLines.map((): LineKind => "addition"),
						]}
					/>
				</ArgumentField>
			) : null}
			{content ? (
				<ArgumentField label="Content">
					<HighlightedCode code={content} language={language} startLine={1} />
				</ArgumentField>
			) : null}
			{rest.map(([key, value]) => (
				<ArgumentField key={key} label={fieldLabel(key)}>
					<FieldValue value={value} />
				</ArgumentField>
			))}
		</div>
	);
}

/** How a tool's result reads best: a read file highlighted for its language
 * with its real line numbers, JSON pretty-printed, everything else as text. */
export function getToolResultView(
	event: ToolEvent,
	text: string,
): { language: string; startLine?: number; text: string } {
	if (event.toolName === "Read") {
		const offset = event.input.offset;
		return {
			language: languageOf(stringField(event.input.file_path)),
			startLine: typeof offset === "number" && offset > 0 ? offset : 1,
			text: normalizeToolOutput("Read", text),
		};
	}
	return formatShellOutput(text);
}
