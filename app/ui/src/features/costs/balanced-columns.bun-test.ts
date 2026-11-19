import { expect, test } from "bun:test";
import { balancedColumns } from "./balanced-columns";

test("six cards fill whole rows: 6, then 3 + 3, then 2 + 2 + 2, then one per row", () => {
	expect(balancedColumns(6, 1100)).toBe(6);
	expect(balancedColumns(6, 1000)).toBe(3);
	expect(balancedColumns(6, 700)).toBe(3);
	expect(balancedColumns(6, 542)).toBe(3);
	expect(balancedColumns(6, 540)).toBe(2);
	expect(balancedColumns(6, 356)).toBe(2);
	expect(balancedColumns(6, 300)).toBe(1);
});

test("five cards take the fewest rows and spread them evenly", () => {
	expect(balancedColumns(5, 930)).toBe(5);
	expect(balancedColumns(5, 900)).toBe(3);
	expect(balancedColumns(5, 542)).toBe(3);
	expect(balancedColumns(5, 520)).toBe(2);
	expect(balancedColumns(5, 400)).toBe(2);
});
