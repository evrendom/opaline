import { describe, expect, it } from "vitest";
import { selfHostedWelcomeCopy } from "./teammate-setup";

const ORIGIN = "http://127.0.0.1:4790";
const waiting = {
	pending: false,
	hasUploadedSessions: false,
	hasCliLogin: false,
};

describe("selfHostedWelcomeCopy", () => {
	it("gives a team server's welcome the terminal steps for its own server", () => {
		const copy = selfHostedWelcomeCopy(ORIGIN, waiting, false);
		expect(copy.title).toBe("Connect your terminal");
		expect(copy.steps.map((step) => step.id)).toEqual([
			"login",
			"upload",
			"mcp",
		]);
		expect(copy.steps[0]?.command).toContain(`--server ${ORIGIN}`);
		expect(JSON.stringify(copy)).not.toContain("opaline.so");
		expect(
			selfHostedWelcomeCopy(ORIGIN, { ...waiting, hasCliLogin: true }, false),
		).toMatchObject({
			title: "Your terminal is connected",
			forTeammates: true,
		});
	});

	it("gives the desktop app no terminal, teammate or cloud steps", () => {
		for (const status of [
			waiting,
			{ ...waiting, pending: true },
			{ ...waiting, hasUploadedSessions: true },
			{ ...waiting, hasCliLogin: true },
		]) {
			const copy = selfHostedWelcomeCopy(ORIGIN, status, true);
			expect(copy.steps).toEqual([]);
			expect(copy.forTeammates).toBe(false);
			expect(copy.body).toContain("Nothing leaves this Mac");
			expect(JSON.stringify(copy)).not.toMatch(/opaline\.so|terminal|login/i);
		}
		expect(selfHostedWelcomeCopy(ORIGIN, waiting, true).title).toBe(
			"Waiting for your sessions",
		);
		expect(
			selfHostedWelcomeCopy(
				ORIGIN,
				{ ...waiting, hasUploadedSessions: true },
				true,
			).title,
		).toBe("Your sessions are arriving");
	});
});
