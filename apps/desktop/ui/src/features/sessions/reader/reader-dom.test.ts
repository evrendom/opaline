import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { readSpans } from "./minimap/session-reader-minimap-hold";
import { measure, turnHeights } from "./minimap/session-reader-minimap-measure";
import {
	KEEPS_PICK_TARGET,
	LAID_OUT_ATTRIBUTE,
	MEASURING_ATTRIBUTE,
	markLaidOut,
	markMeasuring,
	readerContentOf,
	readerScrollerOf,
	readTurnMarks,
	TURN_ANSWER,
	TURN_SLOT_LAYOUT_CLASS,
	TURN_SLOT_LAYOUT_VARIANTS,
	TURNS_PENDING,
	turnElementOf,
	turnElementsIn,
	turnMarks,
} from "./reader-dom";
import { subagentDoneAt } from "./subagents/session-reader-subagent-done";

function placed<T extends HTMLElement>(
	element: T,
	top: number,
	height: number,
) {
	element.getBoundingClientRect = () =>
		({
			bottom: top + height,
			height,
			left: 0,
			right: 100,
			top,
			width: 100,
			x: 0,
			y: top,
			toJSON: () => ({}),
		}) as DOMRect;
	return element;
}

function readerPage() {
	document.body.innerHTML = `
		<div data-reader-scroll="">
			<div class="fade"></div>
			<div data-reader-content="">
				<div style="padding: 0px" data-turn-id="t1" data-turn-index="0" data-turn-start-ms="1000" data-turn-frustrated="">
					<div><div data-turn-answer=""></div></div>
				</div>
				<div style="padding: 0px" data-turn-id="t2" data-turn-index="1" data-turn-start-ms="5000" data-turn-errors="" data-turn-apology="">
					<div><div data-turn-answer=""></div></div>
				</div>
				<div data-turn-id="t3" data-turn-index="2" hidden=""><div></div></div>
				<div data-turns-pending=""></div>
			</div>
		</div>`;
	const scroller = document.querySelector<HTMLElement>("[data-reader-scroll]");
	if (!scroller) throw new Error("no scroller");
	placed(scroller, 0, 1000);
	const [t1, t2, t3] = [
		...document.querySelectorAll<HTMLElement>("[data-turn-id]"),
	] as [HTMLElement, HTMLElement, HTMLElement];
	placed(t1, 0, 200);
	placed(t2, 216, 300);
	placed(t3, 0, 0);
	const answers = document.querySelectorAll<HTMLElement>("[data-turn-answer]");
	placed(answers[0] as HTMLElement, 50, 150);
	placed(answers[1] as HTMLElement, 266, 250);
	placed(
		document.querySelector<HTMLElement>("[data-turns-pending]") as HTMLElement,
		532,
		400,
	);
	return { scroller, t1, t2, t3 };
}

describe("the reader page's marks", () => {
	test("its page in its scroll area, past what sits before it", () => {
		const { scroller } = readerPage();
		expect(readerContentOf(scroller)?.dataset.readerContent).toBe("");
	});

	test("the turns shown, by their ids, where they sit", () => {
		const { scroller } = readerPage();
		const spans = readSpans(scroller);
		expect(spans.ids).toBe("t1 t2");
		expect(spans.edges).toEqual([0, 200, 216, 516]);
	});

	test("each turn's flags and the room held for the rest, on the map", () => {
		const { scroller } = readerPage();
		const parts = measure(scroller, new Map());
		const summary = parts.map((part) => ({
			apologized: "apologized" in part ? part.apologized : undefined,
			frustrated: "frustrated" in part ? part.frustrated : undefined,
			height: part.height,
			kind: part.kind,
			pending: "pending" in part ? part.pending : undefined,
			top: part.top,
		}));
		expect(summary).toEqual([
			{
				apologized: undefined,
				frustrated: true,
				height: 50,
				kind: "member",
				pending: undefined,
				top: 0,
			},
			{
				apologized: undefined,
				frustrated: undefined,
				height: 150,
				kind: "agent",
				pending: undefined,
				top: 50,
			},
			{
				apologized: undefined,
				frustrated: undefined,
				height: 50,
				kind: "member",
				pending: undefined,
				top: 216,
			},
			{
				apologized: true,
				frustrated: undefined,
				height: 250,
				kind: "agent",
				pending: undefined,
				top: 266,
			},
			{
				apologized: undefined,
				frustrated: undefined,
				height: 400,
				kind: "agent",
				pending: true,
				top: 532,
			},
		]);
	});

	test("each shown turn's height, by its id", () => {
		const { scroller } = readerPage();
		expect(turnHeights(scroller)).toEqual({ t1: 200, t2: 300 });
	});

	test("a subagent done by a later turn: the first that began once it was", () => {
		const { t1, t2 } = readerPage();
		const trace = placed(document.createElement("div"), 0, 100);
		expect(subagentDoneAt(trace, 10, null, 3000, [t1, t2])).toBe(216);
		expect(subagentDoneAt(trace, 10, null, 500, [t1, t2])).toBe(0);
		expect(subagentDoneAt(trace, 10, null, 9000, [t1, t2])).toBe(516);
	});
});

