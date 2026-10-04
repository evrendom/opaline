import { z as zod } from "zod";

const observation = zod.number().finite().nullable();
const optionalObservation = observation.optional();
const slug = zod.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const total = zod.object({ total: optionalObservation }).nullable().optional();

export const aaPublicPayloadSchema = zod.object({
	models: zod
		.array(
			zod.object({
				id: zod.string().uuid(),
				slug,
				name: zod.string().min(1),
				creator: zod.object({
					id: zod.string().uuid(),
					slug,
					name: zod.string().min(1),
				}),
				release: zod.object({
					slug,
					name: zod.string().min(1),
					deprecatedTo: zod.string().nullable().optional(),
				}),
				releaseDate: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				isOpenWeights: zod.boolean(),
				deprecated: zod.boolean(),
				isReasoning: zod.boolean(),
				effort: zod
					.object({
						slug: zod.string(),
						label: zod.string(),
						level: zod.number(),
					})
					.nullable()
					.optional(),
				intelligenceIndex: observation,
				intelligenceIndexIsEstimated: zod.boolean(),
				intelligenceIndexCost: total,
				intelligenceIndexCostPerTask: zod
					.object({ cost: total })
					.nullable()
					.optional(),
				canonicalIntelligenceIndexTokenCount: zod
					.object({ output: optionalObservation })
					.nullable()
					.optional(),
				intelligenceIndexOutputTokensPerTask: zod
					.object({ output: optionalObservation })
					.nullable()
					.optional(),
				intelligenceIndexTimePerTask: optionalObservation,
				timescaleData: zod
					.object({ medianOutputSpeed: optionalObservation })
					.nullable()
					.optional(),
				price1mInputTokens: optionalObservation,
				price1mOutputTokens: optionalObservation,
				contextWindowTokens: optionalObservation,
			}),
		)
		.min(1),
});

export const aaRecordSchema = zod
	.object({
		id: zod.string().uuid(),
		slug,
		name: zod.string().min(1),
		releaseSlug: slug,
		creatorId: zod.string().uuid(),
		creatorSlug: slug,
		creatorName: zod.string().min(1),
		releasedAt: zod.string(),
		openWeights: zod.boolean(),
		deprecated: zod.boolean(),
		deprecatedTo: zod.string().nullable(),
		isReasoning: zod.boolean().nullable(),
		reasoningSetting: zod.string().nullable(),
		effortLabel: zod.string().nullable(),
		effortOrder: zod.number().nullable(),
		estimated: zod.boolean(),
		intelligence: observation,
		costPerTaskUsd: observation,
		totalCostUsd: observation,
		outputTokensPerTask: observation,
		totalOutputTokens: observation,
		timePerTaskSeconds: observation,
		outputSpeed: observation,
		inputPrice: observation,
		outputPrice: observation,
		contextWindow: observation,
	})
	.strict();

export const aaReleaseSchema = zod
	.object({
		source: zod.literal("artificial_analysis"),
		fetchedAt: zod.string().datetime(),
		sourceUrl: zod.literal("https://artificialanalysis.ai/models"),
		sourceSha256: zod.string().regex(/^[a-f0-9]{64}$/),
		indexVersion: zod.string().nullable(),
		records: zod.array(aaRecordSchema).min(1),
	})
	.strict()
	.superRefine((release, context) => {
		if (
			new Set(release.records.map((record) => record.id)).size !==
				release.records.length ||
			new Set(release.records.map((record) => record.slug)).size !==
				release.records.length
		)
			context.addIssue({
				code: zod.ZodIssueCode.custom,
				message: "Duplicate AA variant identity",
			});
	});

export type AaRelease = zod.infer<typeof aaReleaseSchema>;
export type AaRecord = zod.infer<typeof aaRecordSchema>;
