import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { splitHealthBlock } from "./health-block";
import { ReportPage } from "./ReportPage";
import { REPORT_FIXTURE } from "./report-fixture";

interface ReportApi {
	calls: { analysis: string }[];
	answer: () => Promise<unknown>;
}

const api = vi.hoisted<ReportApi>(() => ({
	calls: [],
	answer: () => Promise.resolve(null),
}));

vi.mock("@/lib/orpc", () => ({
	orpc: {
		analysis: {
			history: {
				report: {
					queryOptions: ({ input }: { input: { analysis: string } }) => ({
						queryKey: ["report", input.analysis],
						queryFn: () => {
							api.calls.push(input);
							return api.answer();
						},
					}),
				},
			},
		},
	},
}));

vi.mock("@/features/workspace/hooks/useUserMap", () => ({
	useUserMap: () => ({
		avatarMap: {},
		isLoading: false,
		userMap: { "user-1": "Ada Lovelace" },
	}),
}));

function renderAt(path: string) {
	const queryClient = new QueryClient();
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route
						path="/:workspaceSlug/reports/:analysisId"
						element={<ReportPage />}
					/>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("ReportPage", () => {
	beforeEach(() => {
		api.calls = [];
	});

	it("shows a saved analysis as a report: answer, health, findings with their runs, and stored results", async () => {
		api.answer = async () => REPORT_FIXTURE;
		renderAt("/acme/reports/a_fixture");

		expect(
			await screen.findByRole("heading", {
				level: 1,
				name: "Where our agents spend time",
			}),
		).toBeInTheDocument();
		expect(api.calls).toEqual([{ analysis: "a_fixture" }]);
		expect(
			screen.getByText("Saved Nov 1, 2026 by Ada Lovelace"),
		).toBeInTheDocument();
		expect(
			screen.getByText("Data 2026-10-01 to 2026-10-31"),
		).toBeInTheDocument();
		expect(screen.getByText("Not shared")).toBeInTheDocument();
		expect(screen.getByText("long test runs").tagName).toBe("STRONG");
		expect(screen.queryByText(/"type":"Summary"/)).not.toBeInTheDocument();

		const health = screen.getByRole("region", { name: "Health" });
		expect(
			within(health).getByText("Tests are slow and agents skip them."),
		).toBeInTheDocument();
		const actions = within(health).getAllByRole("row").slice(1, 3);
		expect(actions.map((row) => row.textContent)).toEqual([
			"Cache the database fixtureEvery run rebuilds it for four minutes.highhour",
			"Document the focused test commandAgents run the whole suite to check one file.mediumminutes",
		]);
		expect(
			within(health).getByText("Tests run before done"),
		).toBeInTheDocument();
		expect(within(health).getByText("warn")).toBeInTheDocument();

		const findings = screen.getByRole("region", { name: "Findings" });
		expect(
			within(findings).getByText("Test runs are the longest."),
		).toBeInTheDocument();
		expect(
			within(findings).getByRole("link", { name: "3f2a9c1d turn 3" }),
		).toHaveAttribute("href", "/acme/sessions/3f2a9c1d-session");

		const steps = screen.getByRole("region", { name: "Steps" });
		expect(within(steps).getByText("Longest runs")).toBeInTheDocument();
		expect(within(steps).getByText("41.5")).toBeInTheDocument();
		expect(within(steps).getByText("q_read (expired)")).toBeInTheDocument();
	});

	it("says so when the analysis is shared with the workspace", async () => {
		api.answer = async () => ({ ...REPORT_FIXTURE, shared: true });
		renderAt("/acme/reports/a_fixture");
		expect(
			await screen.findByText("Shared with workspace"),
		).toBeInTheDocument();
	});

	it("shows not found for an analysis the viewer cannot see", async () => {
		api.answer = async () => {
			throw Object.assign(new Error("No saved analysis"), {
				code: "NOT_FOUND",
			});
		};
		renderAt("/acme/reports/a_missing");
		expect(await screen.findByText("Report not found")).toBeInTheDocument();
		expect(api.calls).toHaveLength(1);
	});
});

describe("splitHealthBlock", () => {
	it("leaves an answer without the block untouched and skips lines that are not JSON", () => {
		expect(splitHealthBlock("Plain answer.")).toEqual({
			markdown: "Plain answer.",
			health: null,
		});
		expect(
			splitHealthBlock(
				'Before\n```opaline-health\nnot json\n{"type":"Summary","headline":"H"}\n```\nAfter',
			),
		).toEqual({
			markdown: "Before\n\nAfter",
			health: { summary: "H", actions: [], signals: [] },
		});
	});
});
