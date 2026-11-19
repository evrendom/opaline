import { claudeCodeAdapter } from "@rudel/agent-adapters";

const timestamps = claudeCodeAdapter.extractTimestamps(
	[
		JSON.stringify({
			timestamp: "2026-02-15T10:00:00-05:00",
			type: "user",
		}),
		JSON.stringify({
			timestamp: "2026-02-15T10:05:00-05:00",
			type: "assistant",
		}),
	].join("\n"),
);

process.stdout.write(JSON.stringify(timestamps));
