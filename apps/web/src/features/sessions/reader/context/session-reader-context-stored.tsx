import type { SessionContextSnapshot } from "@rudel/api-routes/session-context/session-context-snapshot";
import { useQuery } from "@tanstack/react-query";
import { useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { CompactionToggle } from "./session-reader-context-compaction";
import { ContextToggleSlot } from "./session-reader-context-head";
import { ContextTiles } from "./session-reader-context-tiles";

const SNAPSHOT_STALE_TIME_MS = 5 * 60_000;

export function contextSnapshotOptions(
	organizationId: string | undefined,
	sessionId: string,
) {
	const options = orpc.analytics.sessions.contextSnapshot.queryOptions({
		input: { sessionId },
	});
	return {
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		staleTime: SNAPSHOT_STALE_TIME_MS,
	};
}

export function useStoredContextSnapshot(sessionId: string) {
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	return useQuery({
		...contextSnapshotOptions(organizationId, sessionId),
		enabled: !!organizationId,
		retry: 1,
	});
}

export function StoredSessionContext({
	sessionId,
	snapshot,
}: {
	sessionId: string;
	snapshot: SessionContextSnapshot;
}) {
	const [withCompaction, setWithCompaction] = useState<boolean | null>(null);
	const first = snapshot.views[0];
	const view =
		(withCompaction === null
			? first
			: snapshot.views.find(
					(each) => each.withCompaction === withCompaction,
				)) ?? first;
	const compacting = useMemo(() => new Set(view?.compacting), [view]);
	const toggleSlot = useContext(ContextToggleSlot);
	if (!view) return null;
	const sides = snapshot.views.length > 1;
	const toggle = sides ? (
		<CompactionToggle
			value={view.withCompaction ?? false}
			onChange={setWithCompaction}
		/>
	) : null;
	return (
		<div className="flex min-w-0 flex-col">
			<ContextTiles
				compactedRuns={view.compactedRuns}
				compacting={compacting}
				cost={sides ? view.segmentCost : snapshot.sessionCost}
				costOutside={`After its fullest moment${view.later > 0 ? ` · ${view.later} ${view.later === 1 ? "run" : "runs"}` : ""}`}
				footer={toggleSlot ? null : toggle}
				map={view.map}
				measure="context"
				memory={`session:${sessionId}`}
				whole
			/>
			{toggleSlot && toggle ? createPortal(toggle, toggleSlot) : null}
		</div>
	);
}
