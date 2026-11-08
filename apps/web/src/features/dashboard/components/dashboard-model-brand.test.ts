import { describe, expect, it } from "vitest";
import { formatModelDisplayLabel } from "./dashboard-model-brand";

describe("formatModelDisplayLabel", () => {
	it("preserves GPT variants in the formatted label", () => {
		expect(formatModelDisplayLabel("gpt-5.6-sol")).toBe("GPT 5.6 Sol");
		expect(formatModelDisplayLabel("gpt-5.6-terra")).toBe("GPT 5.6 Terra");
		expect(formatModelDisplayLabel("gpt-5.6-luna")).toBe("GPT 5.6 Luna");
		expect(formatModelDisplayLabel("gpt-6-astra")).toBe("GPT 6 Astra");
		expect(formatModelDisplayLabel("gpt-6-sol")).toBe("GPT 6 Sol");
		expect(formatModelDisplayLabel("gpt-6-luna")).toBe("GPT 6 Luna");
		expect(formatModelDisplayLabel("gpt-6.1-sol")).toBe("GPT 6.1 Sol");
		expect(formatModelDisplayLabel("GPT 5.6 Sol")).toBe("GPT 5.6 Sol");
		expect(formatModelDisplayLabel("gpt-5.6")).toBe("GPT 5.6");
	});

	it("uses the concise Fable family name", () => {
		expect(formatModelDisplayLabel("claude-fable-5")).toBe("Fable 5");
		expect(formatModelDisplayLabel("claude-fable-5-20260609")).toBe("Fable 5");
		expect(formatModelDisplayLabel("Claude Fable 5")).toBe("Fable 5");
		expect(formatModelDisplayLabel("claude-fable-5-1")).toBe("Fable 5.1");
		expect(formatModelDisplayLabel("claude-fable-5.1")).toBe("Fable 5.1");
	});
});
