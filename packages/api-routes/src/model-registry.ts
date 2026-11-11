import { MODEL_RATE_CARD } from "./model-rate-card.js";
import {
	AA_FAMILY_IDENTITIES,
	AA_VARIANT_OVERRIDES,
	FAMILY_LINES,
} from "./model-registry-aa.js";
import type { AaRecord } from "./trends-aa-release.js";

export type ModelEffort =
	| "none"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max"
	| "default";
export type ModelLab =
	| "anthropic"
	| "openai"
	| "google"
	| "xai"
	| "deepseek"
	| "meta"
	| "kimi"
	| "zai"
	| "alibaba"
	| "xiaomi"
	| "stepfun"
	| "minimax"
	| "mistral"
	| "nvidia"
	| "inception"
	| "other";

export interface ModelFamily {
	readonly id: string;
	readonly displayName: string;
	readonly shortName: string;
	readonly lab: ModelLab;
	readonly creator: string;
	readonly releasedAt: string | null;
	readonly line: string | null;
	readonly openWeights: boolean;
	readonly challenger: boolean;
	readonly deprecatedAt: string | null;
	readonly harness: "claude_code" | "codex" | null;
	readonly aaReleaseSlug: string;
	readonly defaultEffort: ModelEffort;
	readonly aaBaseEffort: ModelEffort;
}

export interface ModelVariant {
	readonly familyId: string;
	readonly effort: ModelEffort;
	readonly effortOrder: number;
	readonly aaId: string | null;
	readonly aaSlug: string;
}

export const MODEL_EFFORT_ORDER: Readonly<Record<ModelEffort, number>> = {
	none: 0,
	low: 20,
	medium: 30,
	high: 40,
	xhigh: 50,
	max: 60,
	default: 10,
};

const CURATED_FAMILIES: readonly ModelFamily[] = [
	family(
		"claude-opus-5-5",
		"Claude Opus 5.5",
		"anthropic",
		"Anthropic",
		"2026-09-22",
		"max",
	),
	family(
		"claude-sonnet-5-5",
		"Claude Sonnet 5.5",
		"anthropic",
		"Anthropic",
		"2026-09-28",
		"max",
	),
	family(
		"claude-fable-5-2",
		"Claude Fable 5.2",
		"anthropic",
		"Anthropic",
		"2026-11-09",
		"max",
	),
	family(
		"claude-fable-5-1",
		"Claude Fable 5.1",
		"anthropic",
		"Anthropic",
		"2026-09-01",
		"max",
	),
	family(
		"claude-haiku-4-5-20251001",
		"Claude Haiku 4.5",
		"anthropic",
		"Anthropic",
		"2025-10-15",
		"none",
		false,
		"claude-4-5-haiku",
	),
	family("gpt-6-astra", "GPT-6 Astra", "openai", "OpenAI", "2026-09-03", "max"),
	family(
		"gpt-6.1-sol",
		"GPT-6.1 Sol",
		"openai",
		"OpenAI",
		"2026-09-29",
		"max",
		false,
		"gpt-6-1-sol",
	),
	family("gpt-6-luna", "GPT-6 Luna", "openai", "OpenAI", "2026-09-22", "max"),
	family(
		"gpt-5.6-sol",
		"GPT-5.6 Sol",
		"openai",
		"OpenAI",
		"2026-07-09",
		"max",
		false,
		"gpt-5-6-sol",
	),
	family(
		"gemini-4-argon",
		"Gemini 4 Argon",
		"google",
		"Google",
		"2026-09-30",
		"high",
		true,
	),
	family(
		"grok-4-7",
		"Grok 4.7",
		"xai",
		"SpaceXAI",
		"2026-09-21",
		"xhigh",
		true,
	),
	family(
		"muse-spark-1-3",
		"Muse Spark 1.3",
		"meta",
		"Meta",
		"2026-09-02",
		"max",
		true,
	),
];

const RATE_CARD_RELEASE_DATES: Readonly<Record<string, string>> = {
	"claude-3-5-haiku-20241022": "2024-10-22",
	"claude-3-7-sonnet-20250219": "2025-02-24",
	"claude-3-haiku-20240307": "2024-03-04",
	"claude-3-opus-20240229": "2024-03-04",
	"claude-3-sonnet-20240229": "2024-03-04",
	"claude-fable-5": "2026-06-09",
	"claude-opus-4-5-20251101": "2025-11-24",
	"claude-opus-4-6": "2026-02-05",
	"claude-opus-4-7": "2026-04-16",
	"claude-opus-4-8": "2026-05-28",
	"claude-opus-5": "2026-07-24",
	"claude-sonnet-4-6": "2026-02-17",
	"claude-sonnet-5": "2026-06-30",
	"gpt-4.1": "2025-04-14",
	"gpt-5": "2025-08-07",
	"gpt-5-codex": "2025-09-23",
	"gpt-5.1": "2025-11-13",
	"gpt-5.1-codex": "2025-11-13",
	"gpt-5.1-codex-mini": "2025-11-13",
	"gpt-5.2": "2025-12-11",
	"gpt-5.2-codex": "2025-12-11",
	"gpt-5.3-codex": "2026-02-05",
	"gpt-5.4": "2026-03-05",
	"gpt-5.4-mini": "2026-03-17",
	"gpt-5.4-nano": "2026-03-17",
	"gpt-5.4-pro": "2026-03-05",
	"gpt-5.5": "2026-04-23",
	"gpt-5.5-pro": "2026-04-23",
	"gpt-5.6-luna": "2026-07-09",
	"gpt-5.6-terra": "2026-07-09",
	o3: "2025-04-16",
	"o4-mini": "2025-04-16",
};

