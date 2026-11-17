import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../..");

const MENU_POPUP =
	/<(SelectPrimitive\.List|Select\.List|Menu\.Popup|MenuPrimitive\.Popup|ContextMenu\.Popup|ContextMenuPrimitive\.Popup|Combobox\.List|ComboboxPrimitive\.List|Popover\.Popup|PopoverPrimitive\.Popup)\b/;

const WITHOUT_FLUID_HOVER: Record<string, string> = {
	"features/sessions/components/session-menu-popover-content.tsx":
		"positioning shell; the lists rendered inside it bring their own FluidMenuHover",
	"features/sessions/reader/rail/session-reader-rail-tags.tsx":
		"holds a single segmented toggle, not a list of items",
};

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		if (
			!entry.name.endsWith(".tsx") ||
			/\.(test|bun-test)\.tsx$/.test(entry.name)
		)
			return [];
		return [path];
	});
}

describe("menu popups", () => {
	const popups = sourceFiles(SRC)
		.map((path) => ({
			file: relative(SRC, path),
			source: readFileSync(path, "utf8"),
		}))
		.filter(({ source }) => MENU_POPUP.test(source));

	it("finds the shared menu primitives", () => {
		const files = popups.map(({ file }) => file);
		expect(files).toContain("app/ui/select.tsx");
		expect(files).toContain("components/dashboard/select.tsx");
	});

	it("gives every menu the fluid hover", () => {
		const missing = popups
			.filter(
				({ file, source }) =>
					!(file in WITHOUT_FLUID_HOVER) && !source.includes("<FluidMenuHover"),
			)
			.map(({ file }) => file);
		expect(missing).toEqual([]);
	});

	it("keeps the exceptions current", () => {
		const stale = Object.keys(WITHOUT_FLUID_HOVER).filter(
			(file) => !popups.some((popup) => popup.file === file),
		);
		expect(stale).toEqual([]);
	});
});
