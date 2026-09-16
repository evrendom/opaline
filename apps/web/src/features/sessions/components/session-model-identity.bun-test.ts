import { expect, test } from "bun:test";
import {
	formatModelDisplayLabel,
	getModelBadgeTone,
} from "@/features/dashboard/components/dashboard-model-brand";
import { getSessionModelDisplayValue } from "./session-model-identity";

test("failed Claude starts show the requested label and Claude icon", () => {
	for (const model of ["", "unknown", "<synthetic>", null]) {
		const display = getSessionModelDisplayValue({
			model,
			source: "claude_code",
			totalTokens: 0,
			errorCount: 1,
		});
		expect(display).toBe("Claude (failed start)");
		expect(formatModelDisplayLabel(display ?? "")).toBe(
			"Claude (failed start)",
		);
		expect(getModelBadgeTone(display ?? "").icon).toBe("claude");
	}
});

test("Codex without its own model uses provider identity instead of inventing a model", () => {
	const display = getSessionModelDisplayValue({
		model: "",
		source: "codex",
		totalTokens: 0,
		errorCount: 0,
	});
	expect(display).toBe("Codex");
	expect(formatModelDisplayLabel(display ?? "")).toBe("Codex");
	expect(getModelBadgeTone(display ?? "").icon).toBe("codex");
});

test("missing model alone is not evidence of a failed start", () => {
	expect(
		getSessionModelDisplayValue({
			model: null,
			source: "claude_code",
			totalTokens: 0,
			errorCount: 0,
		}),
	).toBe("Claude Code");
	expect(
		getSessionModelDisplayValue({
			model: null,
			source: "claude_code",
			totalTokens: 100,
			errorCount: 1,
		}),
	).toBe("Claude Code");
	expect(
		getSessionModelDisplayValue({
			model: "gpt-6-astra",
			source: "codex",
			totalTokens: 100,
			errorCount: 0,
		}),
	).toBe("gpt-6-astra");
	expect(
		getSessionModelDisplayValue({
			model: null,
			source: undefined,
			totalTokens: 0,
			errorCount: 0,
		}),
	).toBeUndefined();
});
