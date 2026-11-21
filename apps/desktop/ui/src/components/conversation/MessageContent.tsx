import { type ReactNode, useId, useMemo, useState } from "react";
import type {
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
} from "@/lib/conversation-schema";
import { cn } from "@/lib/utils";
import { SignalText } from "../signal-text";
import { CodeBlock, InlineCode } from "./CodeBlock";
import { formatShellOutput } from "./conversation-tools";
import {
	TraceChevronDownIcon,
	TraceChevronRightIcon,
} from "./conversation-trace-glyphs";
import {
	parseMessageTextBlocks,
	type TextPart,
} from "./message-content-parser";
import { ToolInvocation } from "./ToolInvocation";

type MessageBlock =
	| string
	| TextContent
	| ThinkingContent
	| ToolUseContent
	| ToolResultContent;

// Keep room for the formatted-part limit plus a plain-text fallback while
// bounding every message-level loop in this component.
export const MAX_RENDERED_MESSAGE_BLOCKS = 128;

function getMessageBlockKey(block: MessageBlock, blockIndex: number): string {
	// Parsed transcript blocks are immutable; their position is a bounded key
	// that does not copy arbitrarily large message text into React's key space.
	if (typeof block === "string") {
		return `string:${blockIndex}`;
	}

	return `${block.type}:${blockIndex}`;
}

interface MessageContentProps {
	content: string | MessageBlock[];
	className?: string;
}

interface MessageRenderPlan {
	readonly visibleBlocks: ReadonlyArray<MessageBlock>;
	readonly textPartsByBlock: ReadonlyArray<ReadonlyArray<TextPart> | null>;
}

/**
 * Format an XML tag name into a human-readable label.
 * e.g. "environment_context" -> "Environment Context"
 */
