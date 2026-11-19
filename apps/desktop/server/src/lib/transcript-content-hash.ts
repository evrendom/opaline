import { createHash, type Hash } from "node:crypto";

export function hashTranscriptContent(
	content: string,
	subagents: Readonly<Record<string, string>> = {},
): string {
	return digestTranscriptContent(
		createHash("sha256").update(content, "utf8"),
		subagents,
	);
}

export function digestTranscriptContent(
	hash: Hash,
	subagents: Readonly<Record<string, string>>,
): string {
	for (const agentId of Object.keys(subagents).sort()) {
		hash.update(`\u0000${agentId}\u0000`, "utf8");
		hash.update(subagents[agentId] ?? "", "utf8");
	}
	return hash.digest("hex");
}
