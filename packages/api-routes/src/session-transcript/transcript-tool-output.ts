/** Unwrap recorded text output for a file/skill card; the original remains in raw details. */
export function readTranscriptToolOutputText(
	content: unknown,
): string | undefined {
	if (typeof content === "string") {
		const trimmed = content.trim();
		if (trimmed.startsWith("{")) {
			try {
				const parsed: unknown = JSON.parse(trimmed);
				const text = readEnvelopeText(parsed);
				if (text !== undefined) return text;
			} catch {
				// Plain text that begins with a brace is still valid file content.
			}
		}
		return content.replace(
			/^Script completed\r?\nWall time [^\n]*\r?\nOutput:\r?\n/u,
			"",
		);
	}
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			const text = readEnvelopeText(block);
			if (text === undefined) return undefined;
			if (text) parts.push(text);
		}
		return parts.join("\n");
	}
	return readEnvelopeText(content);
}

function readEnvelopeText(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	if (
		"type" in value &&
		(value.type === "text" || value.type === "input_text") &&
		"text" in value &&
		typeof value.text === "string"
	)
		return readTranscriptToolOutputText(value.text);
	if ("type" in value && value.type === "structured" && "value" in value)
		return readEnvelopeText(value.value);
	if ("output" in value && typeof value.output === "string")
		return value.output;
	if ("body" in value && typeof value.body === "string") return value.body;
	return undefined;
}
