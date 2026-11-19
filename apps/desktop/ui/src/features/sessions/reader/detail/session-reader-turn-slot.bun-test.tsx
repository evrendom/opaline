import { describe, expect, test } from "bun:test";
import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { estimateTurnPx } from "./reader-turns-pending";
import { ReaderTurnSlot, TurnsPending } from "./session-reader-turn-slot";

const turn = {
	errorCount: 2,
	modelApologyCount: null,
	modelSignalCount: 1,
	startedAt: "2026-10-29T10:00:00.000Z",
	toolCallCount: 3,
	turnId: "t1",
} as unknown as SessionDetailTurnSummary;

const slot = (props: Partial<Parameters<typeof ReaderTurnSlot>[0]>) =>
	renderToStaticMarkup(
		<ReaderTurnSlot
			frustrated={false}
			hidden={false}
			holdsEstimate={false}
			index={4}
			keptHeight={undefined}
			slotRef={() => () => {}}
			turn={turn}
			{...props}
		>
			<p>body</p>
		</ReaderTurnSlot>,
	);

describe("a turn's slot", () => {
	test("its marks: id, place, failed calls, an apology, when it began", () => {
		const html = slot({ frustrated: true });
		expect(html).toContain('data-turn-id="t1"');
		expect(html).toContain('data-turn-index="4"');
		expect(html).toContain('data-turn-errors=""');
		expect(html).toContain('data-turn-apology=""');
		expect(html).toContain('data-turn-frustrated=""');
		expect(html).toContain(
			`data-turn-start-ms="${Date.parse("2026-10-29T10:00:00.000Z")}"`,
		);
	});

	test("its height: kept from the last visit, else estimated", () => {
		expect(slot({ keptHeight: 321 })).toContain(
			"--turn-estimate:321px;--turn-kept:calc(321px + var(--reader-inset))",
		);
		const estimated = slot({});
		expect(estimated).toContain(`--turn-estimate:${estimateTurnPx(turn)}px`);
		expect(estimated).not.toContain("--turn-kept:");
		expect(estimated).not.toContain("min-height");
		expect(slot({ holdsEstimate: true })).toContain(
			"min-height:calc(var(--turn-estimate) + var(--reader-inset))",
		);
	});

	test("hidden, its block kept", () => {
		const html = slot({ hidden: true });
		expect(html).toContain("hidden");
		expect(html).toContain("<p>body</p>");
	});
});

describe("the turns still to load", () => {
	test("blank while loading, or failed with a retry, in the room held for them", () => {
		const loading = renderToStaticMarkup(
			<TurnsPending
				failed={false}
				from={41}
				minHeight={900}
				onRetry={() => {}}
				to={120}
			/>,
		).replace(/<!-- -->/gu, "");
		expect(loading).toContain('data-turns-pending=""');
		expect(loading).toContain("min-height:900px");
		expect(loading).not.toContain("<p");
		const failed = renderToStaticMarkup(
			<TurnsPending
				failed
				from={41}
				minHeight={900}
				onRetry={() => {}}
				to={120}
			/>,
		).replace(/<!-- -->/gu, "");
		expect(failed).toContain("Turns 41–120 could not be loaded.");
		expect(failed).toContain(">Retry</button>");
	});
});
