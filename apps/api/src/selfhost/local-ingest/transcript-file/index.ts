import { dirname } from "node:path";
import { extractAgentIds, readSubagentFiles } from "@rudel/agent-adapters";
import { claudeSessionId } from "../sources.js";
import {
	compareStat,
	endsWithNewline,
	type FileIdentity,
	type FileStat,
	fingerprintAt,
	samePrefix,
	statTranscript,
	type WholeReason,
} from "./identity.js";
import {
	type CollectedImage,
	createImageCollector,
	type ImageCollector,
} from "./images.js";
import {
	type ReadRevision,
	rawLines,
	readLines,
	slimmedLines,
	slimText,
} from "./reader.js";

export type { FileIdentity, FileStat, WholeReason } from "./identity.js";
export { FINGERPRINT_BYTES, statTranscript } from "./identity.js";
export type { CollectedImage } from "./images.js";
export type TranscriptRevision = ReadRevision;

export type TranscriptChange =
	| {
			readonly kind: "unchanged" | "appended";
			readonly since: FileIdentity;
	  }
	| {
			readonly kind: "whole";
			readonly reason: WholeReason;
			readonly since: FileIdentity | null;
	  };

export type TranscriptCheck =
	| { readonly kind: "missing" }
	| { readonly kind: "writing"; readonly stat: FileStat }
	| {
			readonly kind: "ready";
			readonly stat: FileStat;
			readonly change: TranscriptChange;
	  };

export interface CheckOptions {
	readonly final: boolean;
	readonly now: number;
	readonly partialLineGraceMs: number;
}

export async function checkTranscript(
	path: string,
	stored: FileIdentity | null,
	options: CheckOptions,
): Promise<TranscriptCheck> {
	const stat = await statTranscript(path);
	if (!stat) return { kind: "missing" };
	if (
		!options.final &&
		options.now - stat.mtimeMs < options.partialLineGraceMs &&
		!(await endsWithNewline(path, stat.size))
	)
		return { kind: "writing", stat };
	return { kind: "ready", stat, change: await changeOf(path, stored, stat) };
}

async function changeOf(
	path: string,
	stored: FileIdentity | null,
	stat: FileStat,
): Promise<TranscriptChange> {
	const compared = compareStat(stored, stat);
	if (!stored || compared.kind === "whole")
		return {
			kind: "whole",
			reason: compared.kind === "whole" ? compared.reason : "new",
			since: stored,
		};
	if (compared.kind === "unchanged")
		return { kind: "unchanged", since: stored };
	if (!samePrefix(stored, await fingerprintAt(path, stored.size)))
		return { kind: "whole", reason: "rewritten", since: stored };
	if (compared.kind === "touched") return { kind: "unchanged", since: stored };
	return path.endsWith(".zst")
		? { kind: "whole", reason: "compressed", since: stored }
		: { kind: "appended", since: stored };
}

export async function identifyTranscript(
	path: string,
	stat: FileStat,
): Promise<FileIdentity | null> {
	const fingerprint = await fingerprintAt(path, stat.size);
	return fingerprint ? { ...stat, ...fingerprint } : null;
}

export interface SubagentTranscript {
	readonly agentId: string;
	readonly content: string;
}

export interface SessionRead {
	readonly content: string;
	readonly revision: TranscriptRevision;
	readonly subagents: () => Promise<readonly SubagentTranscript[]>;
	readonly images: () => readonly CollectedImage[];
	readonly files: () => readonly FileIdentity[];
}

export async function readSession(
	sessionPath: string,
	change: TranscriptChange | null,
): Promise<SessionRead> {
	const images = createImageCollector();
	const main = await readLines(
		sessionPath,
		change?.since ?? null,
		slimmedLines("", images),
	);
	const content = main.lines.join("\n");
	const files: FileIdentity[] = [main.identity];
	return {
		content,
		revision: main.revision,
		subagents: () => readSubagents(sessionPath, content, images, files),
		images: () => images.images(),
		files: () => files,
	};
}

async function readSubagents(
	sessionPath: string,
	content: string,
	images: ImageCollector,
	files: FileIdentity[],
): Promise<SubagentTranscript[]> {
	const subagents = await readSubagentFiles(
		dirname(sessionPath),
		extractAgentIds(content),
		claudeSessionId(sessionPath),
		{
			readFile: async (path) => {
				const read = await readLines(path, null, rawLines());
				files.push(read.identity);
				return read.lines.join("\n");
			},
		},
	);
	return subagents.map((subagent) => ({
		...subagent,
		content: slimText(subagent.content, subagent.agentId, images),
	}));
}
