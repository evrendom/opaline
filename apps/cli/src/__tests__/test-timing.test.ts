import { afterEach, expect, test } from "bun:test";
import { testTimingMs } from "../lib/test-timing.js";

const VARIABLE = "OPALINE_TEST_EVIDENCE_REQUEST_TIMEOUT_MS";
const original = process.env[VARIABLE];

afterEach(() => {
	if (original === undefined) delete process.env[VARIABLE];
	else process.env[VARIABLE] = original;
});

test("an override only ever shortens the production wait", () => {
	delete process.env[VARIABLE];
	expect(testTimingMs("EVIDENCE_REQUEST_TIMEOUT", 15_000)).toBe(15_000);
	process.env[VARIABLE] = "2000";
	expect(testTimingMs("EVIDENCE_REQUEST_TIMEOUT", 15_000)).toBe(2_000);
	process.env[VARIABLE] = "0";
	expect(testTimingMs("EVIDENCE_REQUEST_TIMEOUT", 15_000)).toBe(0);
	// A longer wait could outlast the host's hook timeout.
	process.env[VARIABLE] = "60000";
	expect(testTimingMs("EVIDENCE_REQUEST_TIMEOUT", 15_000)).toBe(15_000);
	for (const malformed of ["", "-1", "1.5", "2s", "Infinity"]) {
		process.env[VARIABLE] = malformed;
		expect(testTimingMs("EVIDENCE_REQUEST_TIMEOUT", 15_000)).toBe(15_000);
	}
});