describe("reader-dom", () => {
	test("a turn's marks, drawn and read back", () => {
		const element = document.createElement("div");
		for (const [name, value] of Object.entries(
			turnMarks({
				apology: true,
				errors: false,
				frustrated: true,
				index: 3,
				startMs: 1234,
				turnId: "t9",
			}),
		))
			if (value !== undefined) element.setAttribute(name, String(value));
		expect(element.outerHTML).toBe(
			'<div data-turn-apology="" data-turn-frustrated="" data-turn-id="t9" data-turn-index="3" data-turn-start-ms="1234"></div>',
		);
		expect(readTurnMarks(element)).toEqual({
			apology: true,
			errors: false,
			frustrated: true,
			index: 3,
			startMs: 1234,
			turnId: "t9",
		});
	});

	test("the scroll area, the page and the turns, found from inside", () => {
		const { scroller, t2 } = readerPage();
		expect(readerScrollerOf(t2)).toBe(scroller);
		expect(readerContentOf(scroller)).toBe(t2.parentElement);
		expect(turnElementsIn(scroller).map((each) => each.dataset.turnId)).toEqual(
			["t1", "t2", "t3"],
		);
		const inside = t2.querySelector("[data-turn-answer]") as Element;
		expect(turnElementOf(inside)).toBe(t2);
		expect(inside.matches(TURN_ANSWER)).toBe(true);
		expect(scroller.querySelector(TURNS_PENDING)).not.toBeNull();
	});

	test("what keeps the pick: a waterfall's buttons, and what's marked so", () => {
		document.body.innerHTML = `<div data-waterfall=""><button id="row"></button><span id="bar"></span></div><div data-keeps-pick=""><i id="kept"></i></div>`;
		const at = (id: string) => document.getElementById(id) as Element;
		expect(at("row").closest(KEEPS_PICK_TARGET)).not.toBeNull();
		expect(at("kept").closest(KEEPS_PICK_TARGET)).not.toBeNull();
		expect(at("bar").closest(KEEPS_PICK_TARGET)).toBeNull();
	});
});

describe("the layout marks and the classes that read them", () => {
	test("each variant reads its own attribute", () => {
		for (const [attribute, utility] of Object.entries(
			TURN_SLOT_LAYOUT_VARIANTS,
		)) {
			expect(utility).toContain(attribute);
			expect(utility.split(":")[0]?.endsWith(attribute)).toBe(true);
			expect(TURN_SLOT_LAYOUT_CLASS.split(" ")).toContain(utility);
		}
		expect(Object.keys(TURN_SLOT_LAYOUT_VARIANTS).sort()).toEqual(
			[LAID_OUT_ATTRIBUTE, MEASURING_ATTRIBUTE].sort(),
		);
	});

	test("the marks set are the attributes the variants read", () => {
		const element = document.createElement("div");
		markMeasuring(element, true);
		expect(element.matches(`[${MEASURING_ATTRIBUTE}]`)).toBe(true);
		markLaidOut(element);
		markMeasuring(element, false);
		expect(element.matches(`[${LAID_OUT_ATTRIBUTE}]`)).toBe(true);
		expect(element.matches(`[${MEASURING_ATTRIBUTE}]`)).toBe(false);
	});

	test("nothing outside reader-dom spells them", () => {
		const root = join(import.meta.dirname, "../../..");
		const home = join(import.meta.dirname, "reader-dom.ts");
		const spellings = [
			LAID_OUT_ATTRIBUTE,
			MEASURING_ATTRIBUTE,
			...[LAID_OUT_ATTRIBUTE, MEASURING_ATTRIBUTE].map(
				(attribute) => `[${attribute.slice("data-".length)}]`,
			),
			"dataset.laidOut",
			"dataset.measuring",
		];
		const spelled = readdirSync(root, { recursive: true, encoding: "utf8" })
			.filter((file) => /\.(?:tsx?|css)$/u.test(file))
			.map((file) => join(root, file))
			.filter((file) => file !== home && file !== import.meta.filename)
			.filter((file) => {
				const text = readFileSync(file, "utf8");
				return spellings.some((spelling) => text.includes(spelling));
			})
			.map((file) => relative(root, file));
		expect(spelled).toEqual([]);
	});
});
