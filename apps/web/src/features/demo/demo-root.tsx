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
import { SessionsPage } from "@/features/sessions/sessions-page";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
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
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
			}),
	);
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
					'[data-slot="sessions-overview-scroll-container"]',
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
					initialEntries={["/session?from=2026-08-01&to=2026-08-31"]}
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
						<DateRangeProvider>
							<div className="h-full" inert={!active} data-demo-surface>
								<AppRouter
									rootRedirectTarget="/session"
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
