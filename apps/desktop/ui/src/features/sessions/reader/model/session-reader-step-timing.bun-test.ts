import { expect, test } from "bun:test";
import {
	WRITTEN_CHARS_PER_SECOND,
	writingMs,
} from "./session-reader-step-timing";

const OBSERVED_WRITE = { characters: 21_700, ms: 66_000 };

test("writing 21.7k characters takes about the 66 s it was seen to take", () => {
	const ms = writingMs({ content: "x".repeat(OBSERVED_WRITE.characters) });
	expect(Math.abs(ms - OBSERVED_WRITE.ms) / OBSERVED_WRITE.ms).toBeLessThan(
		0.1,
	);
	expect(Math.round(ms)).toBe(72_333);
});

test("a call's input is written at the same rate whatever its fields", () => {
	expect(
		writingMs({
			command: "x".repeat(WRITTEN_CHARS_PER_SECOND),
			description: "",
		}),
	).toBe(1_000);
	expect(writingMs(null)).toBe(0);
});
