import { IconBook, IconPlug } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
	SESSION_OVERVIEW_ICON_TAG_CLASS_NAME,
	SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
	SESSION_OVERVIEW_TAG_ICON_CLASS_NAME,
} from "./session-overview-row-elements";

const KINDS = {
	skill: {
		icon: IconBook,
		label: "Skills",
		className:
			"bg-[#ede9fe] text-[#6d28d9] dark:bg-[#2e1f4d] dark:text-[#c4b5fd]",
	},
	mcp: {
		icon: IconPlug,
		label: "MCP servers",
		className:
			"bg-[#e0f2fe] text-[#0369a1] dark:bg-[#0c3049] dark:text-[#7dd3fc]",
	},
} as const;

function ToolTag({
	kind,
	names,
}: {
	kind: keyof typeof KINDS;
	names: readonly string[];
}) {
	const [first, ...rest] = names;
	if (!first) return null;
	const { icon: Icon, label, className } = KINDS[kind];
	return (
		<span
			className={cn(
				SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
				SESSION_OVERVIEW_ICON_TAG_CLASS_NAME,
				className,
				"max-w-40",
			)}
			data-session-overview-tool-tag={kind}
		>
			<Icon
				aria-hidden="true"
				className={SESSION_OVERVIEW_TAG_ICON_CLASS_NAME}
			/>
			<span className="min-w-0 truncate" aria-hidden="true">
				{first}
			</span>
			{rest.length > 0 ? (
				<span className="shrink-0 text-[0.5rem]" aria-hidden="true">
					+{rest.length}
				</span>
			) : null}
			<span className="sr-only">
				{label}: {names.join(", ")}
			</span>
		</span>
	);
}

export function SessionOverviewToolTags({
	skills,
	mcpServers,
}: {
	skills: readonly string[];
	mcpServers: readonly string[] | undefined;
}) {
	return (
		<>
			<ToolTag kind="skill" names={skills} />
			<ToolTag kind="mcp" names={mcpServers ?? []} />
		</>
	);
}
