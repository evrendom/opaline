import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createDeterministicBytes } from "./prng.ts";
import {
	type GeneratedTranscriptObject,
	type GenerateOptions,
	MANIFEST_VERSION,
	MAX_AGGREGATE_BYTES,
	MAX_SUBAGENT_COUNT,
	type TranscriptManifest,
	type TranscriptSource,
} from "./types.ts";

const FILLER_MARKER = "__OPALINE_LOAD_TEST_FILLER__";
const MAX_FILLER_BYTES_PER_LINE = 64 * 1024;
const DEFAULT_PROJECT_PATH = "/tmp/opaline-load-test";

interface LineTemplate {
	readonly prefix: Uint8Array;
	readonly suffix: Uint8Array;
}

interface LinePlan extends LineTemplate {
	fillerBytes: number;
}

interface GeneratedFile {
	readonly byteLength: number;
	readonly sha256: string;
}

export async function generateTranscriptCorpus(
	options: GenerateOptions,
): Promise<TranscriptManifest> {
	validateGenerateOptions(options);
	await mkdir(options.outputDirectory);
	const subagentDirectory = join(options.outputDirectory, "subagents");
	if (options.subagentCount > 0) await mkdir(subagentDirectory);

	const sessionId = createSessionId(options.seed, options.source);
	const mainMinimumBytes = getMinimumTranscriptBytes({
		sessionId,
		source: options.source,
		timestampLines: options.timestampLines,
		timestampStart: options.timestampStart,
	});
	const subagentMinimumBytes = getMinimumTranscriptBytes({
		sessionId,
		source: options.source,
		timestampLines: 0,
		timestampStart: options.timestampStart,
	});
	const objectSizes = distributeBytesWithMinimums(options.totalBytes, [
		mainMinimumBytes,
		...Array.from(
			{ length: options.subagentCount },
			() => subagentMinimumBytes,
		),
	]);
	const objects: GeneratedTranscriptObject[] = [];
	const mainPath = join(options.outputDirectory, "main.jsonl");
	const mainSize = objectSizes[0];
	if (mainSize === undefined)
		throw new Error("Main transcript size is missing");
	const main = await generateTranscriptFile({
		entropy: options.entropy,
		path: mainPath,
		seed: `${options.seed}:main`,
		sessionId,
		source: options.source,
		targetBytes: mainSize,
		timestampLines: options.timestampLines,
		timestampStart: options.timestampStart,
	});
	objects.push({
		agentId: null,
		byteLength: main.byteLength,
		kind: "main",
		path: basename(mainPath),
		sha256: main.sha256,
	});

	for (let index = 0; index < options.subagentCount; index += 1) {
		const agentId = `load-agent-${index.toString().padStart(3, "0")}`;
		const relativePath = join("subagents", `agent-${agentId}.jsonl`);
		const targetBytes = objectSizes[index + 1];
		if (targetBytes === undefined) {
			throw new Error(`Subagent ${index} transcript size is missing`);
		}
		const generated = await generateTranscriptFile({
			entropy: options.entropy,
			path: join(options.outputDirectory, relativePath),
			seed: `${options.seed}:subagent:${index}`,
			sessionId,
			source: options.source,
			targetBytes,
			timestampLines: 0,
			timestampStart: options.timestampStart,
		});
		objects.push({
			agentId,
			byteLength: generated.byteLength,
			kind: "subagent",
			path: relativePath,
			sha256: generated.sha256,
		});
	}

	const manifest: TranscriptManifest = {
		aggregateBytes: objects.reduce(
			(total, object) => total + object.byteLength,
			0,
		),
		entropy: options.entropy,
		manifestVersion: MANIFEST_VERSION,
		metadata: {
			projectPath: DEFAULT_PROJECT_PATH,
			sessionId,
			source: options.source,
			upload_mode: "manual",
		},
		objects,
		seed: options.seed,
		subagentCount: options.subagentCount,
		timestampLines: options.timestampLines,
		timestampStart: new Date(options.timestampStart).toISOString(),
	};
	await Bun.write(
		join(options.outputDirectory, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return manifest;
}

async function generateTranscriptFile(input: {
	readonly entropy: GenerateOptions["entropy"];
	readonly path: string;
	readonly seed: string;
	readonly sessionId: string;
	readonly source: TranscriptSource;
	readonly targetBytes: number;
	readonly timestampLines: number;
	readonly timestampStart: string;
}): Promise<GeneratedFile> {
	const templates = createRequiredTemplates(input);
	const plans = planLines(templates, input.targetBytes);
	const random = createDeterministicBytes(input.seed);
	const hasher = new Bun.CryptoHasher("sha256");
	const writer = Bun.file(input.path).writer({ highWaterMark: 1024 * 1024 });
	let byteLength = 0;

	for (const plan of plans) {
		for (const chunk of [
			plan.prefix,
			random.fill(plan.fillerBytes, input.entropy),
			plan.suffix,
		]) {
			writer.write(chunk);
			hasher.update(chunk);
			byteLength += chunk.byteLength;
		}
	}
	await writer.end();
	if (byteLength !== input.targetBytes) {
		throw new Error(
			`Generated ${byteLength} bytes for ${input.path}; expected ${input.targetBytes}`,
		);
	}
	return { byteLength, sha256: hasher.digest("hex") };
}

function createRequiredTemplates(input: {
	readonly sessionId: string;
	readonly source: TranscriptSource;
	readonly timestampLines: number;
	readonly timestampStart: string;
}): LineTemplate[] {
	if (input.timestampLines === 0) return [createPaddingTemplate()];
	const start = Date.parse(input.timestampStart);
	return Array.from({ length: input.timestampLines }, (_, index) =>
		createTimestampTemplate(
			input.source,
			input.sessionId,
			index,
			new Date(start + index * 1_000).toISOString(),
		),
	);
}

function getMinimumTranscriptBytes(input: {
	readonly sessionId: string;
	readonly source: TranscriptSource;
	readonly timestampLines: number;
	readonly timestampStart: string;
}): number {
	return createRequiredTemplates(input).reduce(
		(total, template) => total + getTemplateBytes(template),
		0,
	);
}

function planLines(
	requiredTemplates: readonly LineTemplate[],
	targetBytes: number,
): LinePlan[] {
	const plans = requiredTemplates.map((template) => ({
		...template,
		fillerBytes: 0,
	}));
	const requiredBytes = plans.reduce(
		(total, plan) => total + getTemplateBytes(plan),
		0,
	);
	if (requiredBytes > targetBytes) {
		throw new Error(
			`Target file size ${targetBytes} is too small for ${requiredTemplates.length} required JSONL lines (${requiredBytes} bytes minimum)`,
		);
	}

	let extraBytes = targetBytes - requiredBytes;
	const paddingTemplate = createPaddingTemplate();
	const paddingOverhead = getTemplateBytes(paddingTemplate);
	while (extraBytes > MAX_FILLER_BYTES_PER_LINE + paddingOverhead) {
		plans.push({
			...paddingTemplate,
			fillerBytes: MAX_FILLER_BYTES_PER_LINE,
		});
		extraBytes -= MAX_FILLER_BYTES_PER_LINE + paddingOverhead;
	}
	const finalPlan = plans.at(-1);
	if (!finalPlan) throw new Error("Transcript line plan is empty");
	finalPlan.fillerBytes += extraBytes;
	return plans;
}

function createTimestampTemplate(
	source: TranscriptSource,
	sessionId: string,
	index: number,
	timestamp: string,
): LineTemplate {
	if (source === "claude_code") {
		const isAssistant = index % 2 === 1;
		return createLineTemplate(
			isAssistant
				? {
						message: {
							content: [{ text: FILLER_MARKER, type: "text" }],
							model: "claude-sonnet-4-5",
							role: "assistant",
							usage: { input_tokens: 1, output_tokens: 1 },
						},
						sessionId,
						timestamp,
						type: "assistant",
						uuid: `load-assistant-${index}`,
					}
				: {
						message: { content: FILLER_MARKER, role: "user" },
						sessionId,
						timestamp,
						type: "user",
						uuid: `load-user-${index}`,
					},
		);
	}

	if (index === 0) {
		return createLineTemplate({
			payload: {
				cwd: DEFAULT_PROJECT_PATH,
				id: sessionId,
				loadTestData: FILLER_MARKER,
			},
			timestamp,
			type: "session_meta",
		});
	}
	const isAssistant = index % 2 === 0;
	return createLineTemplate({
		payload: {
			content: [
				{
					text: FILLER_MARKER,
					type: isAssistant ? "output_text" : "input_text",
				},
			],
			role: isAssistant ? "assistant" : "user",
			type: "message",
		},
		timestamp,
		type: "response_item",
	});
}

function createPaddingTemplate(): LineTemplate {
	return createLineTemplate({
		payload: FILLER_MARKER,
		type: "load_test_padding",
	});
}

function createLineTemplate(value: unknown): LineTemplate {
	const encoded = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
	const marker = new TextEncoder().encode(FILLER_MARKER);
	const markerOffset = findSubarray(encoded, marker);
	if (markerOffset === -1) {
		throw new Error("Transcript line template is missing its filler marker");
	}
	return {
		prefix: encoded.slice(0, markerOffset),
		suffix: encoded.slice(markerOffset + marker.byteLength),
	};
}

function findSubarray(haystack: Uint8Array, needle: Uint8Array): number {
	for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
		let matches = true;
		for (let index = 0; index < needle.length; index += 1) {
			if (haystack[offset + index] !== needle[index]) {
				matches = false;
				break;
			}
		}
		if (matches) return offset;
	}
	return -1;
}

function getTemplateBytes(template: LineTemplate): number {
	return template.prefix.byteLength + template.suffix.byteLength;
}

function distributeBytesWithMinimums(
	totalBytes: number,
	minimums: readonly number[],
): number[] {
	const requiredBytes = minimums.reduce((total, minimum) => total + minimum, 0);
	if (requiredBytes > totalBytes) {
		throw new Error(
			`Aggregate target ${totalBytes} is too small for the requested JSONL structure (${requiredBytes} bytes minimum)`,
		);
	}
	const extraBytes = totalBytes - requiredBytes;
	const extraPerObject = Math.floor(extraBytes / minimums.length);
	const remainder = extraBytes % minimums.length;
	return minimums.map(
		(minimum, index) => minimum + extraPerObject + (index < remainder ? 1 : 0),
	);
}

function createSessionId(seed: string, source: TranscriptSource): string {
	const digest = new Bun.CryptoHasher("sha256")
		.update(`${source}:${seed}`)
		.digest("hex")
		.slice(0, 24);
	return `load-${source.replace("_", "-")}-${digest}`;
}

function validateGenerateOptions(options: GenerateOptions): void {
	if (!options.seed.trim()) throw new Error("--seed must not be empty");
	assertIntegerInRange(
		options.totalBytes,
		1,
		MAX_AGGREGATE_BYTES,
		"transcript bytes",
	);
	assertIntegerInRange(
		options.subagentCount,
		0,
		MAX_SUBAGENT_COUNT,
		"subagent count",
	);
	assertIntegerInRange(
		options.timestampLines,
		0,
		1_000_000,
		"timestamp line count",
	);
	const timestamp = Date.parse(options.timestampStart);
	if (!Number.isFinite(timestamp)) {
		throw new Error("--timestamp-start must be a valid RFC 3339 timestamp");
	}
}

function assertIntegerInRange(
	value: number,
	minimum: number,
	maximum: number,
	name: string,
): void {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
	}
}
