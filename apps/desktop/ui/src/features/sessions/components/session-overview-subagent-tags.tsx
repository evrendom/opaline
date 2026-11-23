import type { SessionAnalytics } from "@rudel/api-routes";
import { IconGhost } from "@tabler/icons-react";
import { Tag } from "@/app/ui/tag";
import { TraceBotIcon } from "@/components/conversation/conversation-trace-glyphs";
import { resolveSessionNativeSubagentCount } from "./session-overview-metrics";

type SessionSubagentData = Pick<
	SessionAnalytics,
	| "subagent_count"
	| "subagent_types"
	| "native_subagents"
	| "native_child_sessions"
	| "linked_subagent_count"
	| "linked_subagents"
>;

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
		<Tag
			data-session-overview-subagent-count={count}
			title={`${count} ${count === 1 ? "subagent" : "subagents"}`}
		>
			<IconGhost aria-hidden="true" />
			<span>{count}</span>
		</Tag>
	);
}

export function SessionOverviewSubagentTag({
	subagentOf,
}: {
	subagentOf: NonNullable<SessionAnalytics["subagent_of"]>;
}) {
	return (
		<Tag
			data-session-overview-subagent-tag={subagentOf.kind}
			title={SUBAGENT_ROW_TITLES[subagentOf.kind]}
		>
			<TraceBotIcon />
			<span>Subagent</span>
		</Tag>
	);
}
