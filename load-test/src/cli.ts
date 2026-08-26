import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateTranscriptCorpus } from "./generator.ts";
import { loadAndVerifyManifest } from "./manifest.ts";
import { executeLoadTest } from "./protocol.ts";
import { parseSafeTarget } from "./safety.ts";
import {
	ENTROPY_LEVELS,
	type EntropyLevel,
	MAX_AGGREGATE_BYTES,
	TRANSCRIPT_SOURCES,
	type TranscriptSource,
} from "./types.ts";

const DEFAULT_BASE_URL = "http://127.0.0.1:4010";
const DEFAULT_MAX_IN_FLIGHT = 512;
const DEFAULT_SUMMARY_PATH = "/tmp/opaline-r2-load-test-summary.json";
const DEFAULT_TIMESTAMP_START = "2026-08-25T12:00:00.000Z";
const MAX_UPLOADS = 10_000;
const MEBIBYTE = 1024 * 1024;

interface ParsedArguments {
	readonly flags: ReadonlySet<string>;
	readonly values: ReadonlyMap<string, readonly string[]>;
}

export async function main(arguments_: readonly string[]): Promise<number> {
	const command = arguments_[0];
	if (!command || command === "help" || command === "--help") {
		printHelp();
		return 0;
	}
	const argumentsWithoutCommand = arguments_.slice(1);
	if (command === "generate") {
		await runGenerateCommand(
			parseArguments(argumentsWithoutCommand, ["--help"]),
		);
		return 0;
	}
	if (command === "run") {
		return runDriverCommand(
			parseArguments(argumentsWithoutCommand, [
				"--allow-remote",
				"--barrier-before-commit",
				"--help",
				"--same-session-hash",
			]),
		);
	}
	throw new Error(`Unknown command: ${command}`);
}

async function runGenerateCommand(arguments_: ParsedArguments): Promise<void> {
	if (arguments_.flags.has("--help")) {
		printGenerateHelp();
		return;
	}
	assertAllowedArguments(arguments_, [
		"--entropy",
		"--output",
		"--seed",
		"--size-bytes",
		"--size-mib",
		"--source",
		"--subagents",
		"--timestamp-lines",
		"--timestamp-start",
	]);
	const sizeBytes = getOptionalValue(arguments_, "--size-bytes");
	const sizeMib = getOptionalValue(arguments_, "--size-mib");
	if ((sizeBytes === undefined) === (sizeMib === undefined)) {
		throw new Error("Pass exactly one of --size-bytes or --size-mib");
	}
	const totalBytes =
		sizeBytes === undefined
			? Math.round(parsePositiveNumber(sizeMib ?? "", "--size-mib") * MEBIBYTE)
			: parseInteger(sizeBytes, "--size-bytes", 1, MAX_AGGREGATE_BYTES);
	if (totalBytes > MAX_AGGREGATE_BYTES) {
		throw new Error("Transcript size cannot exceed 128 MiB");
	}
	const source = parseSource(
		getOptionalValue(arguments_, "--source") ?? "claude_code",
	);
	const entropy = parseEntropy(
		getOptionalValue(arguments_, "--entropy") ?? "low",
	);
	const manifest = await generateTranscriptCorpus({
		entropy,
		outputDirectory: resolve(getRequiredValue(arguments_, "--output")),
		seed: getRequiredValue(arguments_, "--seed"),
		source,
		subagentCount: parseInteger(
			getOptionalValue(arguments_, "--subagents") ?? "0",
			"--subagents",
			0,
			512,
		),
		timestampLines: parseInteger(
			getOptionalValue(arguments_, "--timestamp-lines") ?? "2",
			"--timestamp-lines",
			0,
			1_000_000,
		),
		timestampStart:
			getOptionalValue(arguments_, "--timestamp-start") ??
			DEFAULT_TIMESTAMP_START,
		totalBytes,
	});
	console.log(
		`Generated ${manifest.aggregateBytes} bytes across ${manifest.objects.length} object(s).`,
	);
	console.log(
		`Manifest: ${resolve(getRequiredValue(arguments_, "--output"), "manifest.json")}`,
	);
}

