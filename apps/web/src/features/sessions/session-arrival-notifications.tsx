import type { SessionArrival } from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { appRoutes, getWorkspaceAppPath } from "@/app/routes";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { collectNewSessionArrivals } from "./session-arrival-tracker";

export function SessionArrivalNotifications() {
	const organization = useOptionalOrganization()?.state;
	const workspace = organization?.activeOrg;
	if (!workspace || organization.isLoading) return null;
	return (
		<WorkspaceSessionArrivalNotifications
			key={workspace.id}
			organizationId={workspace.id}
			workspaceSlug={workspace.slug}
		/>
	);
}

function WorkspaceSessionArrivalNotifications({
	organizationId,
	workspaceSlug,
}: {
	organizationId: string;
	workspaceSlug: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const since = useRef<string | undefined>(undefined);
	const seen = useRef<ReadonlySet<string>>(new Set());
	const toastIds = useRef(new Set<string>());
	const query = useQuery({
		queryKey: ["org", organizationId, "session-arrivals"],
		queryFn: async ({ signal }) => {
			const sessions: SessionArrival[] = [];
			let after: string | undefined;
			do {
				const page = await orpc.analytics.sessions.arrivals.call(
					{ organizationId, since: since.current, after },
					{ signal },
				);
				since.current = page.since;
				sessions.push(...page.sessions);
				after = page.nextCursor ?? undefined;
			} while (after && !signal.aborted);
			return sessions;
		},
		refetchInterval: 10_000,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		// A new subscription establishes its own baseline, never replays cache.
		gcTime: 0,
	});

	useEffect(() => {
		if (!query.data || !query.isFetchedAfterMount) return;
		const next = collectNewSessionArrivals(seen.current, query.data);
		seen.current = next.seen;
		for (const session of next.arrivals) {
			const id = `session-arrival:${organizationId}:${session.sessionId}`;
			toastIds.current.add(id);
			toast.success("New session uploaded", {
				id,
				description: session.userName
					? `From ${session.userName}`
					: "Your session is ready to view.",
				duration: 10_000,
				closeButton: true,
				action: {
					label: "Open session",
					onClick: () =>
						navigate(
							getWorkspaceAppPath(
								workspaceSlug,
								appRoutes.sessionDetail(session.sessionId),
							),
						),
				},
			});
		}
		if (next.arrivals.length) {
			// Refresh the visible dashboard and session rows in one batch.
			void queryClient.invalidateQueries({
				queryKey: ["org", organizationId],
				predicate: (cachedQuery) =>
					cachedQuery.queryKey[2] !== "session-arrivals",
			});
		}
	}, [
		query.data,
		query.isFetchedAfterMount,
		navigate,
		organizationId,
		queryClient,
		workspaceSlug,
	]);

	useEffect(() => {
		const ids = toastIds.current;
		return () => {
			for (const id of ids) toast.dismiss(id);
		};
	}, []);
	return null;
}
