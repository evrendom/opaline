// Presentation only: provider labels are never fed back into model pricing.
export function getSessionModelDisplayValue({
	model,
	source,
	totalTokens,
	errorCount,
}: {
	model: string | null | undefined;
	source: string | null | undefined;
	totalTokens: number;
	errorCount: number;
}): string | undefined {
	const identity = model?.trim();
	if (identity && !["unknown", "<synthetic>"].includes(identity.toLowerCase()))
		return identity;
	if (source === "claude_code") {
		return totalTokens === 0 && errorCount > 0
			? "Claude (failed start)"
			: "Claude Code";
	}
	if (source === "codex") return "Codex";
	return undefined;
}
