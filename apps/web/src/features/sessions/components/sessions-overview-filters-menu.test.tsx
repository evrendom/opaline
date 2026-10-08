import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionsOverviewFiltersMenu } from "./sessions-overview-filters-menu";
import type { SessionOverviewRangeFilterValues } from "./sessions-overview-table-utils";

const emptyRange = { maximum: null, minimum: null };
const rangeBounds = {
	cost: { maximum: 100, minimum: 0, step: 1 },
	duration: { maximum: 120, minimum: 0, step: 1 },
	errors: { maximum: 10, minimum: 0, step: 1 },
	input: { maximum: 100_000, minimum: 0, step: 100 },
	output: { maximum: 10_000, minimum: 0, step: 100 },
	subagents: { maximum: 20, minimum: 0, step: 1 },
};
const emptyRangeFilterValues: SessionOverviewRangeFilterValues = {
	cost: emptyRange,
	duration: emptyRange,
	errors: emptyRange,
	input: emptyRange,
	output: emptyRange,
	subagents: emptyRange,
};

describe("SessionsOverviewFiltersMenu linear variant", () => {
	it("shows the filter categories without a category search", async () => {
		const user = userEvent.setup();
		renderLinearFilters();

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));

		const dialog = screen.getByRole("dialog");
		expect(dialog).toBeVisible();
		expect(dialog).toHaveFocus();

		expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Configure Repository filter" }),
		).toBeVisible();

		expect(
			screen.getByRole("button", { name: "Configure Cost filter" }),
		).toBeVisible();
	});

	it("opens option settings in a second side menu on hover", async () => {
		const user = userEvent.setup();
		const onFilterOptionChecked = vi.fn();
		renderLinearFilters({ onFilterOptionChecked });

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		const repository = screen.getByRole("button", {
			name: "Configure Repository filter",
		});
		await user.hover(
			screen.getByRole("button", { name: "Configure Model filter" }),
		);

		expect(repository).toBeVisible();
		expect(screen.getByRole("dialog", { name: "Model filter" })).toBeVisible();
		expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
		await user.click(screen.getByText("gpt-5.6-sol"));

		expect(onFilterOptionChecked).toHaveBeenCalledWith(
			"model",
			"gpt-5.6-sol",
			false,
		);
	});

	it("combines input and output token ranges in one Tokens setting", async () => {
		const user = userEvent.setup();
		const onRangeFilterChange = vi.fn();
		renderLinearFilters({ onRangeFilterChange });

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		expect(
			screen.queryByRole("button", { name: "Configure Input filter" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Configure Output filter" }),
		).not.toBeInTheDocument();

		await user.hover(
			screen.getByRole("button", { name: "Configure Tokens filter" }),
		);

		const dialog = screen.getByRole("dialog", { name: "Tokens filter" });
		expect(
			within(dialog).getByRole("slider", { name: "Minimum Input tokens" }),
		).toBeVisible();
		expect(
			within(dialog).getByRole("slider", { name: "Maximum Output tokens" }),
		).toBeVisible();

		fireEvent.change(
			within(dialog).getByRole("slider", { name: "Minimum Input tokens" }),
			{ target: { value: "1000" } },
		);
		expect(onRangeFilterChange).toHaveBeenCalledWith("input", {
			maximum: null,
			minimum: 1000,
		});
	});

	it("exposes a working Subagent types range setting", async () => {
		const user = userEvent.setup();
		const onRangeFilterChange = vi.fn();
		renderLinearFilters({ onRangeFilterChange });

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		await user.hover(
			screen.getByRole("button", {
				name: "Configure Subagent types filter",
			}),
		);

		const dialog = screen.getByRole("dialog", {
			name: "Subagent types filter",
		});
		const minimum = within(dialog).getByRole("slider", {
			name: "Minimum Subagent types",
		});
		fireEvent.change(minimum, { target: { value: "2" } });

		expect(onRangeFilterChange).toHaveBeenCalledWith("subagents", {
			maximum: null,
			minimum: 2,
		});
	});

	it("shows active settings in the menu from a click-only status button", async () => {
		const user = userEvent.setup();
		renderLinearFilters({
			rangeFilterValues: {
				...emptyRangeFilterValues,
				input: { maximum: 50_000, minimum: 1_000 },
				output: { maximum: 5_000, minimum: 500 },
			},
		});

		const statusButton = screen.getByRole("button", {
			name: "Review 1 active session filter",
		});
		await user.hover(statusButton);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

		await user.click(statusButton);

		expect(screen.getByRole("dialog")).toBeVisible();
		const tokensRow = screen.getByRole("button", {
			name: "Configure Tokens filter",
		});
		expect(tokensRow).toHaveAttribute("title", "In 1K–50K · Out 500–5K");
		expect(tokensRow.querySelector(".session-menu-active-dot")).not.toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Configure Model filter" })
				.querySelector(".session-menu-active-dot"),
		).toBeNull();
	});

	it("gives the pointer a grace delay around the side menu", async () => {
		const user = userEvent.setup();
		renderLinearFilters();

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		const rootDialog = screen.getByRole("dialog");
		await user.hover(
			screen.getByRole("button", { name: "Configure Model filter" }),
		);

		const modelDialog = screen.getByRole("dialog", { name: "Model filter" });
		fireEvent.mouseLeave(rootDialog, { buttons: 0 });
		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(modelDialog).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 125));
		expect(
			screen.queryByRole("dialog", { name: "Model filter" }),
		).not.toBeInTheDocument();
	});

	it("contains wheel gestures inside the compound menu", async () => {
		const user = userEvent.setup();
		renderLinearFilters();

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		await user.hover(
			screen.getByRole("button", { name: "Configure Model filter" }),
		);

		const option = screen.getByText("gpt-5.6-sol");
		const wheelEvent = new WheelEvent("wheel", {
			bubbles: true,
			cancelable: true,
			deltaY: 48,
		});
		option.dispatchEvent(wheelEvent);

		expect(wheelEvent.defaultPrevented).toBe(true);
	});

	it("keeps a rubber range flyout visible while a drag overshoots it", async () => {
		const user = userEvent.setup();
		renderLinearFilters();

		await user.click(screen.getByRole("button", { name: "Filter sessions" }));
		const rootDialog = screen.getByRole("dialog");
		await user.hover(
			screen.getByRole("button", { name: "Configure Errors filter" }),
		);

		const rangeDialog = screen.getByRole("dialog", { name: "Errors filter" });
		const handles = rangeDialog.querySelectorAll(".slider-range-input-handle");
		expect(handles).toHaveLength(2);
		for (const handle of handles) {
			expect(handle).toHaveStyle({ opacity: "0.5" });
		}

		const minimum = screen.getByRole("slider", { name: "Minimum Errors" });
		fireEvent.change(minimum, { target: { value: "1" } });
		fireEvent.mouseLeave(rootDialog, { buttons: 0 });
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(rangeDialog).toBeVisible();
		fireEvent.keyUp(minimum, { key: "ArrowRight" });
	});

	it("closes on the first click after a range interaction loses focus", async () => {
		const user = userEvent.setup();
		renderLinearFilters();

		const trigger = screen.getByRole("button", { name: "Filter sessions" });
		await user.click(trigger);
		await user.hover(
			screen.getByRole("button", { name: "Configure Errors filter" }),
		);

		const minimum = screen.getByRole("slider", { name: "Minimum Errors" });
		fireEvent.change(minimum, { target: { value: "1" } });
		fireEvent.blur(minimum);
		fireEvent.click(trigger);

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});

