import { createHash, type Hash } from "node:crypto";
import type { IngestSessionInput } from "@rudel/api-routes";
import { digestTranscriptContent } from "./transcript-content-hash.js";

const SHARED_CHUNK_CHARS = 1 << 20;

export function computeIngestContentHash(input: IngestSessionInput): string {
	return hashIngestContent(input, null);
}

export function computeIngestContentHashes(
	input: IngestSessionInput,
	subagents: Readonly<Record<string, string>>,
): { readonly contentSha256: string; readonly transcriptSha256: string } {
	const transcript = createHash("sha256");
	const contentSha256 = hashIngestContent(input, transcript);
	return {
		contentSha256,
		transcriptSha256: digestTranscriptContent(transcript, subagents),
	};
}

function hashIngestContent(
	input: IngestSessionInput,
	transcript: Hash | null,
): string {
	const hash = createHash("sha256");

	updateNamedField(hash, "source", input.source);
	updateNamedField(hash, "sessionId", input.sessionId);
	updateNamedField(hash, "projectPath", input.projectPath);
	updateNamedField(hash, "gitRemote", input.gitRemote ?? "");
	updateNamedField(hash, "packageName", input.packageName ?? "");
	updateNamedField(hash, "packageType", input.packageType ?? "");
	updateNamedNullableField(hash, "gitBranch", input.gitBranch);
	updateNamedNullableField(hash, "gitSha", input.gitSha);
	updateNamedNullableField(hash, "tag", input.tag);
	updateFramedField(hash, "content");
	if (transcript) updateSharedFramedField(hash, transcript, input.content);
	else updateFramedField(hash, input.content);
	updateNamedField(hash, "filterVersion", String(input.filter_version ?? 0));

	if (input.source === "claude_code") {
		const subagents = [...(input.subagents ?? [])].sort((left, right) =>
			left.agentId < right.agentId ? -1 : left.agentId > right.agentId ? 1 : 0,
		);
		updateNamedField(hash, "subagentCount", String(subagents.length));
		for (const subagent of subagents) {
			updateNamedField(hash, "subagentId", subagent.agentId);
			updateNamedField(hash, "subagentContent", subagent.content);
		}
	}

	return hash.digest("hex");
}

function updateNamedField(hash: Hash, name: string, value: string): void {
	updateFramedField(hash, name);
	updateFramedField(hash, value);
}

function updateNamedNullableField(
	hash: Hash,
	name: string,
	value: string | undefined,
): void {
	updateFramedField(hash, name);
	if (value === undefined) {
		updateFramedField(hash, "absent");
		return;
	}
	updateFramedField(hash, "present");
	updateFramedField(hash, value);
}

function updateFramedField(hash: Hash, field: string): void {
	hash.update(`${Buffer.byteLength(field, "utf8")}:`);
	hash.update(field, "utf8");
}

function updateSharedFramedField(
	hash: Hash,
	shared: Hash,
	field: string,
): void {
	hash.update(`${Buffer.byteLength(field, "utf8")}:`);
	for (let start = 0; start < field.length; ) {
		let end = Math.min(start + SHARED_CHUNK_CHARS, field.length);
		if (end < field.length && isHighSurrogate(field.charCodeAt(end - 1)))
			end -= 1;
		const bytes = Buffer.from(field.slice(start, end), "utf8");
		hash.update(bytes);
		shared.update(bytes);
		start = end;
	}
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}
