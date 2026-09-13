import type { ComponentType } from "react";
import type { ToolIconName } from "./conversation-tools";
import {
	TraceBotIcon,
	TraceComputerIcon,
	TraceFileAddIcon,
	TraceGlobeIcon,
	TraceImageIcon,
	TraceListIcon,
	TracePencilIcon,
	TraceReadIcon,
	TraceSearchIcon,
	TraceTerminalIcon,
	TraceWrenchIcon,
} from "./conversation-trace-hugeicons";

export const CONVERSATION_TOOL_ICONS: Record<
	ToolIconName,
	ComponentType<{ className?: string }>
> = {
	bot: TraceBotIcon,
	computer: TraceComputerIcon,
	file: TraceReadIcon,
	"file-add": TraceFileAddIcon,
	globe: TraceGlobeIcon,
	image: TraceImageIcon,
	list: TraceListIcon,
	pencil: TracePencilIcon,
	search: TraceSearchIcon,
	sparkle: TraceWrenchIcon,
	terminal: TraceTerminalIcon,
	wrench: TraceWrenchIcon,
};
