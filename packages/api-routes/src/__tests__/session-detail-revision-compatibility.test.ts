import { expect, test } from "bun:test";
import { SessionDetailRevisionSchema } from "../schemas/session-detail-payload.js";

test("preserves deployed UInt64 and legacy timestamp revision identities", () => {
	for (const revision of [
		"0",
		"1",
		"18446744073709551615",
		"2026-08-16T08:30:00.123Z",
	]) {
		expect(SessionDetailRevisionSchema.parse(revision)).toBe(revision);
	}
});

test("rejects ambiguous and out-of-range revision identities", () => {
	for (const revision of [
		"",
		"01",
		"-1",
		"1.5",
		"1e3",
		"18446744073709551616",
		"not-a-date",
	]) {
		expect(SessionDetailRevisionSchema.safeParse(revision).success).toBe(false);
	}
});
