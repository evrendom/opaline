import type { HistoricalSkillSummary } from "@rudel/api-routes";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ShellHeaderPortalContext } from "@/features/shell/shell-header-portal";
import { SkillsPageView } from "@/features/skills/components/SkillsPageView";

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

function SkillsPageViewHarness(props: ComponentProps<typeof SkillsPageView>) {
	const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);

	return (
		<>
			<div data-testid="skills-shell-header" ref={setPortalHost} />
			<ShellHeaderPortalContext.Provider value={portalHost}>
				<SkillsPageView {...props} />
			</ShellHeaderPortalContext.Provider>
		</>
	);
}

describe("SkillsPageView", () => {
	it("renders exact names, usage counts, and opens a selected skill", async () => {
		const user = userEvent.setup();
		const onSelectSkill = vi.fn();

		render(
			<SkillsPageViewHarness
				skills={skills}
				isError={false}
				isPending={false}
				onRetry={vi.fn()}
				onSelectSkill={onSelectSkill}
			/>,
		);

		expect(screen.queryByText("All Skills")).not.toBeInTheDocument();
		expect(
			within(screen.getByTestId("skills-shell-header")).getByRole("searchbox", {
				name: "Search skills",
			}),
		).toBeInTheDocument();
		expect(screen.getByText("testing-bun")).toBeInTheDocument();
		expect(screen.getByTitle("12 sessions")).toHaveTextContent("12 sessions");
		expect(screen.getByTitle("1 session")).toHaveTextContent("1 session");
		expect(
			screen.getByTitle("Used by Ada Lovelace in 7 sessions"),
		).toBeInTheDocument();
		expect(
			screen.getByTitle("Repository rudel, 8 sessions"),
		).toBeInTheDocument();
		expect(screen.getByRole("group", { name: "2 users" })).toBeInTheDocument();
		const users = screen.getByRole("group", { name: "4 users" });
		expect(within(users).getByText("+1")).toBeInTheDocument();
		expect(
			within(users).getByTitle("Used by Grace Hopper in 3 sessions"),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "Testing with Bun" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText("Run focused tests first."),
		).not.toBeInTheDocument();
		expect(
			screen.getByText(
				"a-very-long-skill-name-that-needs-to-wrap-without-breaking-the-row-layout",
			),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /testing-bun/i }));
		expect(onSelectSkill).toHaveBeenCalledWith("testing-bun");
	});

	it("filters names without changing their original case", async () => {
		const user = userEvent.setup();

		render(
			<SkillsPageViewHarness
				skills={skills}
				isError={false}
				isPending={false}
				onRetry={vi.fn()}
				onSelectSkill={vi.fn()}
			/>,
		);

		await user.type(
			screen.getByRole("searchbox", { name: "Search skills" }),
			"DES",
		);

		expect(screen.getByText("Design")).toBeInTheDocument();
		expect(screen.queryByText("testing-bun")).not.toBeInTheDocument();
	});

	it("supports filtered-empty and clear-search states", async () => {
		const user = userEvent.setup();

		render(
			<SkillsPageViewHarness
				skills={skills}
				isError={false}
				isPending={false}
				onRetry={vi.fn()}
				onSelectSkill={vi.fn()}
			/>,
		);

		const search = screen.getByRole("searchbox", { name: "Search skills" });
		await user.type(search, "not-present");
		expect(screen.getByText("No matching skills")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Clear search" }));
		expect(search).toHaveValue("");
		expect(screen.getByText("testing-bun")).toBeInTheDocument();
	});

	it("renders loading, API-error, and no-skills states", async () => {
		const onRetry = vi.fn();
		const { rerender } = render(
			<SkillsPageViewHarness
				skills={undefined}
				isError={false}
				isPending
				onRetry={onRetry}
				onSelectSkill={vi.fn()}
			/>,
		);

		expect(screen.getByText("Loading skills")).toBeInTheDocument();

		rerender(
			<SkillsPageViewHarness
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
			<SkillsPageViewHarness
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
