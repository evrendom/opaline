import type { HistoricalSkillSummary } from "@rudel/api-routes";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { assert, describe, expect, it, vi } from "vitest";
import { SkillsPageView } from "@/features/skills/components/SkillsPageView";

vi.stubGlobal("PointerEvent", MouseEvent);

vi.mock("@/features/workspace/hooks/useUserMap", () => ({
	useUserMap: () => ({
		avatarMap: {},
		isLoading: false,
		userMap: {
			"user-1": "Ada Lovelace",
			"user-2": "Grace Hopper",
			"user-3": "Linus Torvalds",
		},
	}),
}));

const skills: HistoricalSkillSummary[] = [
	{
		name: "testing-bun",
		sessionCount: 12,
		claudeSessionCount: 7,
		codexSessionCount: 5,
		contentPreview:
			"---\nname: testing-bun\ndescription: Test Bun code.\n---\n\n# Testing with Bun\n\nRun focused tests first.",
		attribution: {
			userCount: 4,
			topUsers: [
				{ userId: "user-1", sessionCount: 7 },
				{ userId: "user-2", sessionCount: 3 },
				{ userId: "user-3", sessionCount: 2 },
			],
			repoCount: 4,
			topRepos: [
				{
					repoKey: "remote:github.com/rudel/rudel",
					repoLabel: "rudel",
					sessionCount: 8,
				},
				{
					repoKey: "remote:github.com/rudel/api",
					repoLabel: "api",
					sessionCount: 3,
				},
				{ repoKey: "path-raw:", repoLabel: "No repository", sessionCount: 1 },
			],
		},
	},
	{
		name: "Design",
		sessionCount: 3,
		claudeSessionCount: 3,
		codexSessionCount: 0,
		contentPreview:
			"# Design systems\n\nBuild interfaces with clear hierarchy.",
		attribution: {
			userCount: 2,
			topUsers: [
				{ userId: "unknown-1", sessionCount: 2 },
				{ userId: "unknown-2", sessionCount: 1 },
			],
			repoCount: 1,
			topRepos: [
				{ repoKey: "pkg:@rudel/web", repoLabel: "web", sessionCount: 3 },
			],
		},
	},
	{
		name: "a-very-long-skill-name-that-needs-to-wrap-without-breaking-the-row-layout",
		sessionCount: 1,
		claudeSessionCount: 0,
		codexSessionCount: 1,
		contentPreview: null,
	},
];

function renderView(props: Partial<ComponentProps<typeof SkillsPageView>>) {
	return render(
		<SkillsPageView
			skills={skills}
			isError={false}
			isPending={false}
			onRetry={vi.fn()}
			onSelectSkill={vi.fn()}
			{...props}
		/>,
	);
}

describe("SkillsPageView", () => {
	it("lists skills as rows with their usage and opens a selected skill", async () => {
		const user = userEvent.setup();
		const onSelectSkill = vi.fn();
		renderView({ onSelectSkill });

		const list = screen.getByRole("list", { name: "Skills" });
		const rows = within(list).getAllByRole("button", { name: /^Open / });
		// Most-used first.
		expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
			"Open testing-bun",
			"Open Design",
			"Open a-very-long-skill-name-that-needs-to-wrap-without-breaking-the-row-layout",
		]);
		const testingBun = rows[0];
		assert(testingBun);
		expect(testingBun).toHaveTextContent("12 sessions");
		expect(testingBun).toHaveTextContent("4 repos");
		expect(testingBun).toHaveTextContent(
			"Ada Lovelace, Grace Hopper, Linus Torvalds +1",
		);
		// No member column and no agent tags.
		expect(testingBun).not.toHaveTextContent("4 members");
		expect(testingBun).not.toHaveTextContent("Claude");
		expect(testingBun).not.toHaveTextContent("Codex");
		// Names unknown to this workspace fall back to a count.
		expect(rows[1]).toHaveTextContent("2 members");
		expect(
			screen.queryByText("Run focused tests first."),
		).not.toBeInTheDocument();
		// No column headers.
		expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();

		await user.click(testingBun);
		expect(onSelectSkill).toHaveBeenCalledWith("testing-bun");
	});

	it("filters names without changing their original case", async () => {
		const user = userEvent.setup();
		renderView({});

		await user.type(
			screen.getByRole("textbox", { name: "Search skills" }),
			"DES",
		);

		expect(screen.getByText("Design")).toBeInTheDocument();
		expect(screen.queryByText("testing-bun")).not.toBeInTheDocument();
	});

	it("sorts by name from the sort menu", async () => {
		const user = userEvent.setup();
		renderView({});

		await user.click(
			screen.getByRole("button", { name: "Sort skills, Sessions, descending" }),
		);
		await user.click(
			await screen.findByRole("menuitemradio", { name: "Name" }),
		);

		const rows = within(
			screen.getByRole("list", { name: "Skills" }),
		).getAllByRole("button", { name: /^Open / });
		expect(rows[0]).toHaveAccessibleName(
			"Open a-very-long-skill-name-that-needs-to-wrap-without-breaking-the-row-layout",
		);
		expect(rows[1]).toHaveAccessibleName("Open Design");
	});

	it("supports filtered-empty and clear-search states", async () => {
		const user = userEvent.setup();
		renderView({});

		const search = screen.getByRole("textbox", { name: "Search skills" });
		await user.type(search, "not-present");
		expect(screen.getByText("No matching skills")).toBeInTheDocument();

		const clearButtons = screen.getAllByRole("button", {
			name: "Clear search",
		});
		const emptyStateClear = clearButtons.at(-1);
		assert(emptyStateClear);
		await user.click(emptyStateClear);
		expect(search).toHaveValue("");
		expect(screen.getByText("testing-bun")).toBeInTheDocument();
	});

	it("renders loading, API-error, and no-skills states", async () => {
		const onRetry = vi.fn();
		const { rerender } = render(
			<SkillsPageView
				skills={undefined}
				isError={false}
				isPending
				onRetry={onRetry}
				onSelectSkill={vi.fn()}
			/>,
		);

		expect(screen.getByText("Loading skills")).toBeInTheDocument();

		rerender(
			<SkillsPageView
				skills={undefined}
				isError
				isPending={false}
				onRetry={onRetry}
				onSelectSkill={vi.fn()}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalledTimes(1);

		rerender(
			<SkillsPageView
				skills={[]}
				isError={false}
				isPending={false}
				onRetry={onRetry}
				onSelectSkill={vi.fn()}
			/>,
		);
		expect(screen.getByText("No skills yet")).toBeInTheDocument();
	});
});
