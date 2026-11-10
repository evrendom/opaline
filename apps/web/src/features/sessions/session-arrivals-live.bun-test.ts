import { expect, test } from "bun:test";
import {
	pollUnlessPushed,
	sessionArrivalsLive,
	setSessionArrivalsLive,
} from "./session-arrivals-live";

test("the stream's state starts offline and follows open and error", () => {
	expect(sessionArrivalsLive()).toBe(false);
	setSessionArrivalsLive(true);
	expect(sessionArrivalsLive()).toBe(true);
	setSessionArrivalsLive(false);
	expect(sessionArrivalsLive()).toBe(false);
});

test("a query polls at its own pace only while nothing pushes its changes", () => {
	expect(pollUnlessPushed(false, 60_000)).toBe(60_000);
	expect(pollUnlessPushed(true, 60_000)).toBe(false);
	expect(pollUnlessPushed(true, 10_000, 300_000)).toBe(300_000);
	expect(pollUnlessPushed(false, 10_000, 300_000)).toBe(10_000);
});
