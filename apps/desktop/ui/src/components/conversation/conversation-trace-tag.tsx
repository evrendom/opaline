import type { ComponentPropsWithoutRef } from "react";
import { ModelChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import { cn } from "@/lib/utils";
import { ConversationSkillIcon } from "./conversation-skill-icon";
import type { ToolIconName } from "./conversation-tools";
import {
	TraceMarkdownIcon,
	TraceTypeScriptIcon,
} from "./conversation-trace-glyphs";
import { getModelIconComponent } from "./conversation-trace-model-icon";
import { CONVERSATION_TOOL_ICONS } from "./conversation-trace-tool-icons";

export const CONVERSATION_TRACE_TAG_CLASS_NAME =
	// design-escape-ok(opacity): no role renders this; dark:bg-ink/7, dark:text-ink/93
	"inline-flex h-5 items-center gap-xs truncate corner-xs bg-canvas pr-s pl-xxs dashboardy-mono text-body-m font-medium text-ink shadow-chip select-none dark:bg-ink/7 dark:text-ink/93 dark:shadow-inset";

const defaultIconClassName = "size-3.5 shrink-0 text-ink-3";
// design-escape-ok(colour): TypeScript's brand colour
const typeScriptIconClassName = "size-3.5 shrink-0 text-[#3178c6]";

function isTypeScriptFile(value: string) {
	return /\.(?:cts|mts|ts|tsx)$/i.test(value);
}

function isMarkdownFile(value: string) {
	return /\.(?:markdown|md)$/i.test(value);
}

function isFileToolIcon(toolIcon: ToolIconName) {
	return (
		toolIcon === "file" || toolIcon === "file-add" || toolIcon === "pencil"
	);
}

interface ConversationTraceTagProps extends ComponentPropsWithoutRef<"span"> {
	hideIcon?: boolean;
	model?: string;
	toolIcon: ToolIconName;
	value: string;
}

export function ConversationTraceTag({
	children,
	className,
	hideIcon = false,
	model,
	toolIcon,
	value,
	...props
}: ConversationTraceTagProps) {
	const usesTypeScriptIcon =
		isFileToolIcon(toolIcon) && isTypeScriptFile(value);
	const usesMarkdownIcon = isFileToolIcon(toolIcon) && isMarkdownFile(value);
	const ModelIcon = getModelIconComponent(model);
	const ContextIcon = usesTypeScriptIcon
		? TraceTypeScriptIcon
		: usesMarkdownIcon
			? TraceMarkdownIcon
			: CONVERSATION_TOOL_ICONS[toolIcon];
	const context = ModelIcon
		? "delegated-model"
		: usesTypeScriptIcon
			? "typescript"
			: usesMarkdownIcon
				? "markdown"
				: toolIcon;
	const iconClassName = usesTypeScriptIcon
		? typeScriptIconClassName
		: defaultIconClassName;

	return (
		<span
			{...props}
			className={cn(CONVERSATION_TRACE_TAG_CLASS_NAME, className)}
			data-trace-tag-context={context}
		>
			{hideIcon ? null : ModelIcon ? (
				<ModelChip chip="size-4" glyph="size-2.5" model={model} tip={false} />
			) : toolIcon === "sparkle" ? (
				<ConversationSkillIcon skill={value} className={iconClassName} />
			) : (
				<ContextIcon className={iconClassName} />
			)}
			{children}
		</span>
	);
}
