import { describe, expect, test } from "bun:test";
import {
	classifyClass,
	compareToBaseline,
	countsOf,
	readBaseline,
	scanFile,
	scanSource,
	scanTree,
	stripCssComments,
	themeColoursOf,
	updatedBaseline,
} from "../../tools/design-escapes.ts";

const rules = (file: string, source: string) =>
	scanSource(file, source).map((e) => `${e.line} ${e.rule} ${e.token}`);

describe("design-system escape check", () => {
	test("flags classes off the Opaline scales and roles", () => {
		expect(classifyClass("text-sm")).toBe("type");
		expect(classifyClass("leading-none")).toBe("type");
		expect(classifyClass("p-3")).toBe("space");
		expect(classifyClass("-ml-1.5")).toBe("space");
		expect(classifyClass("gap-[10px]")).toBe("space");
		expect(classifyClass("rounded-lg")).toBe("radius");
		expect(classifyClass("bg-rose-500/12")).toBe("colour");
		expect(classifyClass("dark:hover:text-white")).toBe("colour");
		expect(classifyClass("border-[#EBEBEB]")).toBe("colour");
		expect(classifyClass("[filter:drop-shadow(0_1px_rgb(0_0_0_/_4%))]")).toBe(
			"colour",
		);
		expect(classifyClass("shadow-lg")).toBe("shadow");
		expect(classifyClass("shadow-[0_1px_2px_black]")).toBe("shadow");
	});

	test("passes the steps and roles", () => {
		for (const ok of [
			"text-body-l",
			"text-display-xs",
			"gap-m",
			"px-xl",
			"gap-[calc(var(--space-xxl)*4/3)]",
			"corner-m",
			"squircle:corner-xl",
			"corner-xl-inner",
			"corner-xl-outer",
			"bg-accent-tint",
			"text-ink-3",
			"ring-focus-ring",
			"shadow-card",
			"aria-pressed:shadow-raised",
			"size-3.5",
			"h-8",
			"line-solid",
			"line-tight",
			"tracking-caps",
		])
			expect(classifyClass(ok)).toBeUndefined();
	});

	test("opacity: a theme colour with a modifier", () => {
		for (const hit of [
			"text-ink-3/50",
			"bg-error/10",
			"border-line/60",
			"focus-visible:ring-focus/50",
			"ring-offset-canvas/50",
			"bg-sidebar-accent/40",
			"bg-muted/30",
			"bg-[var(--ink)]/40",
			"bg-(--ink)/40",
		])
			expect(classifyClass(hit)).toBe("opacity");
		for (const ok of [
			"bg-current/50",
			"text-current/60",
			"bg-transparent",
			"text-ink-3",
		])
			expect(classifyClass(ok)).toBeUndefined();
		// a palette colour with a modifier stays `colour`; a size with a line height stays `type`
		expect(classifyClass("bg-black/10")).toBe("colour");
		expect(classifyClass("text-sm/5")).toBe("type");
	});

	test("theme colours are parsed from @theme blocks", () => {
		const names = themeColoursOf(
			"@theme inline {\n\t--color-ink: var(--ink);\n\t--color-new-role: var(--x);\n}\n:root { --color-not-theme: red; }",
		);
		expect([...names]).toEqual(["ink", "new-role"]);
	});

	test("motion: off-role durations, delays and easings", () => {
		for (const hit of [
			"duration-150",
			"duration-[250ms]",
			"delay-75",
			"delay-[40ms]",
			"ease-in",
			"ease-out",
			"hover:ease-in-out",
			"ease-[cubic-bezier(0.2,0,0,1)]",
		])
			expect(classifyClass(hit)).toBe("motion");
		for (const ok of [
			"duration-0",
			"duration-1000",
			"duration-[1.5s]",
			"duration-(--motion-base-duration)",
			"ease-linear",
			"ease-strong",
			"ease-drawer",
			"ease-wave",
			"ease-base",
			"ease-large",
			"ease-(--motion-strong-easing)",
		])
			expect(classifyClass(ok)).toBeUndefined();
	});

	test("base: direct Layer 1 reads", () => {
		for (const hit of [
			"bg-neutral-3",
			"text-color-2",
			"bg-neutral-10-transparent",
			"stroke-color-2/60",
			"bg-(--neutral-4)",
			"text-[var(--neutral-7)]",
		])
			expect(classifyClass(hit)).toBe("base");
		expect(classifyClass("bg-neutral-100")).toBe("colour");
	});

	test("CSS declarations: colour, type, motion, base; comments skipped", () => {
		const css = [
			"/* color: #fff; font-size: 12px;",
			"   transition: opacity 150ms ease; */",
			".a {",
			"\tcolor: #191715;",
			"\tfont-size: 12px;",
			"\tline-height: var(--line-m);",
			"\tletter-spacing: 0;",
			"\tfont-family: Inter, sans-serif;",
			"\ttransition:",
			"\t\topacity 150ms var(--motion-strong-easing),",
			"\t\ttransform 1s ease-out;",
			"\tanimation: spin 1200ms linear infinite;",
			"\tbackground: var(--neutral-2);",
			"\tmask-image: linear-gradient(#000, transparent);",
			"\t--old-tint: rgb(0 0 0 / 4%);",
			"}",
		].join("\n");
		expect(rules("src/a.css", css)).toEqual([
			"4 colour color: #191715",
			"5 type font-size: 12px",
			"8 type font-family: Inter, sans-serif",
			"10 motion transition: 150ms",
			"11 motion transition: ease-out",
			"13 base background: var(--neutral-2)",
			"15 colour --old-tint: rgb(",
		]);
		expect(stripCssComments("a /* x\ny */ b")).toBe("a     \n     b");
	});

	test("reads class strings, not code or comments", () => {
		const source = [
			"const rounded = Math.round(x); // text-sm in a comment",
			'const a = cn("p-3 text-ink");',
		].join("\n");
		expect(rules("src/x.tsx", source)).toEqual(["2 space p-3"]);
	});

	test("per-rule markers exempt only their rules, on their line and the next", () => {
		const source = [
			"// design-escape-ok(colour): brand mark",
			'const b = "bg-rose-500 text-sm";',
			'const c = "bg-rose-500";',
			'const d = cn("bg-rose-500"); /* design-escape-ok(colour,type): mark */',
			"{/* design-escape-ok(radius): a 26px squircle */}",
			'<div className="rounded-[26px]" />',
		].join("\n");
		const scan = scanFile("src/x.tsx", source);
		expect(scan.escapes.map((e) => `${e.line} ${e.rule} ${e.token}`)).toEqual([
			"2 type text-sm",
			"3 colour bg-rose-500",
		]);
		expect(scan.markersUsed).toBe(3);
	});

	test("legacy, unknown and stale markers are `marker` escapes", () => {
		const source = [
			"// design-escape-ok: old style",
			'const a = "bg-rose-500";',
			"// design-escape-ok(color): misspelt",
			'const b = "p-3";',
			"// design-escape-ok(type): nothing below",
			'const c = "text-ink";',
		].join("\n");
		expect(
			scanSource("src/x.tsx", source).map((e) => `${e.line} ${e.rule}`),
		).toEqual(["1 marker", "2 colour", "3 marker", "4 space", "5 marker"]);
	});

	test("ratchet: above fails, below asks for an update, updates only lower", () => {
		const baseline = { type: 3, colour: 2, markers: 1 };
		expect(
			compareToBaseline(
				{ type: 3, colour: 1, markers: 2, motion: 1 },
				baseline,
			),
		).toEqual({
			over: [
				{ key: "markers", count: 2, max: 1 },
				{ key: "motion", count: 1, max: 0 },
			],
			under: [{ key: "colour", count: 1, max: 2 }],
		});
		expect(
			updatedBaseline({ type: 5, colour: 1, markers: 1, motion: 4 }, baseline),
		).toEqual({ type: 3, colour: 1, markers: 1, motion: 4 });
	});

	test("the tree is within the baseline", () => {
		const { over } = compareToBaseline(countsOf(scanTree()), readBaseline());
		expect(over).toEqual([]);
	});
});
