const { describe, expect, mock, test } = require("bun:test");

mock.module("electron", () => ({}));

const { latestReadings, iconValue } = require("../dock-usage");

const line = (reading) => JSON.stringify(reading);

describe("latestReadings", () => {
	test("takes each provider's latest overall weekly reading, skipping asks and per-model limits", () => {
		const text = [
			line({
				at: "2026-11-19T10:00:00Z",
				provider: "claude",
				windowMinutes: 10080,
				usedPercent: 70,
				modelScope: null,
			}),
			line({
				at: "2026-11-19T11:00:00Z",
				provider: "claude",
				windowMinutes: 300,
				usedPercent: 10,
				modelScope: null,
			}),
			line({
				at: "2026-11-19T11:00:00Z",
				provider: "claude",
				windowMinutes: 10080,
				usedPercent: 83,
				modelScope: null,
			}),
			line({
				at: "2026-11-19T11:00:00Z",
				provider: "claude",
				windowMinutes: 10080,
				usedPercent: 44,
				modelScope: "fable",
			}),
			line({
				at: "2026-11-19T11:00:00Z",
				provider: "codex",
				windowMinutes: 43200,
				usedPercent: 100,
				modelScope: null,
			}),
			line({
				kind: "ask",
				at: "2026-11-19T11:05:00Z",
				provider: "claude",
				error: "offline",
			}),
		].join("\n");
		const readings = latestReadings(text);
		expect(readings.claude.usedPercent).toBe(83);
		expect(readings.codex.usedPercent).toBe(100);
	});
});

describe("iconValue", () => {
	const readings = { claude: { usedPercent: 83 }, codex: { usedPercent: 100 } };

	test("shows nothing until the picked agent is connected", () => {
		expect(iconValue("claude", readings, new Set())).toBeNull();
		expect(iconValue("codex", readings, new Set(["claude"]))).toBeNull();
	});

	test("averages what is left across the connected agents for both", () => {
		expect(iconValue("both", readings, new Set(["claude", "codex"]))).toBe(9);
		expect(iconValue("both", readings, new Set(["claude"]))).toBe(17);
	});
});