async function runDriverCommand(arguments_: ParsedArguments): Promise<number> {
	if (arguments_.flags.has("--help")) {
		printRunHelp();
		return 0;
	}
	assertAllowedArguments(arguments_, [
		"--allow-remote",
		"--api-key-file",
		"--barrier-before-commit",
		"--base-url",
		"--clickhouse-password-file",
		"--clickhouse-settle-ms",
		"--clickhouse-url",
		"--clickhouse-user",
		"--commit-attempts",
		"--concurrency",
		"--confirm-clickhouse-target",
		"--confirm-target",
		"--manifest",
		"--max-clickhouse-part-delta",
		"--max-e2e-p95-ms",
		"--max-failures",
		"--max-first-commit-p95-ms",
		"--max-in-flight",
		"--max-non-terminal-jobs",
		"--max-peak-rss-mib",
		"--max-schedule-drift-ms",
		"--max-transport-failures",
		"--min-achieved-start-rate",
		"--organization-id",
		"--part-concurrency",
		"--processing-pid",
		"--rate-per-second",
		"--request-timeout-ms",
		"--same-session-hash",
		"--scenario-name",
		"--status-wait-ms",
		"--summary-json",
		"--uploads",
	]);
	const allowRemote = arguments_.flags.has("--allow-remote");
	const baseUrl = parseSafeTarget({
		allowRemote,
		confirmTarget: getOptionalValue(arguments_, "--confirm-target"),
		label: "API base URL",
		rawUrl: getOptionalValue(arguments_, "--base-url") ?? DEFAULT_BASE_URL,
	});
	const clickHouseObserver = await parseClickHouseObserver(
		arguments_,
		allowRemote,
	);
	const manifest = await loadAndVerifyManifest(
		getRequiredValue(arguments_, "--manifest"),
	);
	const maxPeakRssMib = parseOptionalNonNegativeNumber(
		arguments_,
		"--max-peak-rss-mib",
	);
	const passed = await executeLoadTest({
		apiKey: await readSecretFile(
			getRequiredValue(arguments_, "--api-key-file"),
			"API key",
		),
		barrierBeforeCommit: arguments_.flags.has("--barrier-before-commit"),
		baseUrl,
		clickHouseObserver,
		clickHouseSettleMs: parseInteger(
			getOptionalValue(arguments_, "--clickhouse-settle-ms") ?? "10000",
			"--clickhouse-settle-ms",
			0,
			600_000,
		),
		commitAttempts: parseInteger(
			getOptionalValue(arguments_, "--commit-attempts") ?? "10",
			"--commit-attempts",
			1,
			100,
		),
		concurrency: parseInteger(
			getOptionalValue(arguments_, "--concurrency") ?? "1",
			"--concurrency",
			1,
			512,
		),
		manifest,
		maxInFlight: parseInteger(
			getOptionalValue(arguments_, "--max-in-flight") ??
				DEFAULT_MAX_IN_FLIGHT.toString(),
			"--max-in-flight",
			1,
			MAX_UPLOADS,
		),
		organizationId: getOptionalValue(arguments_, "--organization-id"),
		partConcurrency: parseInteger(
			getOptionalValue(arguments_, "--part-concurrency") ?? "4",
			"--part-concurrency",
			1,
			512,
		),
		processingPids: getValues(arguments_, "--processing-pid").map((value) =>
			parseInteger(value, "--processing-pid", 1, Number.MAX_SAFE_INTEGER),
		),
		ratePerSecond: parseOptionalPositiveNumber(arguments_, "--rate-per-second"),
		requestTimeoutMs: parseInteger(
			getOptionalValue(arguments_, "--request-timeout-ms") ?? "900000",
			"--request-timeout-ms",
			1_000,
			1_800_000,
		),
		sameSessionHash: arguments_.flags.has("--same-session-hash"),
		scenarioName: getOptionalValue(arguments_, "--scenario-name") ?? "manual",
		statusWaitMs: parseInteger(
			getOptionalValue(arguments_, "--status-wait-ms") ?? "30000",
			"--status-wait-ms",
			0,
			600_000,
		),
		summaryPath: resolve(
			getOptionalValue(arguments_, "--summary-json") ?? DEFAULT_SUMMARY_PATH,
		),
		thresholds: {
			maxClickHousePartDelta: parseOptionalNonNegativeInteger(
				arguments_,
				"--max-clickhouse-part-delta",
			),
			maxE2eP95Ms: parseOptionalNonNegativeNumber(
				arguments_,
				"--max-e2e-p95-ms",
			),
			maxFailures: parseInteger(
				getOptionalValue(arguments_, "--max-failures") ?? "0",
				"--max-failures",
				0,
				MAX_UPLOADS,
			),
			maxFirstCommitP95Ms: parseOptionalNonNegativeNumber(
				arguments_,
				"--max-first-commit-p95-ms",
			),
			maxNonTerminalJobs: parseInteger(
				getOptionalValue(arguments_, "--max-non-terminal-jobs") ?? "0",
				"--max-non-terminal-jobs",
				0,
				MAX_UPLOADS,
			),
			maxPeakRssBytes:
				maxPeakRssMib === null ? null : Math.round(maxPeakRssMib * MEBIBYTE),
			maxScheduleDriftMs: parseOptionalNonNegativeNumber(
				arguments_,
				"--max-schedule-drift-ms",
			),
			maxTransportFailures: parseInteger(
				getOptionalValue(arguments_, "--max-transport-failures") ?? "0",
				"--max-transport-failures",
				0,
				Number.MAX_SAFE_INTEGER,
			),
			minAchievedStartRate: parseOptionalPositiveNumber(
				arguments_,
				"--min-achieved-start-rate",
			),
		},
		uploads: parseInteger(
			getOptionalValue(arguments_, "--uploads") ?? "1",
			"--uploads",
			1,
			MAX_UPLOADS,
		),
	});
	return passed ? 0 : 1;
}