function renderLinearFilters({
	onFilterOptionChecked = vi.fn(),
	onRangeFilterChange = vi.fn(),
	rangeFilterValues = emptyRangeFilterValues,
}: {
	onFilterOptionChecked?: ReturnType<typeof vi.fn>;
	onRangeFilterChange?: ReturnType<typeof vi.fn>;
	rangeFilterValues?: SessionOverviewRangeFilterValues;
} = {}) {
	return render(
		<SessionsOverviewFiltersMenu
			excludedFilterValues={{
				model: new Set(),
				repository: new Set(),
				skills: new Set(),
				user: new Set(),
			}}
			filterOptions={{
				model: [{ label: "gpt-5.6-sol", value: "gpt-5.6-sol" }],
				repository: [{ label: "rudel-v2", value: "rudel-v2" }],
				skills: [{ label: "design", value: "design" }],
				user: [{ label: "Evren", value: "evren" }],
			}}
			iconOnly
			onClearAll={vi.fn()}
			onClearFilter={vi.fn()}
			onClearRangeFilter={vi.fn()}
			onFilterOptionChecked={onFilterOptionChecked}
			onRangeFilterChange={onRangeFilterChange}
			rangeFilterBounds={rangeBounds}
			rangeFilterValues={rangeFilterValues}
			variant="linear"
		/>,
	);
}
