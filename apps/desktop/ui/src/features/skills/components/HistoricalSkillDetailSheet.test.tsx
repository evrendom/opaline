import type { HistoricalSkillDetail } from "@rudel/api-routes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HistoricalSkillDetailContent } from "@/features/skills/components/historical-skill-detail-content";

const detail: HistoricalSkillDetail = {
	name: "testing-bun",
	sessionCount: 5,
	claudeSessionCount: 3,
	codexSessionCount: 2,
	sourceAgents: ["claude", "codex"],
	unavailableSessionCount: 1,
	versions: [
		{
			sourceAgent: "claude",
			contentSha256: "a".repeat(64),
			content:
				"---\nname: testing-bun\ndescription: Test Bun code.\n---\n\n# New version\n\n- Uses Bun\n",
			sessionCount: 3,
			firstUsedAt: "2026-02-01T00:00:00Z",
			lastUsedAt: "2026-03-01T00:00:00Z",
		},
		{
			sourceAgent: "codex",
			contentSha256: "b".repeat(64),
			content: "# Old version\n\nEarlier guidance.\n",
			sessionCount: 2,
			firstUsedAt: "2026-01-01T00:00:00Z",
			lastUsedAt: "2026-01-31T00:00:00Z",
		},
	],
};

describe("HistoricalSkillDetailContent", () => {
	it("renders Markdown without usage summaries or recovery notices", () => {
		render(
			<HistoricalSkillDetailContent
				detail={detail}
				isError={false}
				isPending={false}
				previewContent={null}
				onRetry={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "New version" }),
		).toBeInTheDocument();
		expect(screen.getByText("Uses Bun")).toBeInTheDocument();
		expect(screen.queryByText("name: testing-bun")).not.toBeInTheDocument();
		expect(
			screen.queryByText(/couldn’t be recovered from 1 session/i),
		).not.toBeInTheDocument();
		expect(screen.queryByText("Used in 5 sessions")).not.toBeInTheDocument();
	});

	it("switches between distinct recovered versions", async () => {
		const user = userEvent.setup();

		render(
			<HistoricalSkillDetailContent
				detail={detail}
				isError={false}
				isPending={false}
				previewContent={null}
				onRetry={vi.fn()}
			/>,
		);

		screen.getByRole("button", { name: "Skill version, Version 2" }).focus();
		await user.keyboard("{ArrowDown}");
		await user.click(
			await screen.findByRole("menuitemradio", { name: "Version 1" }),
		);

		expect(
			screen.getByRole("heading", { name: "Old version" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "New version" }),
		).not.toBeInTheDocument();
	});

	it("renders loading, error, and fully unavailable states", async () => {
		const onRetry = vi.fn();
		const { rerender } = render(
			<HistoricalSkillDetailContent
				detail={undefined}
				isError={false}
				isPending
				previewContent={"# Immediate preview\n\nLoading the rest."}
				onRetry={onRetry}
			/>,
		);

		expect(screen.getByText("Loading skill details")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Immediate preview" }),
		).toBeInTheDocument();

		rerender(
			<HistoricalSkillDetailContent
				detail={undefined}
				isError
				isPending={false}
				previewContent={null}
				onRetry={onRetry}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalledTimes(1);

		rerender(
			<HistoricalSkillDetailContent
				detail={{
					name: "testing-bun",
					sessionCount: 2,
					claudeSessionCount: 0,
					codexSessionCount: 2,
					sourceAgents: ["codex"],
					unavailableSessionCount: 2,
					versions: [],
				}}
				isError={false}
				isPending={false}
				previewContent={null}
				onRetry={onRetry}
			/>,
		);
		expect(
			screen.getByText("No complete content was recovered"),
		).toBeInTheDocument();
	});
});
