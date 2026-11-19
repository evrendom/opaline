import { z as zod } from "zod";

/**
 * Slopalytics' published T3 Code usage snapshot. The Claude Code vs Codex
 * balance shows its numbers as published; nothing is re-derived or re-priced.
 */

/** The T3 Code providers the Claude Code vs Codex balance compares. */
export const T3_HARNESS_PROVIDERS = {
	claudeAgent: "claude-code",
	codex: "codex",
} as const;

export type T3HarnessProvider = keyof typeof T3_HARNESS_PROVIDERS;

const day = zod.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = zod.number().int().nonnegative();
const tokens = zod.number().finite().nonnegative();

// Only the fields the balance uses are validated; T3 adds fields freely.
const sentSchema = zod.object({
	day,
	harness: zod.string().min(1),
	turns: count,
	installs: count,
	excludedTurns: count,
});

const metricSchema = zod.object({
	day,
	harness: zod.string().min(1),
	model: zod.string().min(1),
	tokenTurns: count,
	input: tokens,
	output: tokens,
	pricedTurns: count,
	estimatedCost: zod.number().finite().nonnegative(),
});

// Version 3 adds per-model turns, completion and cache figures; the rows
// read here are unchanged.
export const t3PublicSnapshotSchema = zod.object({
	schemaVersion: zod.union([zod.literal(1), zod.literal(2), zod.literal(3)]),
	fetchedAt: zod.string().datetime({ offset: true }),
	start: day,
	endExclusive: day,
	project: zod.string(),
	timezone: zod.literal("UTC"),
	source: zod.string().url(),
	runawayThreshold: count,
	sent: zod.array(sentSchema),
	metrics: zod.array(metricSchema),
});

/**
 * The local capture: the published snapshot's Claude Code and Codex rows,
 * unchanged, with our own provenance. Other harnesses are dropped.
 */
export const t3UsageReleaseSchema = zod.object({
	source: zod.literal("t3_code"),
	fetchedAt: zod.string().datetime(),
	sourceUrl: zod.string().url(),
	sourceSha256: zod.string().regex(/^[a-f0-9]{64}$/),
	upstream: zod.object({
		fetchedAt: zod.string().datetime({ offset: true }),
		project: zod.string(),
		source: zod.string().url(),
		start: day,
		endExclusive: day,
		runawayThreshold: count,
	}),
	sent: zod.array(sentSchema),
	metrics: zod.array(metricSchema),
});

export type T3PublicSnapshot = zod.infer<typeof t3PublicSnapshotSchema>;
export type T3UsageRelease = zod.infer<typeof t3UsageReleaseSchema>;

export function isT3HarnessProvider(
	harness: string,
): harness is T3HarnessProvider {
	return Object.hasOwn(T3_HARNESS_PROVIDERS, harness);
}
