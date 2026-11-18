import { describe, expect, test } from "bun:test";
import { readsSessionData } from "./use-reads-session-data";

describe("readsSessionData", () => {
	test("the app reads a session's data", () => {
		expect(readsSessionData("production", null)).toBe(true);
	});

	test("the live demo reads it from the showcase workspace", () => {
		expect(readsSessionData("product-demo", { live: true })).toBe(true);
	});

	test("the demo on its seed reads nothing", () => {
		expect(readsSessionData("product-demo", { live: false })).toBe(false);
	});

	test("the plugin reads nothing", () => {
		expect(readsSessionData("plugin", null)).toBe(false);
	});
});
