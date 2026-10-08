import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
} from "react";
import { MemoryRouter } from "react-router-dom";
import { AppRouter } from "@/app/AppRouter";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { DateRangeProvider } from "@/features/analytics/date-range/DateRangeProvider";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { SessionsPage } from "@/features/sessions/sessions-page";
import { LAST_SESSION_UPLOAD_INPUT } from "@/features/shell/components/last-session-upload-bar";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { orpc } from "@/lib/orpc";
import { ensureLiveDemoSession } from "../../../../marketing/src/scripts/live-demo";
import {
	getDemoActive,
	getDemoServerActive,
	subscribeDemoActive,
} from "./demo-activation";
import { DemoRuntimeContext, type DemoSeed } from "./demo-runtime";

export function DemoRoot({ seed }: { seed: DemoSeed }) {
	const active = useSyncExternalStore(
		subscribeDemoActive,
		getDemoActive,
		getDemoServerActive,
	);
	const [client] = useState(() => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
		});
		// Render the actual dashboard and its stat card trends before activation,
		// then refresh them on Explore.
		for (const { input, data } of [seed.dashboard, ...seed.previews]) {
			client.setQueryData(
				[
					"org",
					seed.organization.id,
					...orpc.analytics.overview.costs.queryOptions({ input }).queryKey,
				],
				data,
				{ updatedAt: 0 },
			);
		}
		// Seed rows are newest first: the last upload bar's session.
		client.setQueryData(
			[
				"org",
				seed.organization.id,
				...orpc.analytics.sessions.list.queryOptions({
					input: LAST_SESSION_UPLOAD_INPUT,
				}).queryKey,
			],
			seed.sessions.slice(0, 1),
			{ updatedAt: 0 },
		);
		return client;
	});
	const [connection, setConnection] = useState<
		"idle" | "connecting" | "live" | "error"
	>("idle");
	const live = active && connection === "live";
	useLayoutEffect(() => {
		// Focus once on entry, never when a later network response arrives.
		// Preserve a control the visitor has already focused themselves.
		if (active && document.activeElement === document.body)
			document
				.querySelector<HTMLElement>(
					'.cost-page-scroll, [data-slot="sessions-overview-scroll-container"]',
				)
				?.focus({ preventScroll: true });
	}, [active]);
	const connect = useCallback(async () => {
		setConnection("connecting");
		try {
			await ensureLiveDemoSession();
			setConnection("live");
			document.documentElement.dataset.demoLive = "";
		} catch {
			setConnection("error");
		}
	}, []);
	useEffect(() => {
		if (active && connection === "idle") void connect();
	}, [active, connection, connect]);
	useMountEffect(() => {
		document.documentElement.dataset.demoHydrated = "";
	});
	return (
		<DemoRuntimeContext.Provider value={{ seed, live }}>
			<QueryClientProvider client={client}>
				<MemoryRouter
					initialEntries={[
						`/dashboard?from=${seed.dashboard.input.startDate}&to=${seed.dashboard.input.endDate}`,
					]}
				>
					<WorkspaceStateProvider
						value={{
							state: {
								activeOrg: seed.organization,
								organizations: [seed.organization],
								isLoading: false,
							},
							meta: { isOrgAdmin: true },
							actions: {
								switchOrganization: async () => {
									throw new Error("This demo uses the showcase workspace.");
								},
							},
						}}
					>
						<DateRangeProvider storageKey="demoDateRange">
							<div className="h-full" inert={!active} data-demo-surface>
								<AppRouter
									rootRedirectTarget="/dashboard"
									dashboardComponent={DashboardPage}
									sessionComponent={SessionsPage}
								/>
							</div>
						</DateRangeProvider>
					</WorkspaceStateProvider>
				</MemoryRouter>
			</QueryClientProvider>
			{active && connection === "error" ? (
				<div
					role="alert"
					className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-white p-4 shadow-lg"
				>
					The live demo could not connect.{" "}
					<button type="button" onClick={() => void connect()}>
						Try again
					</button>
				</div>
			) : null}
		</DemoRuntimeContext.Provider>
	);
}
