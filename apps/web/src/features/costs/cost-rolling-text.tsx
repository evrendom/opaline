import { useLayoutEffect, useRef } from "react";
import "./cost-rolling-text.css";

const ROLL_MS = 460;
const ROLL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ROLL_SHIFT_EM = 0.7;
const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

export function amountOf(text: string) {
	const match = text.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([kmb])?/i);
	if (!match?.[1]) return Number.NaN;
	return Number(match[1]) * (SCALE[match[2]?.toLowerCase() ?? ""] ?? 1);
}

export type RollStep =
	| { kind: "keep"; char: string }
	| { kind: "swap"; from: string; char: string }
	| { kind: "add"; char: string }
	| { kind: "remove"; from: string };

export function rollSteps(before: string, after: string): RollStep[] {
	const from = [...before];
	const to = [...after];
	const steps: RollStep[] = [];
	for (let place = Math.max(from.length, to.length); place >= 1; place -= 1) {
		const old = from[from.length - place];
		const char = to[to.length - place];
		if (old === undefined && char !== undefined)
			steps.push({ kind: "add", char });
		else if (char === undefined && old !== undefined)
			steps.push({ kind: "remove", from: old });
		else if (old !== undefined && char !== undefined)
			steps.push(
				old === char
					? { kind: "keep", char }
					: { kind: "swap", from: old, char },
			);
	}
	return steps;
}

function glyphOf(char: string) {
	const glyph = document.createElement("span");
	glyph.className = "cost-roll-glyph";
	glyph.textContent = char;
	return glyph;
}

function slotOf(char: string) {
	const slot = document.createElement("span");
	slot.className = "cost-roll-slot";
	slot.dataset.char = char;
	slot.append(glyphOf(char));
	return slot;
}

function rollIn(glyph: Element, direction: number) {
	glyph.animate(
		[
			{
				opacity: 0,
				transform: `translateY(${direction * ROLL_SHIFT_EM}em)`,
				filter: "blur(2px)",
			},
			{ opacity: 1, transform: "none", filter: "blur(0px)" },
		],
		{ duration: ROLL_MS, easing: ROLL_EASE },
	);
}

function rollOut(glyph: HTMLElement | null, direction: number) {
	if (!glyph) return;
	glyph.dataset.out = "";
	const done = () => glyph.remove();
	glyph
		.animate(
			[
				{ opacity: 1, transform: "none", filter: "blur(0px)" },
				{
					opacity: 0,
					transform: `translateY(${-direction * ROLL_SHIFT_EM}em)`,
					filter: "blur(2px)",
				},
			],
			{ duration: ROLL_MS, easing: ROLL_EASE, fill: "forwards" },
		)
		.finished.then(done, done);
}

function roll(
	element: HTMLElement,
	before: string,
	after: string,
	direction: number,
) {
	const slots = [
		...element.querySelectorAll<HTMLElement>(
			":scope > .cost-roll-slot:not([data-leaving])",
		),
	];
	const steps = rollSteps(before, after);
	const offset =
		slots.length - steps.filter((step) => step.kind !== "add").length;
	let at = Math.max(0, offset);
	let anchor: Element | null = slots[at] ?? null;
	for (const step of steps) {
		if (step.kind === "add") {
			const added = slotOf(step.char);
			element.insertBefore(added, anchor);
			const width = added.offsetWidth;
			added.animate([{ width: "0px" }, { width: `${width}px` }], {
				duration: ROLL_MS,
				easing: ROLL_EASE,
			});
			if (added.firstElementChild) rollIn(added.firstElementChild, direction);
			continue;
		}
		const slot = slots[at];
		at += 1;
		anchor = slots[at] ?? null;
		if (!slot) continue;
		if (step.kind === "remove") {
			const width = slot.offsetWidth;
			slot.dataset.leaving = "";
			rollOut(
				slot.querySelector<HTMLElement>(".cost-roll-glyph:not([data-out])"),
				direction,
			);
			const done = () => slot.remove();
			slot
				.animate([{ width: `${width}px` }, { width: "0px" }], {
					duration: ROLL_MS,
					easing: ROLL_EASE,
					fill: "forwards",
				})
				.finished.then(done, done);
		} else if (step.kind === "swap") {
			const from = slot.offsetWidth;
			slot.dataset.char = step.char;
			rollOut(
				slot.querySelector<HTMLElement>(".cost-roll-glyph:not([data-out])"),
				direction,
			);
			const glyph = glyphOf(step.char);
			slot.append(glyph);
			rollIn(glyph, direction);
			const to = slot.offsetWidth;
			if (Math.abs(from - to) > 0.5)
				slot.animate([{ width: `${from}px` }, { width: `${to}px` }], {
					duration: ROLL_MS,
					easing: ROLL_EASE,
				});
		}
	}
}

function reducedMotion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
	);
}

export function RollingText({
	text,
	direction: fallback = 1,
}: {
	text: string;
	direction?: 1 | -1;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const shown = useRef<string | null>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const before = shown.current;
		shown.current = text;
		if (before === null || reducedMotion()) {
			element.replaceChildren(...[...text].map(slotOf));
			return;
		}
		if (before === text) return;
		const from = amountOf(before);
		const to = amountOf(text);
		const direction =
			Number.isFinite(from) && Number.isFinite(to) && from !== to
				? to > from
					? 1
					: -1
				: fallback;
		roll(element, before, text, direction);
	}, [text, fallback]);
	return (
		<span className="cost-roll">
			<span className="sr-only">{text}</span>
			<span ref={ref} aria-hidden="true" className="cost-roll-text" />
		</span>
	);
}