function formatTagLabel(tag: string): string {
	return tag.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function shouldCollapseXmlBlockByDefault(tag: string): boolean {
	return /instruction|context/i.test(tag);
}

function formatXmlBlockSummary(
	entries: ReadonlyArray<{ readonly key: string; readonly value: string }>,
): string {
	const [firstEntry] = entries;
	if (!firstEntry) {
		return "No fields";
	}

	const valuePreview = firstEntry.value
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
	const suffix = entries.length > 1 ? `, +${entries.length - 1} more` : "";

	return `${formatTagLabel(firstEntry.key)}: ${valuePreview}${valuePreview.length === 80 ? "..." : ""}${suffix}`;
}

function XmlBlock({
	tag,
	entries,
}: {
	tag: string;
	entries: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}) {
	const [isOpen, setIsOpen] = useState(!shouldCollapseXmlBlockByDefault(tag));
	const panelId = useId();

	return (
		<div
			data-testid="message-xml-block"
			className="overflow-hidden corner-l edge-m border-line bg-canvas"
		>
			<button
				type="button"
				onClick={() => setIsOpen((current) => !current)}
				aria-expanded={isOpen}
				aria-controls={panelId}
				className={cn(
					"flex w-full items-start gap-l",
					"edge-b-m px-xl py-l",
					"text-left",
					"border-line bg-[color:color-mix(in_srgb,var(--inset)_82%,white)]",
				)}
			>
				<div className="mt-xxs shrink-0 text-ink-3">
					{isOpen ? (
						<TraceChevronDownIcon className="size-4" />
					) : (
						<TraceChevronRightIcon className="size-4" />
					)}
				</div>
				<div className="grid min-w-0 flex-1 gap-xxs">
					<p className="text-body-l font-heavy text-dashboardy-heading">
						{formatTagLabel(tag)}
					</p>
					{isOpen ? null : (
						<p className="text-body-l text-ink-3 [overflow-wrap:anywhere]">
							{formatXmlBlockSummary(entries)}
						</p>
					)}
				</div>
			</button>
			{isOpen ? (
				<div id={panelId} className="divide-y divide-line">
					{entries.map((entry, entryIndex) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: parsed XML fields are static and may repeat names
							key={`${entry.key}:${entryIndex}`}
							className="flex gap-xl px-xl py-l"
						>
							<p className="min-w-[6.5rem] shrink-0 text-body-l font-medium text-ink-3">
								{formatTagLabel(entry.key)}
							</p>
							<p className="break-all font-mono text-body-l text-dashboardy-heading">
								{entry.value}
							</p>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function renderTextParts(parts: ReadonlyArray<TextPart>, key: string) {
	return (
		<div key={key} data-testid="message-text-block" className="space-y-xl">
			{parts.map((part, partIdx) => {
				if (part.type === "code") {
					return (
						<CodeBlock
							// biome-ignore lint/suspicious/noArrayIndexKey: static parsed content blocks
							key={partIdx}
							code={part.content}
							language={part.language}
							highlight={part.highlight}
							showLineNumbers
						/>
					);
				}
				if (part.type === "xml") {
					return (
						<XmlBlock
							// biome-ignore lint/suspicious/noArrayIndexKey: static parsed content blocks
							key={partIdx}
							tag={part.tag}
							entries={part.entries}
						/>
					);
				}
				if (part.type === "notice") {
					return (
						<p
							// biome-ignore lint/suspicious/noArrayIndexKey: static parsed content blocks
							key={partIdx}
							data-testid="message-content-notice"
							className="whitespace-pre-wrap break-words text-body-l text-ink-3 italic [overflow-wrap:anywhere]"
						>
							{part.content}
						</p>
					);
				}
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static parsed content blocks
						key={partIdx}
						className="max-w-[65ch]"
					>
						<p className="whitespace-pre-wrap break-words text-body-l text-dashboardy-heading text-pretty [overflow-wrap:anywhere]">
							{renderInlineCode(part.content)}
						</p>
					</div>
				);
			})}
		</div>
	);
}

function renderStrongText(text: string, keyPrefix: string): ReactNode[] {
	const strongPattern = /\*\*([^*\n]+?)\*\*/g;
	const content: ReactNode[] = [];
	let lastIndex = 0;
	let match = strongPattern.exec(text);

	while (match !== null) {
		if (match.index > lastIndex) {
			const plainText = text.slice(lastIndex, match.index);
			content.push(
				<span key={`${keyPrefix}-text-${lastIndex}`}>
					<SignalText text={plainText} />
				</span>,
			);
		}

		const strongText = match[1];
		if (strongText?.trim()) {
			content.push(
				<strong
					key={`${keyPrefix}-strong-${match.index}`}
					className="font-heavy"
				>
					<SignalText text={strongText} />
				</strong>,
			);
		} else {
			content.push(
				<span key={`${keyPrefix}-text-${match.index}`}>{match[0]}</span>,
			);
		}

		lastIndex = match.index + match[0].length;
		match = strongPattern.exec(text);
	}

	if (lastIndex === 0) {
		return [
			<span key={`${keyPrefix}-text`}>
				<SignalText text={text} />
			</span>,
		];
	}

	if (lastIndex < text.length) {
		const trailingText = text.slice(lastIndex);
		content.push(
			<span key={`${keyPrefix}-text-${lastIndex}`}>
				<SignalText text={trailingText} />
			</span>,
		);
	}

	return content;
}

function renderInlineCode(text: string): ReactNode {
	const inlineCodePattern = /(`+)([^`\n]+?)\1/g;
	const content: ReactNode[] = [];
	let lastIndex = 0;
	let match = inlineCodePattern.exec(text);

	while (match !== null) {
		if (match.index > lastIndex) {
			content.push(
				...renderStrongText(
					text.slice(lastIndex, match.index),
					`inline-${lastIndex}`,
				),
			);
		}

		const code = match[2];
		if (code !== undefined) {
			content.push(<InlineCode key={`code-${match.index}`}>{code}</InlineCode>);
		}

		lastIndex = match.index + match[0].length;
		match = inlineCodePattern.exec(text);
	}

	if (lastIndex === 0) {
		return renderStrongText(text, "plain");
	}

	if (lastIndex < text.length) {
		content.push(
			...renderStrongText(text.slice(lastIndex), `inline-${lastIndex}`),
		);
	}

	return content;
}

function getMessageBlockText(block: MessageBlock): string | null {
	if (typeof block === "string") {
		return block;
	}

	return block.type === "text" ? block.text : null;
}

export function MessageContent({ content, className }: MessageContentProps) {
	const renderPlan = useMemo<MessageRenderPlan>(() => {
		if (typeof content === "string") {
			return {
				visibleBlocks: [],
				textPartsByBlock: parseMessageTextBlocks([content]),
			};
		}

		if (!Array.isArray(content)) {
			return { visibleBlocks: [], textPartsByBlock: [] };
		}

		const visibleBlocks = content.slice(0, MAX_RENDERED_MESSAGE_BLOCKS);
		return {
			visibleBlocks,
			textPartsByBlock: parseMessageTextBlocks(
				visibleBlocks.map(getMessageBlockText),
			),
		};
	}, [content]);

	if (!content) {
		return (
			<div className={cn("text-body-xl italic text-ink-3", className)}>
				(No content)
			</div>
		);
	}

	if (typeof content === "string") {
		return (
			<div className={cn("space-y-xl", className)}>
				{renderTextParts(renderPlan.textPartsByBlock[0] ?? [], "plain-content")}
			</div>
		);
	}

	if (!Array.isArray(content)) {
		return (
			<div className={cn("text-body-xl italic text-ink-3", className)}>
				(Invalid content format: {typeof content})
			</div>
		);
	}

	const toolUses = new Map<string, ToolUseContent>();
	const toolResults = new Map<string, ToolResultContent>();
	const omittedBlockCount = content.length - renderPlan.visibleBlocks.length;

	for (const block of renderPlan.visibleBlocks) {
		if (typeof block === "string") continue;
		if (block.type === "tool_use") {
			toolUses.set(block.id, block);
		} else if (block.type === "tool_result") {
			toolResults.set(block.tool_use_id, block);
		}
	}

	return (
		<div className={cn("space-y-xl", className)}>
			{renderPlan.visibleBlocks.map((block, blockIndex) => {
				const blockKey = getMessageBlockKey(block, blockIndex);

				if (typeof block === "string") {
					return renderTextParts(
						renderPlan.textPartsByBlock[blockIndex] ?? [],
						blockKey,
					);
				}

				switch (block.type) {
					case "text":
						return renderTextParts(
							renderPlan.textPartsByBlock[blockIndex] ?? [],
							blockKey,
						);

					case "thinking":
						return (
							<div
								key={blockKey}
								className="corner-l edge-m border-line bg-[color:color-mix(in_srgb,var(--inset)_82%,white)] px-xl py-xl"
							>
								<p className="mb-xs text-body-xl font-heavy text-dashboardy-heading">
									Thinking
								</p>
								<p className="whitespace-pre-wrap text-body-l text-ink-3 italic text-pretty">
									<SignalText text={block.thinking} />
								</p>
							</div>
						);

					case "tool_use": {
						const toolResult = toolResults.get(block.id);
						return (
							<ToolInvocation
								key={blockKey}
								toolName={block.name}
								input={block.input}
								result={
									toolResult
										? {
												content: toolResult.content,
												is_error: toolResult.is_error,
											}
										: undefined
								}
							/>
						);
					}

					case "tool_result": {
						if (toolUses.has(block.tool_use_id)) {
							return null;
						}

						const resultContent =
							typeof block.content === "string"
								? block.content
								: block.content
										.map((item) =>
											item.type === "text" && "text" in item
												? item.text
												: JSON.stringify(item),
										)
										.join("\n");
						const output = formatShellOutput(resultContent);

						return (
							<div
								key={blockKey}
								className={cn(
									"grid gap-l corner-l edge-m p-xl",
									block.is_error
										? "border-line bg-error-tint"
										: "border-line bg-[color:color-mix(in_srgb,var(--inset)_82%,white)]",
								)}
							>
								<p
									className={cn(
										"text-body-xl font-heavy",
										block.is_error ? "text-error" : "text-dashboardy-heading",
									)}
								>
									{block.is_error ? "Tool Error" : "Tool Result"}
								</p>
								<CodeBlock
									code={output.text}
									filename={block.is_error ? "Error Output" : "Output"}
									language={output.language}
									showLineNumbers
								/>
							</div>
						);
					}

					default:
						return null;
				}
			})}
			{omittedBlockCount > 0 ? (
				<p
					data-testid="message-block-limit-notice"
					className="whitespace-pre-wrap break-words text-body-l text-ink-3 italic [overflow-wrap:anywhere]"
				>
					Additional content not shown ({omittedBlockCount}{" "}
					{omittedBlockCount === 1 ? "block" : "blocks"} omitted).
				</p>
			) : null}
		</div>
	);
}
