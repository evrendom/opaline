import { describe, expect, test } from "bun:test";
import {
	clearSessionOpenStart,
	elapsedMilliseconds,
	markSessionOpen,
	markSessionOpenFromClick,
	readSessionOpenStart,
} from "./session-open-timing";

describe("session open timing", () => {
	test("ignores modified clicks and clicks on the already-open session", () => {
		const plain = {
			button: 0,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			defaultPrevented: false,
		};
		for (const flag of [
			"metaKey",
			"ctrlKey",
			"altKey",
			"shiftKey",
			"defaultPrevented",
		]) {
			markSessionOpenFromClick("modified-session", false, {
				...plain,
				[flag]: true,
			});
			expect(readSessionOpenStart("modified-session").startSource).toBe(
				"mount",
			);
		}
		markSessionOpenFromClick("active-session", true, plain);
		expect(readSessionOpenStart("active-session").startSource).toBe("mount");
		markSessionOpenFromClick("plain-session", false, plain);
		const opened = readSessionOpenStart("plain-session");
		expect(opened.startSource).toBe("navigation");
		clearSessionOpenStart(opened);
	});

	test("preserves the click timestamp across repeated initializers, then consumes it at commit", () => {
		markSessionOpen("session-a");
		const first = readSessionOpenStart("session-a");
		expect(first.startSource).toBe("navigation");
		expect(readSessionOpenStart("session-a")).toBe(first);
		clearSessionOpenStart(first);
		expect(readSessionOpenStart("session-a").startSource).toBe("mount");
	});

	test("does not attach another session's navigation timing to a direct open", () => {
		markSessionOpen("session-a");
		const direct = readSessionOpenStart("session-b");
		expect(direct.startSource).toBe("mount");
		clearSessionOpenStart(direct);
		const matching = readSessionOpenStart("session-a");
		expect(matching.startSource).toBe("navigation");
		clearSessionOpenStart(matching);
	});

	test("an older view committing cannot clear a newer navigation", () => {
		markSessionOpen("session-a");
		const previous = readSessionOpenStart("session-a");
		markSessionOpen("session-b");
		clearSessionOpenStart(previous);
		const current = readSessionOpenStart("session-b");
		expect(current.startSource).toBe("navigation");
		clearSessionOpenStart(current);
	});

	test("reports milliseconds and clamps clock differences to zero", () => {
		expect(elapsedMilliseconds(100, 8100.4)).toBe(8000);
		expect(elapsedMilliseconds(100, 99)).toBe(0);
	});
});
