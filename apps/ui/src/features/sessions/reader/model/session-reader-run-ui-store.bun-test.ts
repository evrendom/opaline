import { describe, expect, test } from "bun:test";
import { createActiveTurnStore } from "../rail/session-reader-turn-rail";
import { createRunUiStore } from "./session-reader-run-ui-store";

describe("opening every run at once", () => {
	test("opens the runs touched and the ones still to load, and folds them back", () => {
		const store = createRunUiStore(createActiveTurnStore());
		store.update("a", () => ({ open: false }));
		expect(store.getAllOpen()).toBe(false);

		store.setAllOpen(true);
		expect(store.get("a").open).toBe(true);
		expect(store.get("not-loaded-yet").open).toBe(true);
		expect(store.getAllOpen()).toBe(true);
		expect(store.get("b")).toBe(store.get("c"));

		store.update("a", () => ({ open: false }));
		expect(store.getAllOpen()).toBe(false);

		store.setAllOpen(false);
		expect(store.get("a").open).toBe(false);
		expect(store.get("not-loaded-yet").open).toBe(false);
		expect(store.getAllFolded()).toBe(true);
		store.update("a", () => ({ open: true }));
		expect(store.getAllFolded()).toBe(false);
	});

	test("picking a step in an untouched run keeps it open", () => {
		const store = createRunUiStore(createActiveTurnStore());
		store.setAllOpen(true);
		store.pick("a", "step-1");
		expect(store.get("a")).toMatchObject({ open: true, selected: "step-1" });
	});
});
