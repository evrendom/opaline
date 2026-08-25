import { describe, expect, test } from "bun:test";
import { LEARNING_CONTENT_MAX_CODE_UNITS } from "@rudel/api-routes";
import { clampLearningContent } from "./learnings.service.js";

describe("learning content UTF-8 boundary", () => {
	test("keeps a three-byte code point that crosses the former byte boundary", () => {
		const content = `${"a".repeat(LEARNING_CONTENT_MAX_CODE_UNITS - 1)}€tail`;
		const clamped = clampLearningContent(content);

		expect(clamped).toBe(`${"a".repeat(LEARNING_CONTENT_MAX_CODE_UNITS - 1)}€`);
		expect(clamped.length).toBe(LEARNING_CONTENT_MAX_CODE_UNITS);
		expect(new TextEncoder().encode(clamped).byteLength).toBe(
			LEARNING_CONTENT_MAX_CODE_UNITS + 2,
		);
	});

	test("backs up instead of splitting a four-byte code point at the code-unit cap", () => {
		const prefix = "a".repeat(LEARNING_CONTENT_MAX_CODE_UNITS - 1);
		const clamped = clampLearningContent(`${prefix}🙂tail`);

		expect(clamped).toBe(prefix);
		expect(clamped).not.toContain("�");
		expect(clamped.length).toBeLessThanOrEqual(LEARNING_CONTENT_MAX_CODE_UNITS);
	});
});
