import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { TeamPageMemberOverviewRow } from "@/features/team/use-team-page-data";
import { TeamMemberOverviewTable } from "./TeamMemberOverviewTable";

function buildTeamMemberRow(
	overrides: Partial<TeamPageMemberOverviewRow> = {},
): TeamPageMemberOverviewRow {
	return {
		activeDays: 14,
		activityTrend: [1, 3, 2, 5],
		cost: 42,
		displayName: "Ada Lovelace",
		email: "ada@example.com",
		favoriteModel: "claude-sonnet-4-5",
		hasActivity: true,
		imageUrl: null,
		inputTokens: 120_000,
		lastActiveDate: "2026-04-22",
		modelUsage: [
			{ model: "claude-sonnet-4-5", usageCount: 12 },
			{ model: "gpt-5.1-codex", usageCount: 4 },
		],
		outputTokens: 60_000,
		role: "Member",
		totalSessions: 120,
		totalTokens: 180_000,
		userId: "user-1",
		...overrides,
	};
}

describe("TeamMemberOverviewTable", () => {
	it("renders the requested teammate metrics in a semantic table", () => {
		render(<TeamMemberOverviewTable rows={[buildTeamMemberRow()]} />);

		expect(
			screen.getByRole("columnheader", { name: "Teammate" }),
		).toBeVisible();
		expect(
			screen.getByRole("columnheader", { name: "Model composition" }),
		).toBeVisible();
		expect(
			screen.getByRole("columnheader", { name: "Activity" }),
		).toBeVisible();
		expect(
			screen.getByRole("columnheader", { name: "Sessions" }),
		).toBeVisible();
		expect(
			screen.getByRole("columnheader", { name: "Tokens used" }),
		).toBeVisible();
		expect(
			screen.getByRole("columnheader", { name: "API cost" }),
		).toBeVisible();
		expect(
			screen.getByRole("columnheader", { name: "Last active" }),
		).toBeVisible();
		expect(screen.getByText("Ada Lovelace")).toBeVisible();
		expect(screen.getByText("AL")).toBeVisible();
		expect(screen.getByTitle("Sonnet 4.5, GPT 5.1")).toBeVisible();
		expect(
			screen.getByRole("img", {
				name: "11 sessions across 4 activity periods",
			}),
		).toBeVisible();
		expect(screen.getByText("180K")).toBeVisible();
		expect(screen.getByText("120")).toBeVisible();
		expect(screen.getByText("$42")).toBeVisible();
		// Relative on the row; the exact day on hover.
		expect(screen.getByTitle("Last active Apr 22, 2026")).toBeVisible();
	});

	it("lines its outer cells up with the settings column's 8px gutter", () => {
		render(<TeamMemberOverviewTable rows={[buildTeamMemberRow()]} />);

		const table = screen.getByRole("table");
		expect(table.parentElement).not.toHaveClass("px-16");
		expect(table).toHaveClass("[&_tr>*:first-child]:pl-2");
		expect(table).toHaveClass("[&_tr>*:last-child]:pr-2");
	});

	it("shows the top three models and collapses the remainder into a count", () => {
		render(
			<TeamMemberOverviewTable
				rows={[
					buildTeamMemberRow({
						modelUsage: [
							{ model: "fable-2", usageCount: 1 },
							{ model: "gpt-5.1-codex", usageCount: 4 },
							{ model: "claude-haiku-3-5", usageCount: 2 },
							{ model: "claude-sonnet-4-5", usageCount: 12 },
							{ model: "claude-opus-4-1", usageCount: 8 },
						],
					}),
				]}
			/>,
		);

		expect(screen.getByText("Sonnet 4.5")).toBeVisible();
		expect(screen.getByText("GPT 5.1")).toBeVisible();
		expect(screen.getByText("Opus 4.1")).toBeVisible();
		expect(screen.queryByText("Haiku 3.5")).not.toBeInTheDocument();
		expect(screen.queryByText("Fable 2")).not.toBeInTheDocument();
		expect(screen.getByText("+2")).toBeVisible();
		const modelBadges = screen
			.getByTitle("Sonnet 4.5, Opus 4.1, GPT 5.1, Haiku 3.5, Fable 2")
			.querySelectorAll(":scope > span");
		expect(modelBadges[0]).toHaveTextContent("Sonnet 4.5");
		expect(modelBadges[1]).toHaveTextContent("Opus 4.1");
		expect(modelBadges[2]).toHaveTextContent("GPT 5.1");
	});

	it("sorts teammate rows from the toolbar's sort menu", async () => {
		const user = userEvent.setup();
		render(
			<TeamMemberOverviewTable
				rows={[
					buildTeamMemberRow({
						activityTrend: [3, 8],
						cost: 42,
						totalTokens: 180_000,
					}),
					buildTeamMemberRow({
						activityTrend: [10, 10],
						cost: 90,
						displayName: "Grace Hopper",
						totalSessions: 200,
						totalTokens: 90_000,
						userId: "user-2",
					}),
				]}
			/>,
		);

		const getFirstTeammateRow = () => screen.getAllByRole("row")[1];
		const sortBy = async (option: string) => {
			await user.click(
				screen.getByRole("button", { name: /^Sort teammates, / }),
			);
			await user.click(
				await screen.findByRole("menuitemradio", { name: option }),
			);
		};

		// Tokens, most first, to start.
		expect(
			within(getFirstTeammateRow()).getByText("Ada Lovelace"),
		).toBeVisible();

		await sortBy("Activity");
		expect(
			within(getFirstTeammateRow()).getByText("Grace Hopper"),
		).toBeVisible();

		await sortBy("API cost");
		expect(
			within(getFirstTeammateRow()).getByText("Grace Hopper"),
		).toBeVisible();

		await sortBy("Ascending");
		expect(
			within(getFirstTeammateRow()).getByText("Ada Lovelace"),
		).toBeVisible();
	});

	it("narrows the roster to teammates matching the search", async () => {
		const user = userEvent.setup();
		render(
			<TeamMemberOverviewTable
				rows={[
					buildTeamMemberRow(),
					buildTeamMemberRow({ displayName: "Grace Hopper", userId: "user-2" }),
				]}
			/>,
		);

		await user.type(
			screen.getByRole("textbox", { name: "Search teammates…" }),
			"grace",
		);
		expect(screen.getByText("Grace Hopper")).toBeVisible();
		expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
	});
});
