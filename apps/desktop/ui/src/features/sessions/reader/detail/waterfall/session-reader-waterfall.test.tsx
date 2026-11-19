import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionReaderStep } from "../../model/session-reader-model";
import { SessionReaderWaterfallView } from "./session-reader-waterfall";

function step(
	id: string,
	name: string,
	startMs: number,
	durationMs: number,
	overrides: Partial<SessionReaderStep> = {},
): SessionReaderStep {
	return {
		children: [],
		detail: null,
		endMs: startMs + durationMs,
		icon: null,
		id,
		isError: false,
		kind: "tool",
		nativeId: null,
		name,
		result: "ok",
		startMs,
		text: null,
		toolEvent: null,
		...overrides,
	};
}

const steps = [
	...["a", "b", "c", "d", "e"].map((id, i) =>
		step(id, i % 2 ? "Read" : "Grep", i * 10, 10),
	),
	step("long", "Bash", 50, 400),
	...["f", "g", "h", "i"].map((id, i) =>
		step(id, i % 2 ? "Read" : "Edit", 450 + i * 10, 10),
	),
	step("err", "Bash", 490, 10, { isError: true }),
	step("j", "Read", 500, 5),
	step("k", "Read", 505, 5),
	step("answer", "Response", 510, 490, { kind: "message", text: "Done." }),
];

const turn: Partial<SessionDetailTurnSummary> = {
	estimatedCost: null,
	inputTokens: 0,
	outputTokens: 0,
	turnId: "turn-1",
};

function renderWaterfall() {
	return render(
		<SessionReaderWaterfallView
			run={{
				filter: new Set(),
				filterOptions: [],
				marks: [],
				onToggleFilter: () => {},
				turn: turn as SessionDetailTurnSummary,
			}}
			waterfall={{
				allSteps: steps,
				endMs: 1_000,
				model: null,
				startMs: 0,
				steps,
			}}
		/>,
	);
}

describe("SessionReaderWaterfallView", () => {
	it("keeps a fold's row element as it opens and shuts, so hover stays on it", () => {
		renderWaterfall();
		const toggle = screen.getAllByRole("button", {
			name: "Show these steps",
		})[0];
		const row = toggle?.closest<HTMLElement>("[data-fold-from]");
		const wrapper = row?.parentElement?.parentElement;
		expect(row).toBeTruthy();
		expect(wrapper?.hasAttribute("data-group")).toBe(false);

		fireEvent.click(toggle as HTMLElement);
		const opened = screen.getAllByRole("button", {
			name: "Fold these steps",
		})[0];
		expect(opened?.closest("[data-fold-from]")).toBe(row);
		expect(row?.isConnected).toBe(true);
		expect(row?.parentElement?.parentElement).toBe(wrapper);
		expect(wrapper?.hasAttribute("data-group")).toBe(true);
		expect(row?.parentElement?.hasAttribute("data-frozen-row")).toBe(true);

		fireEvent.click(opened as HTMLElement);
		const shut = screen.getAllByRole("button", { name: "Show these steps" })[0];
		expect(shut?.closest("[data-fold-from]")).toBe(row);
		expect(row?.isConnected).toBe(true);
		expect(row?.parentElement?.parentElement).toBe(wrapper);
		expect(wrapper?.hasAttribute("data-group")).toBe(false);
	});
});
