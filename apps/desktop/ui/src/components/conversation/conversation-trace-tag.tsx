import type { ComponentPropsWithoutRef } from "react";
import { Tag } from "@/app/ui/tag";
import { ModelChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import { ConversationSkillIcon } from "./conversation-skill-icon";
import type { ToolIconName } from "./conversation-tools";
import {
	TraceMarkdownIcon,
	TraceTypeScriptIcon,
} from "./conversation-trace-glyphs";
import { getModelIconComponent } from "./conversation-trace-model-icon";
import { CONVERSATION_TOOL_ICONS } from "./conversation-trace-tool-icons";

// design-escape-ok(colour): data paint; TypeScript's brand colour
const typeScriptIconClassName = "text-[#3178c6]";

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
	// The Tag sizes and greys its icons; only TypeScript's keeps its colour.
	const iconClassName = usesTypeScriptIcon ? typeScriptIconClassName : "";

	return (
		<Tag
			{...props}
			size="md"
			className={className}
			data-trace-tag-context={context}
		>
			{hideIcon ? null : ModelIcon ? (
				<ModelChip
					chip="size-4"
					// text-current keeps the brand colour the chip sets, not the Tag's grey.
					glyph="size-2.5 text-current"
					model={model}
					tip={false}
				/>
			) : toolIcon === "sparkle" ? (
				<ConversationSkillIcon skill={value} className={iconClassName} />
			) : (
				<ContextIcon className={iconClassName} />
			)}
			{children}
		</Tag>
	);
}
