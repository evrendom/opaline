// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: Trace row variants stay colocated so their shared disclosure behavior remains byte-identical.

import {
	type CodexActivity,
	deriveTranscriptToolActivity,
	getRawToolInput,
	translateCodexToolCall,
} from "@rudel/api-routes";
import { splitDisplayTextParts } from "@rudel/language-signals";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable } from "@/app/ui/pressable";
import { cn } from "@/lib/utils";
import { SignalText } from "../signal-text";
import { CodeBlock, type CodeLineKind } from "./CodeBlock";
import { ConversationSkillLink } from "./conversation-skill-link";
import {
	formatShellOutput,
	formatToolInputPreview,
	getDelegatedModel,
	getShellCommand,
	getToolPresentation,
	getToolPrimaryArg,
	isDelegationToolName,
	normalizeToolOutput,
} from "./conversation-tools";
import {
	compactPreview,
	type TraceEvent,
	type TraceSkillContent,
	type TraceToolResult,
	toolResultText,
} from "./conversation-trace";
import {
	conversationTraceLabelClassName,
	conversationTracePreviewClassName,
	conversationTraceSignalAwarePreviewClassName,
} from "./conversation-trace-class-names";
import { CodexToolCallBody } from "./conversation-trace-codex-tool-body";
import {
	TraceBrainIcon,
	TraceMessageIcon,
	TraceWrenchIcon,
} from "./conversation-trace-glyphs";
import { ModelTraceIcon, TraceIcon } from "./conversation-trace-icons";
import type { ConversationTraceInteractionEpisode } from "./conversation-trace-interaction-episodes";
import { TraceResultBody } from "./conversation-trace-result-body";
import { ConversationTraceTag } from "./conversation-trace-tag";
import { TraceTextCollapsedPreview } from "./conversation-trace-text-disclosure";
import { CONVERSATION_TOOL_ICONS } from "./conversation-trace-tool-icons";
import {
	ExpandableTraceRow,
	TraceExpansionIdProvider,
} from "./expandable-trace-row";
import { MessageContent } from "./MessageContent";

const INTERACTION_EPISODE_INITIAL_EVENT_LIMIT = 100;
const INTERACTION_EPISODE_EVENT_PAGE_SIZE = 100;

export function ToolResultBody({ result }: { result: TraceToolResult }) {
	return <TraceResultBody result={result} />;
}

export function ConversationTraceInteractionEpisodeRow({
	agentModel,
	episode,
	trailing,
}: {
	agentModel?: string;
	episode: ConversationTraceInteractionEpisode;
	trailing?: ReactNode;
}) {
	return (
		<ExpandableTraceRow
			anchorId={`trace-event-${episode.id}`}
			compact
			fullPreviewText={undefined}
			label={
				<span
					className="flex min-w-0 items-center gap-xs"
					data-trace-interaction-episode
					data-trace-interaction-episode-size={episode.events.length}
				>
					<p className={conversationTraceLabelClassName}>Interacted with</p>
					<ConversationTraceTag
						className="max-w-[18rem] shrink-0"
						toolIcon="computer"
						value={episode.target}
					>
						<span className="min-w-0 truncate">{episode.target}</span>
					</ConversationTraceTag>
				</span>
			}
			leading={
				<TraceIcon
					className={episode.isError ? "border-error text-error" : undefined}
					icon={CONVERSATION_TOOL_ICONS.computer}
					toolIcon={episode.isError ? undefined : "computer"}
					tone={episode.isError ? "tomato" : "amber"}
				/>
			}
			trailing={trailing}
			treeBodyClassName="-ml-l"
			body={
				<ConversationTraceInteractionEpisodeEvents
					agentModel={agentModel}
					events={episode.events}
				/>
			}
		/>
	);
}

