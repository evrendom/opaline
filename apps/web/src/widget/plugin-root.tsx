import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AppRouter } from "@/app/AppRouter";
import { getCanonicalAppPath } from "@/app/routes";
import { embeddedConversationTraceMaskStyle } from "@/components/conversation/conversation-trace-mask";
import {
	DateRangeProvider,
	useDateRange,
} from "@/features/analytics/date-range/DateRangeProvider";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { orpc } from "@/lib/orpc";
import {
	getWidgetState,
	type HostState,
	openPluginLink,
	type PluginSeed,
	requestHost,
	setWidgetState,
} from "./host-bridge";
import "../index.css";

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
		client.setQueryData(
			[
				"org",
				seed.bootstrap.organization.id,
				...orpc.analytics.overview.costs.queryOptions({
					input: seed.dashboard.input,
				}).queryKey,
			],
			seed.dashboard.data,
		);
		client.setQueryData(
			["full-organization", seed.bootstrap.organization.id],
			seed.bootstrap.organization,
		);
		return client;
	});
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
		<ThemeProvider
			attribute="class"
			forcedTheme={host.theme === "dark" ? "dark" : "light"}
		>
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
								members: organization.members,
								isLoading: false,
							},
							meta: {
								isOrgAdmin: ["owner", "admin"].includes(
									seed.bootstrap.member?.role ?? "",
								),
							},
							actions: {
								switchOrganization: async () => {
									openPluginLink("/");
								},
							},
						}}
					>
						<DateRangeProvider>
							<PluginRouter host={host} dashboardPath={dashboardPath} />
						</DateRangeProvider>
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
