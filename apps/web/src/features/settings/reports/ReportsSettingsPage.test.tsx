import type { AnalysisHistorySearchOutput } from "@rudel/api-routes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsSettingsPage } from "./ReportsSettingsPage";

type Analysis = AnalysisHistorySearchOutput["analyses"][number];

const api = vi.hoisted(() => ({
	calls: [] as { limit?: number }[],
	answer: (): Promise<unknown> => Promise.resolve({ analyses: [] }),
	tracked: [] as unknown[],
}));

vi.mock("@/lib/orpc", () => ({
	orpc: {
		analysis: {
			history: {
				search: {
					queryOptions: ({ input }: { input: { limit?: number } }) => ({
						queryKey: ["analysis-search", input],
						queryFn: () => {
							api.calls.push(input);
							return api.answer();
						},
						retry: false,
					}),
				},
			},
		},
	},
}));

vi.mock("@/features/workspace/organization/useOrganization", () => ({
	useOrganization: () => ({
		state: { activeOrg: { id: "org-acme", name: "Acme", slug: "acme" } },
	}),
}));

vi.mock("@/features/workspace/hooks/useUserMap", () => ({
	useUserMap: () => ({
		avatarMap: {},
		isLoading: false,
		userMap: { "user-2": "Ada Lovelace" },
	}),
}));

vi.mock("@/features/analytics/tracking/useTrackProductPageView", () => ({
	useTrackProductPageView: (options: unknown) => {
		api.tracked.push(options);
	},
}));

function analysis(overrides: Partial<Analysis>): Analysis {
	return {
		id: "a_default",
		question: "Default question",
		status: "finished",
		authorId: "user-1",
		mine: true,
		shared: false,
		host: "plugin",
		scope: { from: null, to: null, filters: {} },
		cutoff: "2026-11-01T12:00:00.000Z",
		createdAt: "2026-11-01T12:00:00.000Z",
		answerHead: null,
		updates: null,
		topics: [],
		match: { kind: "recent", step: null, text: null },
		...overrides,
	};
}

function renderAt(path: string) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route
						path="/:workspaceSlug/settings/reports"
						element={<ReportsSettingsPage />}
					/>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("ReportsSettingsPage", () => {
	beforeEach(() => {
		api.calls = [];
		api.tracked = [];
	});

	it("lists finished analyses newest first, each row linking to its report", async () => {
		api.answer = async () => ({
			analyses: [
				analysis({
					id: "a_old",
					question: "Where do agents stall?",
					createdAt: "2026-10-02T09:00:00.000Z",
					cutoff: "2026-10-02T09:00:00.000Z",
					scope: { from: "2026-09-01", to: "2026-09-30", filters: {} },
				}),
				analysis({
					id: "a_draft",
					question: "Unfinished question",
					status: "unfinished",
					createdAt: "2026-11-05T09:00:00.000Z",
				}),
				analysis({
					id: "a/new",
					question: "What did retries cost?",
					authorId: "user-2",
					mine: false,
					shared: true,
					createdAt: "2026-11-03T09:00:00.000Z",
					cutoff: "2026-11-03T08:00:00.000Z",
				}),
			],
		});
		renderAt("/acme/settings/reports");

		const list = await screen.findByRole("list", { name: "Saved reports" });
		const links = within(list).getAllByRole("link");
		expect(api.calls).toEqual([{ limit: 50 }]);
		expect(links).toHaveLength(2);
		expect(screen.queryByText("Unfinished question")).not.toBeInTheDocument();

		const [newest, oldest] = links;
		expect(newest).toHaveAttribute("href", "/acme/reports/a%2Fnew");
		expect(newest).toHaveTextContent("What did retries cost?");
		expect(newest).toHaveTextContent(
			"Saved Nov 3, 2026 by Ada Lovelace · Data through Nov 3, 2026",
		);
		expect(newest).toHaveTextContent("Shared with workspace");

		expect(oldest).toHaveAttribute("href", "/acme/reports/a_old");
		expect(oldest).toHaveTextContent("Where do agents stall?");
		expect(oldest).toHaveTextContent(
			"Saved Oct 2, 2026 by you · Data 2026-09-01 to 2026-09-30",
		);
		expect(oldest).toHaveTextContent("Not shared");
		expect(api.tracked.at(-1)).toMatchObject({
			isLoading: false,
			metrics: [{ id: "reports", value: 2 }],
		});
	});

	it("says how reports appear when there are none", async () => {
		api.answer = async () => ({ analyses: [] });
		renderAt("/acme/settings/reports");

		expect(
			await screen.findByText(
				"No reports yet. Reports appear here when an agent saves an analysis through the Opaline MCP.",
			),
		).toBeInTheDocument();
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});

	it("notes when the list stops at the newest 50", async () => {
		api.answer = async () => ({
			analyses: Array.from({ length: 50 }, (_, index) =>
				analysis({ id: `a_${index}`, question: `Question ${index}` }),
			),
		});
		renderAt("/acme/settings/reports");

		expect(
			await screen.findByText(/Showing the latest 50\.$/u),
		).toBeInTheDocument();
	});

	it("shows an error when the analyses cannot be loaded", async () => {
		api.answer = async () => {
			throw new Error("boom");
		};
		renderAt("/acme/settings/reports");

		expect(
			await screen.findByText("Reports couldn't be loaded right now."),
		).toBeInTheDocument();
	});
});