function ConversationTraceInteractionEpisodeEvents({
	agentModel,
	events,
}: {
	agentModel: string | undefined;
	events: ConversationTraceInteractionEpisode["events"];
}) {
	const [visibleLimit, setVisibleLimit] = useState(
		INTERACTION_EPISODE_INITIAL_EVENT_LIMIT,
	);
	const visibleEvents = events.slice(0, visibleLimit);
	const remaining = events.length - visibleEvents.length;
	return (
		<div
			className="grid divide-y divide-line"
			data-trace-interaction-episode-window={visibleEvents.length}
		>
			{visibleEvents.map((event) => (
				<TraceExpansionIdProvider key={event.id} expansionId={event.id}>
					<ConversationTraceEventRow agentModel={agentModel} event={event} />
				</TraceExpansionIdProvider>
			))}
			{remaining > 0 ? (
				<Pressable
					type="button"
					onClick={() =>
						setVisibleLimit((current) =>
							Math.min(
								current + INTERACTION_EPISODE_EVENT_PAGE_SIZE,
								events.length,
							),
						)
					}
					className="min-h-11 px-l text-left text-body-m font-medium text-ink-3"
					data-trace-interaction-episode-more
				>
					{`Show ${Math.min(
						remaining,
						INTERACTION_EPISODE_EVENT_PAGE_SIZE,
					).toLocaleString()} more operations (${remaining.toLocaleString()} remaining)`}
				</Pressable>
			) : null}
		</div>
	);
}

function formatToolInputBody(input: Record<string, unknown>) {
	const rawInput = getRawToolInput(input);
	if (Object.keys(rawInput).length === 0) {
		return undefined;
	}

	try {
		return JSON.stringify(rawInput, null, 2);
	} catch {
		return undefined;
	}
}

type ToolPrimaryArgParts = {
	label: string;
	suffix: string | undefined;
};

const TOOL_RANGE_SUFFIX_PATTERN = /^(.*\S)\s+(\(\d+(?:–|-)\d+\))$/u;
const SEARCH_TRAILING_ARG_PATTERN = /^(.*\S)\s+("[^"]*"|'[^']*'|\S+)$/u;

function splitToolPrimaryArg(
	primaryArg: string,
	activity: CodexActivity | undefined,
): ToolPrimaryArgParts {
	const range = TOOL_RANGE_SUFFIX_PATTERN.exec(primaryArg);
	if (range?.[1] && range[2]) {
		return { label: range[1], suffix: range[2] };
	}

	if (activity === "searching") {
		const trailingArg = SEARCH_TRAILING_ARG_PATTERN.exec(primaryArg);
		if (trailingArg?.[1] && trailingArg[2]) {
			return { label: trailingArg[1], suffix: trailingArg[2] };
		}
	}

	return { label: primaryArg, suffix: undefined };
}

function getFilePresentation(input: Record<string, unknown>) {
	const filePath = input.file_path;
	if (typeof filePath !== "string" || filePath.trim() === "") {
		return undefined;
	}

	const normalizedPath = filePath.trim();
	const filename = normalizedPath.split("/").filter(Boolean).at(-1);
	if (!filename) {
		return undefined;
	}

	const extension = filename.split(".").at(-1)?.toLowerCase();
	const languageByExtension: Record<string, string> = {
		cjs: "javascript",
		cts: "typescript",
		js: "javascript",
		jsx: "jsx",
		json: "json",
		jsonl: "json",
		md: "markdown",
		mjs: "javascript",
		mts: "typescript",
		py: "python",
		sh: "bash",
		ts: "typescript",
		tsx: "tsx",
		yaml: "yaml",
		yml: "yaml",
	};

	return {
		filename,
		language: extension
			? (languageByExtension[extension] ?? extension)
			: "text",
	};
}

function getRenderedLines(content: string) {
	const normalizedContent = content.trim();
	return normalizedContent === "" ? [] : normalizedContent.split("\n");
}

function countRenderedLines(content: string) {
	return getRenderedLines(content).length;
}

function repeatLineKind(kind: CodeLineKind, count: number): CodeLineKind[] {
	return Array.from({ length: count }, () => kind);
}

export function ShellToolCallBody({
	command,
	result,
}: {
	command: string;
	result: TraceToolResult | undefined;
}) {
	const resultText = result ? toolResultText(result.content) : undefined;
	const rawOutputText =
		resultText || (result ? "No output" : "No result recorded for this call.");
	const output = formatShellOutput(rawOutputText);

	return (
		<div className="grid gap-l" data-trace-shell-command-details>
			<CodeBlock code={command} filename="Input" language="bash" />
			<CodeBlock
				code={output.text}
				filename="Output"
				language={output.language}
				showLineNumbers
			/>
		</div>
	);
}

