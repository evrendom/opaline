import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import type { Organization } from "@/features/workspace/organization/types";
import { queryClient } from "@/lib/query-client";
import { sessionDetailInitialQueryOptions } from "./components/session-detail-fast-query";
import { prefetchSessionDetail } from "./session-detail-prefetch";
import { usePrefetchFileChanges } from "./use-prefetch-file-changes";
import { useSessionFileChanges } from "./use-session-file-changes";

function workspace({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>
			<WorkspaceStateProvider
				value={{
					state: {
						activeOrg: { id: "org-1" } as Organization,
						organizations: [],
						isLoading: false,
					},
					actions: { switchOrganization: async () => {} },
					meta: { isOrgAdmin: false, readsEverySession: true },
				}}
			>
				{children}
			</WorkspaceStateProvider>
		</QueryClientProvider>
	);
}

function prefetchedOptions() {
	const prefetch = vi.mocked(queryClient.prefetchQuery);
	expect(prefetch).toHaveBeenCalledTimes(1);
	return prefetch.mock.calls[0]?.[0];
}

beforeEach(() => {
	queryClient.clear();
	vi.spyOn(queryClient, "prefetchQuery").mockResolvedValue(undefined);
	vi.spyOn(globalThis, "fetch").mockImplementation(
		() => new Promise<Response>(() => {}),
	);
	vi.stubGlobal("requestIdleCallback", (run: () => void) => {
		run();
		return 0;
	});
	vi.stubGlobal("cancelIdleCallback", () => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	queryClient.clear();
});

describe("what a row's hover prefetches is what the reader reads", () => {
	test("a session's detail: the reader's key, retry and freshness", () => {
		prefetchSessionDetail("s-1");
		const prefetched = prefetchedOptions();
		const read = sessionDetailInitialQueryOptions("s-1");
		expect(prefetched?.queryKey).toEqual(read.queryKey);
		expect(prefetched?.staleTime).toBe(read.staleTime);
		expect(prefetched?.retry).toBe(read.retry);
	});

	test("a session's file changes: the reader's key, retry and freshness", async () => {
		renderHook(() => usePrefetchFileChanges("s-1", "rev-1"), {
			wrapper: workspace,
		});
		const prefetched = prefetchedOptions();
		renderHook(() => useSessionFileChanges("s-1", "rev-1"), {
			wrapper: workspace,
		});
		await waitFor(() =>
			expect(queryClient.getQueryCache().getAll()).toHaveLength(1),
		);
		const [read] = queryClient.getQueryCache().getAll();
		expect(prefetched?.queryKey).toEqual(read?.queryKey);
		expect(read?.observers[0]?.options.staleTime).toBe(prefetched?.staleTime);
		expect(read?.observers[0]?.options.retry).toBe(prefetched?.retry);
	});
});
