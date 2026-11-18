import { SESSION_MCP_SERVERS_MAX_SESSIONS } from "@rudel/api-routes";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";

const MCP_SERVERS_STALE_TIME_MS = 60 * 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let start = 0; start < items.length; start += size)
		chunks.push(items.slice(start, start + size));
	return chunks;
}

export function useSessionMcpServers(
	sessionIds: readonly string[],
): ReadonlyMap<string, readonly string[]> {
	const local = useLocalDesktopApp();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const pages = useMemo(
		() => chunk([...new Set(sessionIds)], SESSION_MCP_SERVERS_MAX_SESSIONS),
		[sessionIds],
	);
	return useQueries({
		queries: pages.map((page) => {
			const options = orpc.analytics.sessions.mcpServers.queryOptions({
				input: { sessionIds: page },
			});
			return {
				...options,
				queryKey: ["org", organizationId, ...options.queryKey],
				enabled: local && !!organizationId && page.length > 0,
				retry: false,
				staleTime: MCP_SERVERS_STALE_TIME_MS,
			};
		}),
		combine: (results) => {
			const servers = new Map<string, readonly string[]>();
			for (const result of results)
				for (const [id, names] of Object.entries(result.data ?? {}))
					servers.set(id, names);
			return servers;
		},
	});
}
