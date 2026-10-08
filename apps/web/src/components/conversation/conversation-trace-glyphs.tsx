import type { Icon } from "@tabler/icons-react";
import {
	IconAlertCircle,
	IconArrowsExchange,
	IconBook,
	IconBrandTypescript,
	IconChevronDown,
	IconChevronRight,
	IconCode,
	IconCpu,
	IconDeviceDesktop,
	IconFile,
	IconFilePlus,
	IconFileText,
	IconList,
	IconMessage2,
	IconPencil,
	IconPhoto,
	IconRobot,
	IconSearch,
	IconSettings,
	IconSparkles,
	IconStack2,
	IconTerminal2,
	IconTool,
	IconUser,
	IconWorld,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

type ConversationTraceGlyphProps = {
	className?: string;
	"data-trace-disclosure-symbol"?: string;
};

type ConversationTraceGlyph = ComponentType<ConversationTraceGlyphProps>;

function createConversationTraceGlyph(Glyph: Icon): ConversationTraceGlyph {
	return function ConversationTraceGlyph({
		className,
		...traceAttributes
	}: ConversationTraceGlyphProps) {
		// Outline glyphs at the transcript's lighter 1.5 weight.
		return (
			<Glyph
				{...traceAttributes}
				aria-hidden="true"
				className={className}
				data-trace-glyph
				stroke={1.5}
			/>
		);
	};
}

export const TraceAlertIcon = createConversationTraceGlyph(IconAlertCircle);
export const TraceBotIcon = createConversationTraceGlyph(IconRobot);
export const TraceBrainIcon = createConversationTraceGlyph(IconCpu);
export const TraceChevronDownIcon =
	createConversationTraceGlyph(IconChevronDown);
export const TraceChevronRightIcon =
	createConversationTraceGlyph(IconChevronRight);
export const TraceCodeIcon = createConversationTraceGlyph(IconCode);
export const TraceComputerIcon =
	createConversationTraceGlyph(IconDeviceDesktop);
export const TraceExchangeIcon =
	createConversationTraceGlyph(IconArrowsExchange);
export const TraceFileIcon = createConversationTraceGlyph(IconFile);
export const TraceFileAddIcon = createConversationTraceGlyph(IconFilePlus);
export const TraceMarkdownIcon = createConversationTraceGlyph(IconFileText);
export const TraceGlobeIcon = createConversationTraceGlyph(IconWorld);
export const TraceImageIcon = createConversationTraceGlyph(IconPhoto);
export const TraceLayersIcon = createConversationTraceGlyph(IconStack2);
export const TraceListIcon = createConversationTraceGlyph(IconList);
export const TraceMessageIcon = createConversationTraceGlyph(IconMessage2);
export const TracePencilIcon = createConversationTraceGlyph(IconPencil);
export const TraceReadIcon = createConversationTraceGlyph(IconBook);
export const TraceSearchIcon = createConversationTraceGlyph(IconSearch);
export const TraceSettingsIcon = createConversationTraceGlyph(IconSettings);
export const TraceSparklesIcon = createConversationTraceGlyph(IconSparkles);
export const TraceTerminalIcon = createConversationTraceGlyph(IconTerminal2);
export const TraceTypeScriptIcon =
	createConversationTraceGlyph(IconBrandTypescript);
export const TraceUserIcon = createConversationTraceGlyph(IconUser);
export const TraceWrenchIcon = createConversationTraceGlyph(IconTool);
