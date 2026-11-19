import {
	QueryClient,
	QueryClientProvider,
	type QueryKey,
} from "@tanstack/react-query";
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
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { DateRangeProvider } from "@/features/analytics/date-range/DateRangeProvider";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { SessionsPage } from "@/features/sessions/sessions-page";
import { toLastSessionUpload } from "@/features/shell/components/last-session-upload-bar";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { orpc } from "@/lib/orpc";
import { ensureLiveDemoSession } from "../../site/scripts/live-demo";
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
	const [{ client, seeded }] = useState(() => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
		});
		// Render the actual dashboard and its stat card trends before activation.
		// The stat cards read every session metric from one answer, so each
		// seeded answer carries every seeded metric.
		const answers = [seed.dashboard, ...seed.previews];
		const seededMetrics = Object.fromEntries(
			answers
				.filter(({ input }) => input.splitBy === "none")
				.map(({ input, data }) => {
					const metric = input.requestedMetric ?? "cost";
					return [metric, data.metrics[metric]];
				}),
		);
		const seeded: Array<[QueryKey, unknown]> = [
			...answers.map(({ input, data }): [QueryKey, unknown] => [
				[
					"org",
					seed.organization.id,
					...orpc.analytics.overview.costs.queryOptions({ input }).queryKey,
				],
				input.splitBy === "none"
					? { ...data, metrics: { ...data.metrics, ...seededMetrics } }
					: data,
			]),
			[
				[
					"org",
					seed.organization.id,
					...orpc.analytics.repositories.list.queryOptions({}).queryKey,
				],
				seed.repositories,
			],
			[
				[
					"org",
					seed.organization.id,
					...orpc.analytics.repositories.navigation.queryOptions({}).queryKey,
				],
				seed.repositories,
			],
			// Seed rows are newest first: the last upload bar's session.
			[
				[
					"org",
					seed.organization.id,
					...orpc.analytics.sessions.lastUpload.queryOptions().queryKey,
				],
				toLastSessionUpload(seed.sessions[0]),
			],
		];
		for (const [queryKey, data] of seeded)
			client.setQueryData(queryKey, data, { updatedAt: 0 });
		return { client, seeded };
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
			// The seed is the live demo's answer (tools/export-demo-seed.ts). Keep
			// it fresh on Explore rather than reload what is already on screen.
			for (const [queryKey, data] of seeded)
				client.setQueryData(queryKey, data);
			setConnection("live");
			document.documentElement.dataset.demoLive = "";
		} catch {
			setConnection("error");
		}
	}, [client, seeded]);
	useEffect(() => {
		if (active && connection === "idle") void connect();
	}, [active, connection, connect]);
	useMountEffect(() => {
		document.documentElement.dataset.demoHydrated = "";
	});
	return (
		<DemoRuntimeContext.Provider value={{ seed, live }}>
			<ThemeProvider pageTheme="dark">
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
								meta: { isOrgAdmin: true, readsEverySession: true },
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
			</ThemeProvider>
			{active && connection === "error" ? (
				<div
					role="alert"
					className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-popover p-4 text-popover-foreground shadow-lg dark:shadow-(--custom-shadow)"
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