async function parseClickHouseObserver(
	arguments_: ParsedArguments,
	allowRemote: boolean,
) {
	const rawUrl = getOptionalValue(arguments_, "--clickhouse-url");
	const passwordFile = getOptionalValue(
		arguments_,
		"--clickhouse-password-file",
	);
	const user = getOptionalValue(arguments_, "--clickhouse-user");
	const supplied = [rawUrl, passwordFile, user].filter(
		(value) => value !== undefined,
	).length;
	if (supplied === 0) return null;
	if (!rawUrl || !passwordFile || !user) {
		throw new Error(
			"ClickHouse observation requires --clickhouse-url, --clickhouse-user, and --clickhouse-password-file together",
		);
	}
	return {
		password: await readSecretFile(passwordFile, "ClickHouse password"),
		url: parseSafeTarget({
			allowRemote,
			confirmTarget: getOptionalValue(
				arguments_,
				"--confirm-clickhouse-target",
			),
			label: "ClickHouse observer URL",
			rawUrl,
		}),
		user,
	};
}

function parseArguments(
	arguments_: readonly string[],
	booleanFlags: readonly string[],
): ParsedArguments {
	const flags = new Set<string>();
	const values = new Map<string, string[]>();
	for (let index = 0; index < arguments_.length; index += 1) {
		const key = arguments_[index];
		if (!key?.startsWith("--")) {
			throw new Error(
				`Expected an option beginning with --, received: ${key ?? ""}`,
			);
		}
		if (booleanFlags.includes(key)) {
			flags.add(key);
			continue;
		}
		const value = arguments_[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for ${key}`);
		}
		values.set(key, [...(values.get(key) ?? []), value]);
		index += 1;
	}
	return { flags, values };
}

function assertAllowedArguments(
	arguments_: ParsedArguments,
	allowed: readonly string[],
): void {
	for (const key of [...arguments_.flags, ...arguments_.values.keys()]) {
		if (!allowed.includes(key) && key !== "--help") {
			throw new Error(`Unknown option: ${key}`);
		}
	}
}

function getRequiredValue(arguments_: ParsedArguments, key: string): string {
	const value = getOptionalValue(arguments_, key);
	if (value === undefined) throw new Error(`Missing required option: ${key}`);
	return value;
}

function getOptionalValue(
	arguments_: ParsedArguments,
	key: string,
): string | undefined {
	const values = arguments_.values.get(key) ?? [];
	if (values.length > 1 && key !== "--processing-pid") {
		throw new Error(`${key} may only be passed once`);
	}
	return values[0];
}

function getValues(
	arguments_: ParsedArguments,
	key: string,
): readonly string[] {
	return arguments_.values.get(key) ?? [];
}

function parseSource(value: string): TranscriptSource {
	if (value === "claude_code" || value === "codex") return value;
	throw new Error(`--source must be one of: ${TRANSCRIPT_SOURCES.join(", ")}`);
}

function parseEntropy(value: string): EntropyLevel {
	if (value === "low" || value === "medium" || value === "high") return value;
	throw new Error(`--entropy must be one of: ${ENTROPY_LEVELS.join(", ")}`);
}

function parseInteger(
	value: string,
	name: string,
	minimum: number,
	maximum: number,
): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
	}
	return number;
}

function parsePositiveNumber(value: string, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) {
		throw new Error(`${name} must be a positive number`);
	}
	return number;
}

function parseOptionalPositiveNumber(
	arguments_: ParsedArguments,
	key: string,
): number | null {
	const value = getOptionalValue(arguments_, key);
	return value === undefined ? null : parsePositiveNumber(value, key);
}

function parseOptionalNonNegativeNumber(
	arguments_: ParsedArguments,
	key: string,
): number | null {
	const value = getOptionalValue(arguments_, key);
	if (value === undefined) return null;
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) {
		throw new Error(`${key} must be a non-negative number`);
	}
	return number;
}

function parseOptionalNonNegativeInteger(
	arguments_: ParsedArguments,
	key: string,
): number | null {
	const value = getOptionalValue(arguments_, key);
	return value === undefined
		? null
		: parseInteger(value, key, 0, Number.MAX_SAFE_INTEGER);
}

async function readSecretFile(path: string, label: string): Promise<string> {
	const value = (await readFile(resolve(path), "utf8")).trim();
	if (!value) throw new Error(`${label} file is empty`);
	return value;
}

function printHelp(): void {
	console.log(`Opaline R2 ingest load-test harness

Commands:
  bun load-test/src/cli.ts generate [options]
  bun load-test/src/cli.ts run [options]

Use '<command> --help' for command-specific options.`);
}

function printGenerateHelp(): void {
	console.log(`Generate deterministic Claude Code or Codex JSONL transcripts.

Required:
  --output <new-directory>
  --seed <string>
  --size-mib <number> | --size-bytes <integer>

Optional:
  --source claude_code|codex       default: claude_code
  --entropy low|medium|high        default: low
  --subagents <0..512>             default: 0
  --timestamp-lines <integer>      default: 2
  --timestamp-start <RFC3339>      deterministic; default: ${DEFAULT_TIMESTAMP_START}`);
}

function printRunHelp(): void {
	console.log(`Exercise init -> multipart upload -> commit -> status.

Required:
  --manifest <manifest.json>
  --api-key-file <path>

Target safety:
  --base-url <origin>              default: ${DEFAULT_BASE_URL}
  --allow-remote                   required for any non-loopback target
  --confirm-target <exact-origin>  second confirmation for a remote API

Load shape:
  --uploads <N>                    default: 1; maximum: ${MAX_UPLOADS}
  --concurrency <N>                default: 1
  --part-concurrency <N>           default: 4
  --barrier-before-commit
  --same-session-hash
  --rate-per-second <number>
  --max-in-flight <N>              open-loop safety cap; default: ${DEFAULT_MAX_IN_FLIGHT}
  --commit-attempts <N>            default: 10
  --processing-pid <PID>           repeat to sum API + worker RSS

Assertions:
  --max-failures <N>               default: 0
  --max-non-terminal-jobs <N>      default: 0
  --min-achieved-start-rate <rate>
  --max-schedule-drift-ms <number>
  --max-e2e-p95-ms <number>
  --max-first-commit-p95-ms <number>
  --max-peak-rss-mib <number>
  --max-clickhouse-part-delta <N>
  --max-transport-failures <N>     default: 0

ClickHouse observation (all required together):
  --clickhouse-url <origin>
  --clickhouse-user <name>
  --clickhouse-password-file <path>
  --confirm-clickhouse-target <exact-origin>  required when remote

Output:
  --summary-json <path>            default: ${DEFAULT_SUMMARY_PATH}
  --scenario-name <name>`);
}

if (import.meta.main) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