export const MODEL_REGISTRY: Readonly<Record<string, ModelFamily>> =
	Object.fromEntries([
		...MODEL_RATE_CARD.filter(
			(entry, index, entries) =>
				entries.findIndex((candidate) => candidate.model === entry.model) ===
				index,
		).map((entry): [string, ModelFamily] => [
			entry.model,
			{
				id: entry.model,
				displayName: entry.displayName,
				shortName: entry.displayName.replace(/^Claude /, ""),
				lab: entry.provider,
				creator: entry.provider === "anthropic" ? "Anthropic" : "OpenAI",
				releasedAt: RATE_CARD_RELEASE_DATES[entry.model] ?? null,
				line: FAMILY_LINES[entry.model] ?? null,
				openWeights: false,
				challenger: false,
				deprecatedAt: null,
				harness: entry.provider === "anthropic" ? "claude_code" : "codex",
				aaReleaseSlug: entry.model.replaceAll(".", "-").replace(/-\d{8}$/, ""),
				defaultEffort: "default",
				aaBaseEffort: "default",
			},
		]),
		...CURATED_FAMILIES.map((entry): [string, ModelFamily] => [
			entry.id,
			entry,
		]),
		...AA_FAMILY_IDENTITIES.map((entry): [string, ModelFamily] => [
			entry.id,
			{
				...family(
					entry.id,
					entry.displayName,
					entry.lab,
					entry.creator,
					entry.releasedAt,
					entry.aaBaseEffort,
					false,
					entry.aaReleaseSlug,
				),
				line: entry.line,
				openWeights: entry.openWeights,
			},
		]),
	]);

export const MODEL_VARIANTS: readonly ModelVariant[] = AA_VARIANT_OVERRIDES.map(
	([familyId, effort, aaSlug, aaId]) => ({
		familyId,
		effort,
		aaSlug,
		aaId,
		effortOrder: MODEL_EFFORT_ORDER[effort],
	}),
);

export function resolveAaVariant(record: {
	id: string;
	slug: string;
	name: string;
	releaseSlug: string;
	creatorSlug: string;
	isReasoning: boolean | null;
	reasoningSetting: string | null;
}) {
	const override =
		MODEL_VARIANTS.find((variant) => variant.aaId === record.id) ??
		MODEL_VARIANTS.find((variant) => variant.aaSlug === record.slug);
	if (override)
		return MODEL_REGISTRY[override.familyId]?.lab === record.creatorSlug
			? override
			: null;
	const entry = Object.values(MODEL_REGISTRY).find(
		(candidate) =>
			candidate.aaReleaseSlug === record.releaseSlug &&
			candidate.lab === record.creatorSlug,
	);
	if (!entry) return null;
	const effort = parseAaEffort(
		record.reasoningSetting ?? `${record.name} ${record.slug}`,
		record.isReasoning,
	);
	return {
		familyId: entry.id,
		effort,
		effortOrder: MODEL_EFFORT_ORDER[effort],
		aaId: record.id,
		aaSlug: record.slug,
	};
}

export function resolveAaReleaseIdentity(record: AaRecord): {
	readonly family: ModelFamily;
	readonly variant: ModelVariant;
} {
	const variant = resolveAaVariant(record);
	const registered = variant ? MODEL_REGISTRY[variant.familyId] : undefined;
	if (variant && registered) return { family: registered, variant };
	const id = `aa-${record.creatorId}-${record.releaseSlug}`;
	const effort = parseAaEffort(
		record.reasoningSetting ?? "",
		record.isReasoning,
	);
	return {
		family: {
			id,
			displayName: record.name.replace(/ \([^)]*\)$/, ""),
			shortName: record.releaseSlug,
			lab:
				Object.values(MODEL_REGISTRY).find(
					(entry) => entry.lab === record.creatorSlug,
				)?.lab ?? "other",
			creator: record.creatorName,
			releasedAt: record.releasedAt,
			line: null,
			openWeights: record.openWeights,
			challenger: false,
			deprecatedAt: null,
			harness: null,
			aaReleaseSlug: record.releaseSlug,
			defaultEffort: "default",
			aaBaseEffort: effort,
		},
		variant: {
			familyId: id,
			effort,
			effortOrder: MODEL_EFFORT_ORDER[effort],
			aaId: record.id,
			aaSlug: record.slug,
		},
	};
}

export function parseAaEffort(
	value: string,
	isReasoning: boolean | null,
): ModelEffort {
	if (/non[- ]reasoning|\bnone\b/i.test(value) || isReasoning === false)
		return "none";
	for (const effort of ["xhigh", "max", "high", "medium", "low"] as const) {
		if (
			new RegExp(
				`^${effort}$|\\(${effort}\\b|\\b${effort}\\s+effort\\b|[-_]${effort}(?:$|\\s)`,
				"i",
			).test(value.trim())
		)
			return effort;
	}
	return "default";
}

function family(
	id: string,
	displayName: string,
	lab: ModelLab,
	creator: string,
	releasedAt: string,
	aaBaseEffort: ModelEffort,
	challenger = false,
	aaReleaseSlug = id,
): ModelFamily {
	return {
		id,
		displayName,
		shortName: displayName.replace(/^Claude /, ""),
		lab,
		creator,
		releasedAt,
		line: FAMILY_LINES[id] ?? null,
		openWeights: false,
		challenger,
		deprecatedAt: null,
		harness:
			lab === "anthropic" ? "claude_code" : lab === "openai" ? "codex" : null,
		aaReleaseSlug,
		defaultEffort:
			id === "claude-opus-5-5" || lab === "openai"
				? "medium"
				: lab === "anthropic" && aaBaseEffort !== "none"
					? "high"
					: lab === "anthropic"
						? "none"
						: "default",
		aaBaseEffort,
	};
}
