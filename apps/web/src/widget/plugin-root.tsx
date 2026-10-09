import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AppRouter } from "@/app/AppRouter";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { getCanonicalAppPath } from "@/app/routes";
import { embeddedConversationTraceMaskStyle } from "@/components/conversation/conversation-trace-mask";
import {
	DateRangeProvider,
	useDateRange,
} from "@/features/analytics/date-range/DateRangeProvider";
import { DeferredPersonRowsContext } from "@/features/costs/deferred-person-rows";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { orpc } from "@/lib/orpc";
import {
	getWidgetState,
	type HostState,
	onAccountLoaded,
	openPluginLink,
	type PluginAccount,
	type PluginSeed,
	requestHost,
	setWidgetState,
} from "./host-bridge";
import "../index.css";

const PERSON_SPLITS = new Set(["members", "githubAuthors"]);

// Masks need CORS from another origin; the sandbox gets this one inline.
document.documentElement.style.setProperty(
	"--opaline-trace-mask",
	embeddedConversationTraceMaskStyle["--opaline-trace-mask"],
);

export function PluginRoot({
	host,
	seed,
}: {
	host: HostState;
	seed: PluginSeed;
}) {
	const [seedKey] = useState(() => [
		"org",
		seed.bootstrap.organization.id,
		...orpc.analytics.overview.costs.queryOptions({
			input: seed.dashboard.input,
		}).queryKey,
	]);
	const [client] = useState(() => {
		const client = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
					staleTime: 60_000,
					refetchOnWindowFocus: false,
					refetchOnReconnect: false,
					refetchInterval: false,
				},
			},
		});
		// A trend split by person needs rows the first view does not carry,
		// so that view loads through the costs tool instead.
		if (!PERSON_SPLITS.has(seed.dashboard.input.splitBy ?? "none"))
			client.setQueryData(seedKey, seed.dashboard.data);
		return client;
	});
	const [personRowsLoaded, setPersonRowsLoaded] = useState(false);
	// The role arrives with the account, when a view first needs it.
	const [account, setAccount] = useState<PluginAccount | null>(null);
	useEffect(() => onAccountLoaded(setAccount), []);
	const deferredPersonRows = useMemo(
		() => ({
			isDeferred: (data: unknown) =>
				!personRowsLoaded && data === seed.dashboard.data,
			load: () => {
				setPersonRowsLoaded(true);
				void client.invalidateQueries({ queryKey: seedKey, exact: true });
			},
		}),
		[client, personRowsLoaded, seed.dashboard.data, seedKey],
	);
	const organization = seed.bootstrap.organization;
	const params = new URLSearchParams({
		from: seed.query.startDate,
		to: seed.query.endDate,
		metric: seed.query.metric,
		split: seed.query.splitBy,
	});
	for (const [key, values] of [
		["member", seed.query.members],
		["repo", seed.query.repositories],
		["model", seed.query.models],
	] as const)
		for (const value of values) params.append(key, value);
	const dashboardPath = `/${organization.slug}/dashboard?${params}`;
	return (
		<ThemeProvider forcedTheme={host.theme === "dark" ? "dark" : "light"}>
			<QueryClientProvider client={client}>
				<MemoryRouter
					initialEntries={[
						host.deepLink ?? getWidgetState().route ?? dashboardPath,
					]}
				>
					<WorkspaceStateProvider
						value={{
							state: {
								activeOrg: organization,
								organizations: [organization],
								// Loaded on demand (useFullOrganization) by views that
								// show member names; get_dashboard does not send them.
								members: undefined,
								isLoading: false,
							},
							meta: {
								isOrgAdmin: ["owner", "admin"].includes(
									account?.member?.role ?? "",
								),
							},
							actions: {
								switchOrganization: async () => {
									openPluginLink("/");
								},
							},
						}}
					>
						<DeferredPersonRowsContext.Provider value={deferredPersonRows}>
							<DateRangeProvider>
								<PluginRouter host={host} dashboardPath={dashboardPath} />
							</DateRangeProvider>
						</DeferredPersonRowsContext.Provider>
					</WorkspaceStateProvider>
				</MemoryRouter>
			</QueryClientProvider>
		</ThemeProvider>
	);
}

function PluginRouter({
	host,
	dashboardPath,
}: {
	host: HostState;
	dashboardPath: string;
}) {
	const location = useLocation();
	const navigate = useNavigate();
	const { state: dates } = useDateRange();
	const previousLink = useRef(host.deepLink);
	const lastRoute = useRef(dashboardPath);
	const path = getCanonicalAppPath(location.pathname);
	const allowed =
		/^\/(?:dashboard|session(?:\/[^/]+(?:\/v2)?)?|skills|repos|team|home)$/u.test(
			path,
		);
	useEffect(() => {
		if (host.deepLink && host.deepLink !== previousLink.current) {
			previousLink.current = host.deepLink;
			navigate(host.deepLink);
			return;
		}
		if (!allowed) {
			openPluginLink(location.pathname + location.search);
			navigate(lastRoute.current, { replace: true });
			return;
		}
		const route = location.pathname + location.search;
		lastRoute.current = route;
		setWidgetState({
			route,
			dateRange: { start: dates.startDate, end: dates.endDate },
		});
		// Lets the user ask the chat about what they are looking at.
		void requestHost("ui/update-model-context", {
			content: [
				{
					type: "text",
					text: `The user is viewing Opaline ${path} for ${dates.startDate} to ${dates.endDate}.`,
				},
			],
		}).catch(console.error);
	}, [
		allowed,
		dates.startDate,
		dates.endDate,
		host.deepLink,
		location.pathname,
		location.search,
		navigate,
		path,
	]);
	return allowed ? <AppRouter rootRedirectTarget={dashboardPath} /> : null;
}
