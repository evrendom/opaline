import type { SessionAnalytics } from "@rudel/api-routes";
import { IconGhost } from "@tabler/icons-react";
import { TraceBotIcon } from "@/components/conversation/conversation-trace-glyphs";
import { cn } from "@/lib/utils";
import { resolveSessionNativeSubagentCount } from "./session-overview-metrics";
import {
	SESSION_OVERVIEW_ICON_TAG_CLASS_NAME,
	SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
	SESSION_OVERVIEW_TAG_ICON_CLASS_NAME,
	SESSION_OVERVIEW_TAG_NUMBER_CLASS_NAME,
} from "./session-overview-row-elements";

type SessionSubagentData = Pick<
	SessionAnalytics,
	| "subagent_count"
	| "subagent_types"
	| "native_subagents"
	| "native_child_sessions"
	| "linked_subagent_count"
	| "linked_subagents"
>;

const SUBAGENT_TAG_CLASS_NAME = cn(
	SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
	"shrink-0 whitespace-nowrap bg-black/5 text-[#5f5e5b] dark:bg-white/8 dark:text-white/65",
);

const SUBAGENT_ROW_TITLES: Record<
	NonNullable<SessionAnalytics["subagent_of"]>["kind"],
	string
> = {
	agent: "Subagent inside its parent session",
	child: "Subagent session spawned by its parent session",
	linked: "Session another session called as a subagent",
};

export function getSessionOverviewSubagentCount(
	session: SessionSubagentData,
): number {
	const native = Math.max(
		resolveSessionNativeSubagentCount(
			session.subagent_count,
			session.subagent_types,
		),
		session.native_subagents?.length ?? 0,
		session.native_child_sessions?.length ?? 0,
	);
	const linked = Math.max(
		session.linked_subagent_count ?? 0,
		session.linked_subagents?.length ?? 0,
	);
	return native + linked;
}

export function SessionOverviewSubagentCountTag({
	session,
}: {
	session: SessionSubagentData;
}) {
	const count = getSessionOverviewSubagentCount(session);
	if (count === 0) return null;
	return (
		<span
			className={cn(
				SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
				SESSION_OVERVIEW_ICON_TAG_CLASS_NAME,
				"shrink-0 bg-[#fce7f3] text-[#be185d] dark:bg-[#4a1d36] dark:text-[#f472b6]",
			)}
			data-session-overview-subagent-count={count}
			title={`${count} ${count === 1 ? "subagent" : "subagents"}`}
		>
			<IconGhost
				aria-hidden="true"
				className={SESSION_OVERVIEW_TAG_ICON_CLASS_NAME}
			/>
			<span className={SESSION_OVERVIEW_TAG_NUMBER_CLASS_NAME}>{count}</span>
		</span>
	);
}

export function SessionOverviewSubagentTag({
	subagentOf,
}: {
	subagentOf: NonNullable<SessionAnalytics["subagent_of"]>;
}) {
	return (
		<span
			className={SUBAGENT_TAG_CLASS_NAME}
			data-session-overview-subagent-tag={subagentOf.kind}
			title={SUBAGENT_ROW_TITLES[subagentOf.kind]}
		>
			<TraceBotIcon className="size-3 shrink-0" />
			<span>Subagent</span>
		</span>
	);
}
