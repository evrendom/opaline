import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { AppRouter } from "@/app/AppRouter";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { DateRangeProvider } from "@/features/analytics/date-range/DateRangeProvider";
import { SessionsPage } from "@/features/sessions/sessions-page";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { ensureLiveDemoSession } from "../../../../marketing/src/scripts/live-demo";
import { DemoRuntimeContext, type DemoSeed } from "./demo-runtime";

export function DemoRoot({ seed }: { seed: DemoSeed }) {
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
			}),
	);
	const [live, setLive] = useState(false);
	const [error, setError] = useState(false);
	useEffect(() => {
		if (live && document.hasFocus())
			document
				.querySelector<HTMLElement>(
					'[data-slot="sessions-overview-scroll-container"]',
				)
				?.focus({ preventScroll: true });
	}, [live]);
	async function connect() {
		setError(false);
		try {
			await ensureLiveDemoSession();
			setLive(true);
			document.documentElement.dataset.demoLive = "";
		} catch {
			setError(true);
		}
	}
	useMountEffect(() => {
		document.documentElement.dataset.demoHydrated = "";
		void connect();
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
							<div className="h-full" inert={!live} data-demo-surface>
								<AppRouter
									rootRedirectTarget="/session"
									sessionComponent={SessionsPage}
								/>
							</div>
						</DateRangeProvider>
					</WorkspaceStateProvider>
				</MemoryRouter>
			</QueryClientProvider>
			{error ? (
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
