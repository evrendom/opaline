import { describe, expect, test } from "bun:test";
import { squarify } from "./session-reader-breakdown";

const part = (label: string, value: number) => ({
	color: "#000",
	label,
	value,
});

describe("squarify", () => {
	test("tiles the whole box, each tile its share of the area", () => {
		const parts = [
			part("Cached input", 41),
			part("Output", 25),
			part("Cache write", 18),
			part("Input", 12),
			part("Subagents", 4),
		];
		const cells = squarify(parts, 96, 36);
		expect(cells).toHaveLength(parts.length);
		const area = cells.reduce((sum, cell) => sum + cell.width * cell.height, 0);
		expect(area).toBeCloseTo(96 * 36, 6);
		for (const cell of cells) {
			expect(cell.width * cell.height).toBeCloseTo(
				(cell.part.value / 100) * 96 * 36,
				6,
			);
			expect(cell.left).toBeGreaterThanOrEqual(-1e-9);
			expect(cell.top).toBeGreaterThanOrEqual(-1e-9);
			expect(cell.left + cell.width).toBeLessThanOrEqual(96 + 1e-9);
			expect(cell.top + cell.height).toBeLessThanOrEqual(36 + 1e-9);
		}
	});

	test("leaves out empty parts, and draws nothing for nothing", () => {
		expect(squarify([part("a", 3), part("b", 0)], 96, 36)).toHaveLength(1);
		expect(squarify([part("a", 0)], 96, 36)).toEqual([]);
	});
});
