import type { Source } from "@rudel/api-routes";

const SOURCE_DISPLAY_NAMES: Record<Source, string> = {
	claude_code: "Claude Code",
	codex: "Codex",
};

export function getMissingTranscriptTimestampMessage(source: Source): string {
	return `${SOURCE_DISPLAY_NAMES[source]} transcript contains no valid timestamp`;
}

export function isMissingTranscriptTimestampMessage(
	source: Source,
	message: string,
): boolean {
	return message === getMissingTranscriptTimestampMessage(source);
}

export function getInvalidTranscriptTimestampMessage(source: Source): string {
	return `${SOURCE_DISPLAY_NAMES[source]} transcript contains a timestamp outside the supported timezone-explicit RFC3339 format`;
}

export class InvalidTranscriptTimestampError extends Error {
	constructor(source: Source) {
		super(getInvalidTranscriptTimestampMessage(source));
		this.name = "InvalidTranscriptTimestampError";
	}
}

export class MissingTranscriptTimestampError extends Error {
	constructor(source: Source) {
		super(getMissingTranscriptTimestampMessage(source));
		this.name = "MissingTranscriptTimestampError";
	}
}
