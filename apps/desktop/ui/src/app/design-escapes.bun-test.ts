import { describe, expect, test } from "bun:test";
import {
	classifyClass,
	findEscapes,
	isEnforced,
	scanSource,
} from "../../tools/design-escapes.ts";

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
			"bg-accent-tint",
			"text-ink-3",
			"shadow-card",
			"aria-pressed:shadow-raised",
			"size-3.5",
			"h-8",
		])
			expect(classifyClass(ok)).toBeUndefined();
	});

	test("reads class strings, not code or comments, and honours the allow mark", () => {
		const source = [
			"const rounded = Math.round(x); // text-sm in a comment",
			'const a = cn("p-3 text-ink");',
			"// design-escape-ok: data paint",
			'const b = "bg-rose-500";',
		].join("\n");
		expect(scanSource("src/x.tsx", source)).toEqual([
			{ file: "src/x.tsx", line: 2, rule: "space", token: "p-3" },
		]);
	});

	test("the enforced scope has no escapes", () => {
		const failing = findEscapes().filter((e) => isEnforced(e.file));
		expect(
			failing.map((e) => `${e.file}:${e.line} ${e.rule} ${e.token}`),
		).toEqual([]);
	});
});