export function SkillToolCallBody({
	skillContent,
}: {
	skillContent: TraceSkillContent;
}) {
	return (
		<div data-trace-skill-details>
			<CodeBlock
				code={skillContent.content}
				filename="SKILL.md"
				language="markdown"
				showLineNumbers
			/>
		</div>
	);
}

export function ToolCallBody({
	input,
	result,
	toolName,
}: {
	input: Record<string, unknown>;
	result: TraceToolResult | undefined;
	toolName: string;
}) {
	const inputText = formatToolInputBody(input);
	const resultText = result ? toolResultText(result.content) : undefined;
	const unnormalizedOutputText =
		resultText || (result ? "No output" : "No result recorded for this call.");
	const rawOutputText = normalizeToolOutput(toolName, unnormalizedOutputText);
	const filePresentation = getFilePresentation(input);
	const writeContent = input.content;
	const oldString = input.old_string;
	const newString = input.new_string;

	if (
		toolName === "Edit" &&
		filePresentation &&
		typeof oldString === "string" &&
		typeof newString === "string"
	) {
		const oldLines = getRenderedLines(oldString);
		const newLines = getRenderedLines(newString);
		const lineChangeKinds = [
			...repeatLineKind("deletion", oldLines.length),
			...repeatLineKind("addition", newLines.length),
		];

		return (
			<CodeBlock
				changeSummary={{
					additions: newLines.length,
					deletions: oldLines.length,
				}}
				code={[...oldLines, ...newLines].join("\n")}
				filename={filePresentation.filename}
				language={filePresentation.language}
				lineChangeKinds={lineChangeKinds}
				showLineNumbers
			/>
		);
	}

	if (
		toolName === "Write" &&
		filePresentation &&
		typeof writeContent === "string"
	) {
		return (
			<CodeBlock
				changeSummary={{
					additions: countRenderedLines(writeContent),
					deletions: 0,
				}}
				code={writeContent}
				filename={filePresentation.filename}
				language={filePresentation.language}
				lineChangeKind="addition"
				showLineNumbers
			/>
		);
	}

	if (toolName === "Read" && filePresentation) {
		return (
			<CodeBlock
				code={rawOutputText}
				filename={filePresentation.filename}
				language={filePresentation.language}
				showLineNumbers
			/>
		);
	}

	const output = formatShellOutput(rawOutputText);

	return (
		<div className="grid gap-l" data-trace-tool-details>
			{inputText ? (
				<CodeBlock code={inputText} filename="Input" language="json" />
			) : null}
			<CodeBlock
				code={output.text}
				filename={result?.isError ? "Error Output" : "Output"}
				language={output.language}
				showLineNumbers
			/>
		</div>
	);
}

function MessagePreviewText({ text }: { text: string }) {
	const parts = useMemo(() => splitDisplayTextParts(text), [text]);

	return parts.map((part, index) => (
		<span
			// biome-ignore lint/suspicious/noArrayIndexKey: display parts are immutable and may repeat text
			key={`${part.type}:${index}`}
		>
			{part.type === "text" ? (
				<SignalText text={part.content} />
			) : part.type === "strong" ? (
				<strong className="font-heavy">
					<SignalText text={part.content} />
				</strong>
			) : (
				<span className="font-data">{part.content}</span>
			)}
		</span>
	));
}

