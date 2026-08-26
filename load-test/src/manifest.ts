import { relative, resolve } from "node:path";
import {
	type GeneratedTranscriptObject,
	MANIFEST_VERSION,
	MAX_AGGREGATE_BYTES,
	MAX_SUBAGENT_COUNT,
	type TranscriptManifest,
} from "./types.ts";

export interface ResolvedTranscriptObject extends GeneratedTranscriptObject {
	readonly absolutePath: string;
}

export interface LoadedTranscriptManifest {
	readonly directory: string;
	readonly manifest: TranscriptManifest;
	readonly objects: readonly ResolvedTranscriptObject[];
}

export async function loadAndVerifyManifest(
	manifestPath: string,
): Promise<LoadedTranscriptManifest> {
	const absoluteManifestPath = resolve(manifestPath);
	const directory = resolve(absoluteManifestPath, "..");
	const raw: unknown = JSON.parse(await Bun.file(absoluteManifestPath).text());
	const manifest = parseTranscriptManifest(raw);
	const objects = manifest.objects.map((object) => ({
		...object,
		absolutePath: resolveContainedPath(directory, object.path),
	}));

	for (const object of objects) {
		const file = Bun.file(object.absolutePath);
		if (!(await file.exists())) {
			throw new Error(`Transcript object does not exist: ${object.path}`);
		}
		if (file.size !== object.byteLength) {
			throw new Error(
				`Transcript size mismatch for ${object.path}: manifest=${object.byteLength}, file=${file.size}`,
			);
		}
		const actualHash = await hashFile(object.absolutePath);
		if (actualHash !== object.sha256) {
			throw new Error(
				`Transcript SHA-256 mismatch for ${object.path}: manifest=${object.sha256}, file=${actualHash}`,
			);
		}
	}
	return { directory, manifest, objects };
}

export function parseTranscriptManifest(value: unknown): TranscriptManifest {
	if (!isRecord(value)) throw new Error("Manifest must be a JSON object");
	const manifestVersion = readNumber(value, "manifestVersion");
	if (manifestVersion !== MANIFEST_VERSION) {
		throw new Error(`Unsupported manifest version: ${manifestVersion}`);
	}
	const source = parseSource(readString(value.metadata, "source"));
	const entropy = parseEntropy(readString(value, "entropy"));
	const objectsValue = value.objects;
	if (!Array.isArray(objectsValue))
		throw new Error("Manifest objects must be an array");
	const objects = objectsValue.map(parseManifestObject);
	const mainObjects = objects.filter((object) => object.kind === "main");
	if (mainObjects.length !== 1) {
		throw new Error("Manifest must contain exactly one main transcript");
	}
	const subagentCount = readNumber(value, "subagentCount");
	assertIntegerRange(subagentCount, 0, MAX_SUBAGENT_COUNT, "subagentCount");
	if (objects.length !== subagentCount + 1) {
		throw new Error("Manifest object count does not match subagentCount");
	}
	const agentIds = objects.flatMap((object) =>
		object.agentId === null ? [] : [object.agentId],
	);
	if (new Set(agentIds).size !== agentIds.length) {
		throw new Error("Manifest subagent IDs must be unique");
	}
	if (new Set(objects.map((object) => object.path)).size !== objects.length) {
		throw new Error("Manifest object paths must be unique");
	}
	const aggregateBytes = readNumber(value, "aggregateBytes");
	assertIntegerRange(aggregateBytes, 1, MAX_AGGREGATE_BYTES, "aggregateBytes");
	if (
		objects.reduce((total, object) => total + object.byteLength, 0) !==
		aggregateBytes
	) {
		throw new Error("Manifest aggregateBytes does not match its objects");
	}
	const timestampLines = readNumber(value, "timestampLines");
	assertIntegerRange(timestampLines, 0, 1_000_000, "timestampLines");
	const timestampStart = readString(value, "timestampStart");
	if (!Number.isFinite(Date.parse(timestampStart))) {
		throw new Error("Manifest timestampStart is invalid");
	}
	const metadataValue = value.metadata;
	if (!isRecord(metadataValue)) throw new Error("Manifest metadata is invalid");
	if (metadataValue.upload_mode !== "manual") {
		throw new Error("Manifest upload_mode must be manual");
	}

	return {
		aggregateBytes,
		entropy,
		manifestVersion: MANIFEST_VERSION,
		metadata: {
			projectPath: readString(metadataValue, "projectPath"),
			sessionId: readString(metadataValue, "sessionId"),
			source,
			upload_mode: "manual",
		},
		objects,
		seed: readString(value, "seed"),
		subagentCount,
		timestampLines,
		timestampStart,
	};
}

async function hashFile(path: string): Promise<string> {
	const hasher = new Bun.CryptoHasher("sha256");
	const reader = Bun.file(path).stream().getReader();
	while (true) {
		const result = await reader.read();
		if (result.done) break;
		hasher.update(result.value);
	}
	return hasher.digest("hex");
}

function parseSource(value: string): TranscriptManifest["metadata"]["source"] {
	if (value === "claude_code" || value === "codex") return value;
	throw new Error(`Unsupported transcript source: ${value}`);
}

function parseEntropy(value: string): TranscriptManifest["entropy"] {
	if (value === "low" || value === "medium" || value === "high") return value;
	throw new Error(`Unsupported entropy level: ${value}`);
}

function parseManifestObject(value: unknown): GeneratedTranscriptObject {
	if (!isRecord(value)) throw new Error("Manifest object entry is invalid");
	const kind = readString(value, "kind");
	if (kind !== "main" && kind !== "subagent") {
		throw new Error(`Unsupported manifest object kind: ${kind}`);
	}
	const byteLength = readNumber(value, "byteLength");
	assertIntegerRange(byteLength, 1, MAX_AGGREGATE_BYTES, "object byteLength");
	const sha256 = readString(value, "sha256");
	if (!/^[a-f0-9]{64}$/u.test(sha256)) {
		throw new Error("Manifest object SHA-256 is invalid");
	}
	const agentId = value.agentId;
	if (
		(kind === "main" && agentId !== null) ||
		(kind === "subagent" &&
			(typeof agentId !== "string" || !agentId || agentId.length > 200))
	) {
		throw new Error("Manifest object agentId does not match its kind");
	}
	return {
		agentId: typeof agentId === "string" ? agentId : null,
		byteLength,
		kind,
		path: readString(value, "path"),
		sha256,
	};
}

function resolveContainedPath(directory: string, path: string): string {
	const absolutePath = resolve(directory, path);
	const relativePath = relative(directory, absolutePath);
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
	) {
		throw new Error(`Manifest path escapes its directory: ${path}`);
	}
	return absolutePath;
}

function readString(value: unknown, key: string): string {
	if (!isRecord(value) || typeof value[key] !== "string" || !value[key]) {
		throw new Error(`Manifest ${key} must be a non-empty string`);
	}
	return value[key];
}

function readNumber(value: unknown, key: string): number {
	if (!isRecord(value) || typeof value[key] !== "number") {
		throw new Error(`Manifest ${key} must be a number`);
	}
	return value[key];
}

function assertIntegerRange(
	value: number,
	minimum: number,
	maximum: number,
	name: string,
): void {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
