import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { TooltipProvider } from "@/app/ui/tooltip";
import { DateRangeProvider } from "@/features/analytics/date-range/DateRangeProvider";
import {
	createDemoQueryClient,
	demoSeedQueries,
} from "@/features/demo/demo-root";
import { DemoSeedSchema } from "@/features/demo/demo-runtime";
import seedJson from "@/features/demo/seed.json";
// The shell's global styles, as AppShellLayout loads them for every screen;
// the page root carries `dashboard-01-theme`, the shell's variable scope.
import "@/app/app-surface.css";
import "@/features/dashboard/dashboard-theme.css";
import "@/features/shell/product-window-chrome.css";
import "@/features/shell/app-shell.css";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import portraitA from "../../../../demo-public/demo-avatars/fOsrHjK6ZflgAMB0zvQqrDiH8MSao4cB.jpg";
import portraitB from "../../../../demo-public/demo-avatars/JvNG2QdiIKjb8MBDE6gFb56c4pSCHbEX.jpg";
import portraitC from "../../../../demo-public/demo-avatars/UaR49qBKWaEm895jKnE3PRaagPuAMNoX.jpg";

/** The product demo's seed: the same sessions, repositories and dashboard
 *  answers the demo renders, so specimens get the shapes the screens pass. */
export const seed = DemoSeedSchema.parse(seedJson);

/** The demo workspace's member portraits (the seed's own viewer has none),
 *  for avatars that show a photo in the app. */
export const demoPortraits = [portraitA, portraitB, portraitC] as const;

/**
 * What the app's screens sit inside: a query cache already holding the demo
 * answers, the workspace, the date range and the tooltip provider. A real
 * component reads its data from here as it does in the app.
 */
export function ShowcaseProviders({ children }: { children: ReactNode }) {
	const [client] = useState(() => {
		const client = createDemoQueryClient();
		for (const [queryKey, data] of demoSeedQueries(seed))
			client.setQueryData(queryKey, data, { updatedAt: Date.now() });
		return client;
	});
	return (
		<QueryClientProvider client={client}>
			<WorkspaceStateProvider
				value={{
					state: {
						activeOrg: seed.organization,
						organizations: [seed.organization],
						isLoading: false,
					},
					meta: { isOrgAdmin: true, readsEverySession: true },
					actions: { switchOrganization: async () => {} },
				}}
			>
				<DateRangeProvider storageKey="showcaseDateRange">
					<TooltipProvider>{children}</TooltipProvider>
				</DateRangeProvider>
			</WorkspaceStateProvider>
		</QueryClientProvider>
	);
}
