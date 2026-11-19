import { expect, test } from "bun:test";
import { SESSION_DETAIL_WINDOW_INITIAL_TURNS } from "@rudel/api-routes";
import { canStartWindow, MAX_WINDOWS_IN_FLIGHT } from "./reader-window-slots";

const turns = Array.from({ length: 1_000 }, (_, index) => ({
	turnId: `turn-${index}`,
}));
const reach = SESSION_DETAIL_WINDOW_INITIAL_TURNS / 2;

test("two windows may load at once when the second is out of the first's reach", () => {
	expect(MAX_WINDOWS_IN_FLIGHT).toBe(2);
	expect(canStartWindow(new Set(), "turn-10", turns)).toBe(true);
	expect(canStartWindow(new Set(["turn-10"]), "turn-500", turns)).toBe(true);
	expect(
		canStartWindow(new Set(["turn-10"]), `turn-${10 + reach + 1}`, turns),
	).toBe(true);
});

test("a turn the loading window will bring waits for it", () => {
	expect(canStartWindow(new Set(["turn-10"]), "turn-12", turns)).toBe(false);
	expect(
		canStartWindow(new Set(["turn-500"]), `turn-${500 - reach}`, turns),
	).toBe(false);
});

test("no third window, and no second without knowing where turns sit", () => {
	expect(
		canStartWindow(new Set(["turn-10", "turn-500"]), "turn-900", turns),
	).toBe(false);
	expect(canStartWindow(new Set(["turn-10"]), "turn-500", undefined)).toBe(
		false,
	);
	expect(canStartWindow(new Set(["turn-10"]), "missing", turns)).toBe(false);
	expect(canStartWindow(new Set(["missing"]), "turn-500", turns)).toBe(false);
});
