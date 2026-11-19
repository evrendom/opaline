import { expect, test } from "bun:test";
import { truncateSessionDetailPreview } from "../services/session-detail-derivation.service.js";

test("large previews preserve Unicode and whitespace semantics", () => {
	const cases = [
		"",
		"  hello\nworld  ",
		"😀".repeat(300),
		"x\t".repeat(1000),
		`${" ".repeat(100000)}short`,
	];
	for (const text of cases) {
		const normalized = text.replace(/\s+/gu, " ").trim();
		const points = Array.from(normalized);
		const expected =
			points.length <= 140
				? normalized
				: `${points.slice(0, 137).join("").trimEnd()}...`;
		expect(truncateSessionDetailPreview(text)).toBe(expected || null);
	}
});
