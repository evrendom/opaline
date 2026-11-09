import {
	SESSION_ARRIVALS_PATH,
	SessionArrivalsPageSchema,
} from "@rudel/api-routes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { appRoutes, getWorkspaceAppPath } from "@/app/routes";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { SESSION_DETAIL_INITIAL_QUERY_PREFIX } from "./components/session-detail-fast-query";
import {
	isOrganizationQueryChangedByArrival,
	isSessionDetailChangedByArrival,
	mergeSessionArrivalChange,
	SESSION_ARRIVAL_REFRESH_DELAY_MS,
	type SessionArrivalChange,
} from "./session-arrival-refresh";
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
	const navigateRef = useRef(navigate);
	useEffect(() => {
		navigateRef.current = navigate;
	}, [navigate]);
	const queryClient = useQueryClient();
	const seen = useRef<ReadonlySet<string>>(new Set());
	const toastIds = useRef(new Set<string>());
	useEffect(() => {
		const ids = toastIds.current;
		let events: EventSource | null = null;
		let handshake = true;
		let pending: SessionArrivalChange | null = null;
		let refreshTimer: ReturnType<typeof setTimeout> | null = null;
		const refresh = () => {
			refreshTimer = null;
			const change = pending;
			pending = null;
			if (!change) return;
			void queryClient.invalidateQueries({
				predicate: (query) =>
					isOrganizationQueryChangedByArrival(
						query.queryKey,
						organizationId,
						change,
					),
			});
			void queryClient.invalidateQueries({
				queryKey: SESSION_DETAIL_INITIAL_QUERY_PREFIX,
				predicate: (query) =>
					isSessionDetailChangedByArrival(query.queryKey[2], change),
			});
		};
		const onOpen = () => {
			handshake = true;
		};
		const onSessions = (event: MessageEvent<string>) => {
			let payload: unknown;
			try {
				payload = JSON.parse(event.data);
			} catch {
				return;
			}
			const page = SessionArrivalsPageSchema.safeParse(payload);
			if (!page.success) return;
			const opening = handshake;
			handshake = false;
			if (opening && page.data.sessions.length === 0) return;
			const next = collectNewSessionArrivals(seen.current, page.data.sessions);
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
							navigateRef.current(
								getWorkspaceAppPath(
									workspaceSlug,
									appRoutes.sessionDetail(session.sessionId),
								),
							),
					},
				});
			}
			pending = mergeSessionArrivalChange(
				pending,
				page.data.sessions.map((session) => session.sessionId),
			);
			refreshTimer ??= setTimeout(refresh, SESSION_ARRIVAL_REFRESH_DELAY_MS);
		};
		const connect = () => {
			if (events) return;
			events = new EventSource(
				`${SESSION_ARRIVALS_PATH}?${new URLSearchParams({ organizationId })}`,
				{ withCredentials: true },
			);
			events.addEventListener("open", onOpen);
			events.addEventListener("sessions", onSessions);
		};
		const disconnect = () => {
			events?.close();
			events = null;
		};
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") disconnect();
			else connect();
		};
		if (document.visibilityState !== "hidden") connect();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			disconnect();
			if (refreshTimer) clearTimeout(refreshTimer);
			for (const id of ids) toast.dismiss(id);
		};
	}, [organizationId, queryClient, workspaceSlug]);
	return null;
}
