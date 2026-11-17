import { useLayoutEffect, useRef } from "react";
import "./cost-rolling-text.css";

const ROLL_MS = 460;
const ROLL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ROLL_SHIFT_EM = 0.7;
const ROLL_BLUR = "blur(1px)";
const FADE_OUT_AT = 0.4;
const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

export function amountOf(text: string) {
	const match = text.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([kmb])?/i);
	if (!match?.[1]) return Number.NaN;
	return Number(match[1]) * (SCALE[match[2]?.toLowerCase() ?? ""] ?? 1);
}

type Rank = readonly [number, number];

function ranksOf(text: string): Rank[] {
	const chars = [...text];
	const first = chars.findIndex((char) => /\d/.test(char));
	if (first < 0) return chars.map((_, at) => [0, at]);
	let last = first;
	for (let at = first; at < chars.length; at += 1) {
		if (/\d/.test(chars[at] ?? "")) last = at;
		else if (!/[.,]/.test(chars[at] ?? "")) break;
	}
	const point = chars.indexOf(".", first);
	const anchor = point >= 0 && point <= last ? point : last + 1;
	return chars.map((_, at) =>
		at < first
			? [0, at]
			: at <= last
				? [1, at - anchor]
				: [2, at - chars.length],
	);
}

function compare(a: Rank, b: Rank) {
	return a[0] - b[0] || a[1] - b[1];
}

export type RollStep =
	| { kind: "keep"; char: string; old: number }
	| { kind: "swap"; char: string; old: number }
	| { kind: "add"; char: string }
	| { kind: "remove"; old: number };

export function rollSteps(before: string, after: string): RollStep[] {
	const from = [...before];
	const to = [...after];
	const fromRanks = ranksOf(before);
	const toRanks = ranksOf(after);
	const steps: RollStep[] = [];
	let i = 0;
	let j = 0;
	while (i < from.length || j < to.length) {
		const a = fromRanks[i];
		const b = toRanks[j];
		const order = !a ? 1 : !b ? -1 : compare(a, b);
		if (order < 0) {
			steps.push({ kind: "remove", old: i });
			i += 1;
		} else if (order > 0) {
			steps.push({ kind: "add", char: to[j] ?? "" });
			j += 1;
		} else {
			const char = to[j] ?? "";
			steps.push(
				from[i] === char
					? { kind: "keep", char, old: i }
					: { kind: "swap", char, old: i },
			);
			i += 1;
			j += 1;
		}
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
	slot.append(glyphOf(char));
	return slot;
}

function rollIn(glyph: Element, direction: number) {
	glyph.animate(
		[
			{
				opacity: 0,
				transform: `translateY(${direction * ROLL_SHIFT_EM}em)`,
				filter: ROLL_BLUR,
			},
			{ opacity: 1, filter: "blur(0px)", offset: 0.55 },
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
				{ opacity: 0, filter: ROLL_BLUR, offset: FADE_OUT_AT },
				{
					opacity: 0,
					transform: `translateY(${-direction * ROLL_SHIFT_EM}em)`,
					filter: ROLL_BLUR,
				},
			],
			{ duration: ROLL_MS, easing: ROLL_EASE, fill: "forwards" },
		)
		.finished.then(done, done);
}

function current(slot: Element) {
	return slot.querySelector<HTMLElement>(".cost-roll-glyph:not([data-out])");
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
	const nextSlot = (from: number) => {
		for (let at = from; at < steps.length; at += 1) {
			const step = steps[at];
			if (step && step.kind !== "add") return slots[step.old] ?? null;
		}
		return null;
	};
	steps.forEach((step, at) => {
		if (step.kind === "add") {
			const added = slotOf(step.char);
			element.insertBefore(added, nextSlot(at + 1));
			const glyph = current(added);
			if (glyph) rollIn(glyph, direction);
			return;
		}
		const slot = slots[step.old];
		if (!slot) return;
		if (step.kind === "remove") {
			slot.dataset.leaving = "";
			slot.style.width = `${slot.offsetWidth}px`;
			rollOut(current(slot), direction);
			setTimeout(() => slot.remove(), ROLL_MS * FADE_OUT_AT);
		} else if (step.kind === "swap") {
			rollOut(current(slot), direction);
			const glyph = glyphOf(step.char);
			slot.append(glyph);
			rollIn(glyph, direction);
		}
	});
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
