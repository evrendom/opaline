import { describe, expect, test } from "bun:test";
import {
	RETURNED_TEXT_REDACTION,
	redactReturnedText,
	redactReturnedValue,
} from "../index.js";
import { CREDENTIAL_FIXTURES } from "./helpers/credential-fixtures.js";

describe("redactReturnedText", () => {
	for (const { text, secret } of CREDENTIAL_FIXTURES)
		test(`removes the value from ${JSON.stringify(text)}`, () => {
			const redacted = redactReturnedText(text);
			expect(redacted).not.toContain(secret);
			expect(redacted).toContain(RETURNED_TEXT_REDACTION);
		});

	test("leaves plain words, type declarations, ids and paths alone", () => {
		for (const text of [
			"Reset your password in settings.",
			"the token is required",
			"password: string",
			"token: Promise<string>",
			'{"sessionId":"session-123","agentId":"","turn":2}',
			"src/auth/password-reset.ts",
			"https://example.com/docs",
		])
			expect(redactReturnedText(text)).toBe(text);
	});

	test("upload-time markers read as [redacted]", () => {
		expect(redactReturnedText("key [REDACTED:openai-api-key] here")).toBe(
			"key [redacted] here",
		);
	});

	test("redacts every string of a structured result and keeps its shape", () => {
		const value = {
			items: [{ text: "PASSWORD=hunter2hunter2", turn: 3, ok: true }],
			nested: { cmd: "mysql --password=pa55word99" },
		};
		expect(redactReturnedValue(value)).toEqual({
			items: [{ text: "PASSWORD=[redacted]", turn: 3, ok: true }],
			nested: { cmd: "mysql --password=[redacted]" },
		});
	});
});
