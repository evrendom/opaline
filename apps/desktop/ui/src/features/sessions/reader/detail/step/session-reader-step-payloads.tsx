import { getRawToolInput, type TraceEvent } from "@rudel/api-routes";
import {
	changedHunks,
	diffLines,
	type FileEdit,
} from "@rudel/api-routes/command-glossary";
import { splitLeadingCd } from "@rudel/api-routes/command-identity";
import type { ReactNode } from "react";
import { useTheme } from "@/app/providers/ThemeProvider";
import { usePreparedCodeHighlight } from "@/components/conversation/code-highlight-cache";
import {
	formatShellOutput,
	getShellCommand,
	normalizeToolOutput,
} from "@/components/conversation/conversation-tools";
import { LANGUAGE_BY_EXTENSION } from "@/components/pierre/diff-view";
import { CopyButton } from "@/features/shell/components/copy-button";
import { cn } from "@/lib/utils";
import { SessionFileLink } from "../../files/session-file-link";
import { layoutShellCommand } from "./session-reader-shell-layout";

// What goes inside the step inspector's Arguments and Result sections: the
// call's fields laid out by meaning rather than as one JSON blob — a command
// as a shell line, a path as a path, an edit as a diff — and results
// highlighted for what they are.

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

type LineKind = "addition" | "deletion";

export function languageOf(path: string | undefined | null): string {
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
	className,
	code,
	language,
	lineKinds,
	lineNumbers,
	prompt = false,
	startLine,
}: {
	className?: string;
	code: string;
	language: string;
	lineNumbers?: readonly (number | null)[];
	lineKinds?: readonly (LineKind | undefined)[];
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
	const seen = new Map<string, number>();
	const gutter = lineNumbers
		? Math.max(1, ...lineNumbers.map((number) => String(number ?? "").length))
		: String((startLine ?? 1) + lines.length - 1).length;
	return (
		<pre
			className={cn(
				"overflow-hidden [overflow-wrap:anywhere]",
				"corner-s py-m",
				"font-mono text-body-m whitespace-pre-wrap",
				"bg-field",
				className,
			)}
		>
			{lines.map((line, index) => {
				const lineNumber = lineNumbers
					? lineNumbers[index]
					: (startLine ?? 1) + index;
				const id = `${lineNumber}:${line}`;
				const repeat = seen.get(id) ?? 0;
				seen.set(id, repeat + 1);
				const kind = lineKinds?.[index];
				const tokens = highlight?.lines[index];
				return (
					<div
						key={`${id}#${repeat}`}
						className={cn(
							"flex px-l",
							// design-escape-ok(opacity): shipped value; emerald-500/10
							kind === "addition" && "bg-emerald-mark/10",
							// design-escape-ok(opacity): shipped value; rose-500/10
							kind === "deletion" && "bg-rose-mark/10",
						)}
					>
						{startLine !== undefined || lineNumbers ? (
							<span
								aria-hidden="true"
								className="mr-l shrink-0 text-right text-ink-3-50 tabular-nums select-none"
								style={{ width: `${gutter}ch` }}
							>
								{lineNumber ?? "⋯"}
							</span>
						) : null}
						{kind ? (
							<span
								aria-hidden="true"
								className={cn(
									"mr-m shrink-0 select-none",
									kind === "addition" ? "text-emerald-ink" : "text-rose-ink",
								)}
							>
								{kind === "addition" ? "+" : "−"}
							</span>
						) : null}
						{prompt ? (
							<span
								aria-hidden="true"
								className={cn(
									"mr-m shrink-0 text-ink-3 select-none",
									index > 0 && "invisible",
								)}
							>
								$
							</span>
						) : null}
						<span
							className={cn(
								"min-w-0 flex-1",
								prompt && "-indent-[2ch] pl-[2ch]",
							)}
						>
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
		<SessionFileLink path={path} className="corner-xs hover:underline">
			<span className="font-mono text-body-m [overflow-wrap:anywhere]">
				<span className="text-ink-3">{path.slice(0, slash + 1)}</span>
				<span className="font-medium">{path.slice(slash + 1)}</span>
			</span>
		</SessionFileLink>
	);
}

export function EditDiff({ edit }: { edit: FileEdit }) {
	const hunks = changedHunks(diffLines(edit.before, edit.after));
	return (
		<HighlightedCode
			code={hunks.map((line) => (line ? line.text : "…")).join("\n")}
			language={languageOf(edit.file)}
			lineKinds={hunks.map((line) =>
				line && line.kind !== "same" ? line.kind : undefined,
			)}
		/>
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
		<div className="flex min-w-0 flex-col gap-xs">
			<span className="min-w-0 text-body-s text-ink-3">{label}</span>
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
			<p className="corner-s bg-field px-l py-m text-body-l whitespace-pre-wrap [overflow-wrap:anywhere]">
				{value}
			</p>
		) : (
			<span className="text-body-l [overflow-wrap:anywhere]">{value}</span>
		);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return <span className="font-mono text-body-m">{String(value)}</span>;
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
	const pathKey = PATH_KEYS.find((key) => stringField(input[key]));
	const path = pathKey ? stringField(input[pathKey]) : undefined;
	const language = languageOf(path);
	const oldText = stringField(input.old_string);
	const newText = typeof input.new_string === "string" ? input.new_string : "";
	const content = stringField(input.content);
	const shown = new Set<string>();
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
		<div className="flex flex-col gap-l">
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

const SHELL_SHOWN_KEYS = new Set([
	"cmd",
	"command",
	"cwd",
	"description",
	"workdir",
]);

export function shellCommandParts(
	event: ToolEvent,
): { command: string; dir: string | null; full: string } | null {
	const input = getRawToolInput(event.input);
	const full = getShellCommand(event.toolName, input);
	if (!full) return null;
	const ran = splitLeadingCd(full);
	return {
		command: ran.command,
		dir:
			ran.dir ?? stringField(input.workdir) ?? stringField(input.cwd) ?? null,
		full,
	};
}

export function ShellCommandBlock({ event }: { event: ToolEvent }) {
	const parts = shellCommandParts(event);
	if (!parts) return null;
	return (
		<div className="relative">
			<HighlightedCode
				className="pr-[calc(var(--space-xxl)*4/3)]"
				code={layoutShellCommand(parts.command)}
				language="bash"
				prompt
			/>
			<CopyButton
				className="absolute top-1 right-1"
				title="Copy command"
				value={parts.full}
			/>
		</div>
	);
}

export function ShellCallFields({ event }: { event: ToolEvent }) {
	const rest = Object.entries(getRawToolInput(event.input)).filter(
		([key]) => !SHELL_SHOWN_KEYS.has(key) && !EXECUTION_SETTING_KEYS.has(key),
	);
	if (rest.length === 0) return null;
	return (
		<div className="flex flex-col gap-l">
			{rest.map(([key, value]) => (
				<ArgumentField key={key} label={fieldLabel(key)}>
					<FieldValue value={value} />
				</ArgumentField>
			))}
		</div>
	);
}

export function useShellHighlight(code: string) {
	const { resolvedTheme } = useTheme();
	return usePreparedCodeHighlight({
		code,
		language: "bash",
		theme: resolvedTheme === "dark" ? "dark" : "light",
	});
}