export function ConversationTraceEventRow({
	agentModel,
	event,
	trailing,
}: {
	agentModel?: string;
	event: TraceEvent;
	trailing?: ReactNode;
}) {
	if (event.kind === "reasoning") {
		const reasoningLabel =
			event.provider === "codex" ? "Reasoning summary" : "Reasoning";
		return (
			<ExpandableTraceRow
				anchorId={`trace-event-${event.id}`}
				compact
				collapsedBody={
					<p
						className={conversationTraceSignalAwarePreviewClassName}
						data-trace-preview
					>
						<TraceTextCollapsedPreview text={event.text} />
					</p>
				}
				fullPreviewText={event.text}
				label={
					<p className={conversationTraceLabelClassName}>{reasoningLabel}</p>
				}
				leading={<TraceIcon icon={TraceBrainIcon} tone="violet" />}
				trailing={trailing}
				treeBodyClassName="-ml-l"
				textDisclosure
				body={
					<p className="whitespace-pre-wrap font-body text-body-l font-regular text-ink text-pretty">
						<SignalText text={event.text} />
					</p>
				}
			/>
		);
	}

	if (event.kind === "message") {
		return (
			<ExpandableTraceRow
				anchorId={`trace-event-${event.id}`}
				compact
				collapsedBody={
					event.text ? (
						<p
							className={conversationTraceSignalAwarePreviewClassName}
							data-trace-preview
						>
							<TraceTextCollapsedPreview
								renderLeadingText={(text) => <MessagePreviewText text={text} />}
								text={event.text}
							/>
						</p>
					) : undefined
				}
				fullPreviewText={event.text || undefined}
				label={<p className={conversationTraceLabelClassName}>Message</p>}
				leading={<TraceIcon icon={TraceMessageIcon} tone="blue" />}
				trailing={trailing}
				treeBodyClassName="-ml-l"
				textDisclosure
				body={<MessageContent content={event.content} />}
			/>
		);
	}

	if (event.kind === "orphan-result") {
		const resultText = toolResultText(event.result.content);
		return (
			<ExpandableTraceRow
				anchorId={event.result.batch?.id ?? `trace-event-${event.id}`}
				compact
				fullPreviewText={resultText}
				label={
					<p className={conversationTraceLabelClassName}>
						{event.result.batch
							? `Shared output · ${event.result.batch.toolIds.length} tool calls`
							: "Result"}
					</p>
				}
				leading={
					<TraceIcon
						icon={TraceWrenchIcon}
						tone={event.result.isError ? "tomato" : "cyan"}
					/>
				}
				trailing={trailing}
				treeBodyClassName="-ml-l"
				body={<ToolResultBody result={event.result} />}
			>
				<p className={conversationTracePreviewClassName} data-trace-preview>
					{compactPreview(resultText)}
				</p>
			</ExpandableTraceRow>
		);
	}

	const activity = event.activity ?? deriveTranscriptToolActivity(event);
	const hasCodexProvenance = event.provider === "codex";
	const translation = hasCodexProvenance
		? translateCodexToolCall(event.toolName, event.input)
		: undefined;
	const codexTranslation = translation?.mapped ? translation : undefined;
	const presentation = getToolPresentation(
		event.toolName,
		event.input,
		event.provider,
	);
	const icon = activity.kind === "skill" ? "sparkle" : presentation.icon;
	const verb = hasCodexProvenance ? activity.verb : presentation.verb;
	const primaryArg =
		activity.kind === "skill"
			? activity.label
			: getToolPrimaryArg(event.toolName, event.input, event.provider);
	const hasFileTag =
		primaryArg !== undefined &&
		(typeof event.input.file_path === "string" ||
			typeof event.input.notebook_path === "string");
	const inputPreview =
		hasFileTag || codexTranslation
			? undefined
			: formatToolInputPreview(event.input);
	const primaryArgParts = primaryArg
		? splitToolPrimaryArg(primaryArg, codexTranslation?.activity)
		: undefined;
	const isError = event.result?.isError === true;
	const shellCommand =
		event.toolName === "exec_command" && !hasCodexProvenance
			? undefined
			: getShellCommand(event.toolName, event.input);
	const delegatedModel =
		getDelegatedModel(event.toolName, event.input) ??
		(isDelegationToolName(event.toolName) ? agentModel : undefined);
	const isSkill = activity.kind === "skill";
	const hasNeutralReadIcon = icon === "file";

	if (shellCommand && !codexTranslation && !isSkill) {
		return (
			<ExpandableTraceRow
				anchorId={`trace-event-${event.id}`}
				compact
				fullPreviewText={undefined}
				label={
					<ConversationTraceTag
						className="min-w-0 max-w-[36rem] shrink pl-s"
						data-trace-shell-command-tag
						hideIcon
						title={shellCommand}
						toolIcon={icon}
						value={shellCommand}
					>
						<code
							className="min-w-0 truncate whitespace-pre font-data font-regular tracking-m [font-variant-ligatures:none]"
							data-trace-preview
							data-trace-shell-command-preview
						>
							{compactPreview(shellCommand, Number.POSITIVE_INFINITY)}
						</code>
					</ConversationTraceTag>
				}
				leading={
					<TraceIcon
						className={isError ? "border-error text-error" : undefined}
						icon={CONVERSATION_TOOL_ICONS.terminal}
						toolIcon="terminal"
						tone={isError ? "tomato" : "amber"}
					/>
				}
				trailing={trailing}
				treeBodyClassName="-ml-l"
				body={
					<ShellToolCallBody command={shellCommand} result={event.result} />
				}
			/>
		);
	}

	if (isSkill) {
		const skillName = primaryArg ?? "Skill";

		return (
			<ExpandableTraceRow
				disclosureLabel={`Expand ${skillName} invocation`}
				anchorId={`trace-event-${event.id}`}
				compact
				fullPreviewText={undefined}
				label={
					<ConversationSkillLink name={skillName}>
						<ConversationTraceTag
							className="max-w-[18rem] shrink-0"
							data-trace-skill-tag
							toolIcon={icon}
							value={skillName}
						>
							<span className="truncate">{skillName}</span>
						</ConversationTraceTag>
					</ConversationSkillLink>
				}
				leading={
					<TraceIcon
						className={isError ? "border-error text-error" : undefined}
						icon={CONVERSATION_TOOL_ICONS[icon]}
						toolIcon={icon}
						tone={isError ? "tomato" : "amber"}
					/>
				}
				trailing={trailing}
				treeBodyClassName="-ml-l"
				body={
					event.skillContent ? (
						<SkillToolCallBody skillContent={event.skillContent} />
					) : codexTranslation ? (
						<CodexToolCallBody
							input={event.input}
							result={event.result}
							toolName={event.toolName}
							translation={codexTranslation}
							activity={activity}
						/>
					) : (
						<ToolCallBody
							input={event.input}
							result={event.result}
							toolName={event.toolName}
						/>
					)
				}
			/>
		);
	}

	return (
		<ExpandableTraceRow
			anchorId={`trace-event-${event.id}`}
			compact
			fullPreviewText={undefined}
			label={
				<span
					className="flex min-w-0 items-center gap-xs"
					data-trace-tool-label-group
				>
					<p className={conversationTraceLabelClassName}>{verb}</p>
					{primaryArgParts ? (
						<ConversationTraceTag
							aria-label={primaryArg}
							className="max-w-[18rem] shrink-0"
							model={delegatedModel}
							title={primaryArg}
							toolIcon={icon}
							value={primaryArgParts.label}
						>
							<span className="min-w-0 truncate" data-trace-primary-arg-label>
								{primaryArgParts.label}
							</span>
							{primaryArgParts.suffix ? (
								<span className="shrink-0" data-trace-primary-arg-suffix>
									{primaryArgParts.suffix}
								</span>
							) : null}
						</ConversationTraceTag>
					) : null}
				</span>
			}
			leading={
				delegatedModel ? (
					<ModelTraceIcon
						expanded={false}
						expandable={false}
						model={delegatedModel}
					/>
				) : (
					<TraceIcon
						className={isError ? "border-error text-error" : undefined}
						icon={CONVERSATION_TOOL_ICONS[icon]}
						toolIcon={isError || hasNeutralReadIcon ? undefined : icon}
						tone={isError ? "tomato" : hasNeutralReadIcon ? "neutral" : "amber"}
					/>
				)
			}
			trailing={trailing}
			treeBodyClassName="-ml-l"
			body={
				codexTranslation ? (
					<CodexToolCallBody
						activity={activity}
						input={event.input}
						result={event.result}
						toolName={event.toolName}
						translation={codexTranslation}
					/>
				) : (
					<ToolCallBody
						input={event.input}
						result={event.result}
						toolName={event.toolName}
					/>
				)
			}
		>
			{inputPreview ? (
				<p
					className={cn(
						conversationTracePreviewClassName,
						"font-data text-body-m",
					)}
					data-trace-preview
				>
					{inputPreview}
				</p>
			) : null}
		</ExpandableTraceRow>
	);
}
