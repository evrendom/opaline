import { expect, test } from "@playwright/test";

for (const [scenario, width] of [
	["default", 320],
	["default", 350],
	["extra", 400],
	["member", 300],
	["no-speaker", 300],
] as const) {
	test(`ledger fills its scrollable width: ${scenario} at ${width}px`, async ({
		page,
	}) => {
		await page.goto(
			`/browser-tests/session-turn-table.html?scenario=${scenario}&width=${width}`,
		);
		const scroll = page.locator("[data-session-turn-table-scroll]");
		await expect(scroll.locator('tr[data-visible-index="1"]')).toBeVisible();
		await page.evaluate(() => document.fonts.ready);

		for (const paneWidth of [width, 900, width]) {
			await page.locator("[data-ledger-pane]").evaluate((pane, nextWidth) => {
				pane.style.width = `${nextWidth}px`;
			}, paneWidth);
			await scroll.evaluate((element) => {
				element.scrollLeft = element.scrollWidth;
			});
			const bounds = await scroll.evaluate((element) => {
				const viewport = element.getBoundingClientRect();
				const rows = Array.from(
					element.querySelectorAll(
						'thead > tr, tr[data-visible-index="0"], tr[data-visible-index="1"]',
					),
				);
				return {
					overflow: element.scrollWidth - element.clientWidth,
					rows: rows.map((row) => {
						const rect = row.getBoundingClientRect();
						const lastCell = row.lastElementChild;
						if (!lastCell) throw new Error("Missing last ledger cell");
						const cellRect = lastCell.getBoundingClientRect();
						const hit = document.elementFromPoint(
							cellRect.right - 2,
							cellRect.top + cellRect.height / 2,
						);
						return {
							gap: viewport.right - rect.right,
							cellOverflow: cellRect.right - rect.right,
							lastCellPainted: hit !== null && lastCell.contains(hit),
						};
					}),
				};
			});
			if (paneWidth === width) expect(bounds.overflow).toBeGreaterThan(0);
			else expect(bounds.overflow).toBe(0);
			expect(bounds.rows).toHaveLength(3);
			for (const row of bounds.rows) {
				expect(Math.abs(row.gap)).toBeLessThanOrEqual(1);
				expect(row.cellOverflow).toBeLessThanOrEqual(1);
				expect(row.lastCellPainted).toBe(true);
			}
		}
	});
}
