import { describe, expect, it } from "vitest";
import { selfHostedWelcomeCopy } from "./welcome-copy";

const waiting = { pending: false, hasUploadedSessions: false };

describe("selfHostedWelcomeCopy", () => {
	it("follows the import without terminal, login or cloud steps", () => {
		for (const localApp of [true, false])
			for (const status of [
				waiting,
				{ ...waiting, pending: true },
				{ ...waiting, hasUploadedSessions: true },
			])
				expect(
					JSON.stringify(selfHostedWelcomeCopy(status, localApp)),
				).not.toMatch(/opaline\.so|terminal|login|npx/i);
		expect(selfHostedWelcomeCopy(waiting, true)).toMatchObject({
			title: "Waiting for your sessions",
			body: expect.stringContaining("Nothing leaves this Mac"),
		});
		expect(
			selfHostedWelcomeCopy({ ...waiting, hasUploadedSessions: true }, false)
				.title,
		).toBe("Your sessions are arriving");
		expect(
			selfHostedWelcomeCopy({ ...waiting, pending: true }, true).title,
		).toBe("Checking your sessions…");
	});
});
