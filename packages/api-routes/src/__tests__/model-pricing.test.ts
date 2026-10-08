import { describe, expect, it } from "bun:test";
import {
	buildEstimatedCostSql,
	calculateEstimatedCost,
	getLongContextThresholdTokens,
	renderModelPricingTable,
	resolveCanonicalModelIdentity,
	resolveModelPricing,
} from "../model-pricing.js";
import { MODEL_RATE_CARD, MODEL_RATE_MODIFIERS } from "../model-rate-card.js";

describe("model rate card", () => {
	it("has valid patterns, periods, provenance, and positive rates", () => {
		for (const entry of MODEL_RATE_CARD) {
			expect(entry.match.length).toBeGreaterThan(0);
			for (const pattern of entry.match) {
				const expression = new RegExp(pattern, "u");
				expect(expression.test(entry.model)).toBe(true);
			}

			expect(entry.inputPerMTok).toBeGreaterThan(0);
			expect(entry.outputPerMTok).toBeGreaterThan(0);
			for (const rate of [
				entry.cacheReadPerMTok,
				entry.cacheWrite5mPerMTok,
				entry.cacheWrite1hPerMTok,
			]) {
				if (rate !== null) {
					expect(rate).toBeGreaterThan(0);
				}
			}

			if (entry.cacheReadPerMTok !== null) {
				expect(entry.cacheReadPerMTok).toBeLessThan(entry.inputPerMTok);
			}

			expect(new URL(entry.source).protocol).toBe("https:");
			expect(entry.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(entry.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			if (entry.effectiveTo !== undefined) {
				expect(entry.effectiveTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(entry.effectiveFrom < entry.effectiveTo).toBe(true);
			}
		}
	});

	it("has no overlapping effective periods per model and context band", () => {
		const periodsByModel = new Map<
			string,
			Array<{ effectiveFrom: string; effectiveTo?: string }>
		>();

		for (const entry of MODEL_RATE_CARD) {
			const key = `${entry.model}:${entry.contextBand}`;
			const periods = periodsByModel.get(key) ?? [];
			periods.push({
				effectiveFrom: entry.effectiveFrom,
				effectiveTo: entry.effectiveTo,
			});
			periodsByModel.set(key, periods);
		}

		for (const periods of periodsByModel.values()) {
			const chronological = [...periods].sort((left, right) =>
				left.effectiveFrom.localeCompare(right.effectiveFrom),
			);

			for (let index = 1; index < chronological.length; index += 1) {
				const previous = chronological[index - 1];
				const current = chronological[index];
				const previousEnd = previous?.effectiveTo ?? "";
				expect(previousEnd).not.toBe("");
				expect(previousEnd < (current?.effectiveFrom ?? "")).toBe(true);
			}
		}
	});

	it("keeps Sonnet 5 at its launch price after the cancelled September increase", () => {
		for (const at of ["2026-06-30", "2026-08-31", "2026-09-01", "2026-09-29"]) {
			expect(resolveModelPricing("claude-sonnet-5", { at })).toMatchObject({
				inputPerMTok: 2,
				cacheReadPerMTok: 0.2,
				cacheWrite5mPerMTok: 2.5,
				cacheWrite1hPerMTok: 4,
				outputPerMTok: 10,
			});
		}
	});

	it("prices Claude Mythos 5.1, Opus 5.5, and Sonnet 5.5 from release", () => {
		for (const [model, releasedOn, dayBefore, rates] of [
			[
				"claude-mythos-5-1",
				"2026-09-01",
				"2026-08-31",
				[10, 0.25, 12.5, 20, 50],
			],
			["claude-opus-5-5", "2026-09-22", "2026-09-21", [4, 0.2, 5, 8, 20]],
			["claude-sonnet-5-5", "2026-09-28", "2026-09-27", [2, 0.2, 2.5, 4, 10]],
		] as const) {
			const [input, cached, write5m, write1h, output] = rates;
			expect(resolveCanonicalModelIdentity(model)?.model).toBe(model);
			expect(resolveCanonicalModelIdentity(`${model}[1m]`)?.model).toBe(model);
			expect(resolveModelPricing(model, { at: dayBefore })).toBeNull();
			expect(
				resolveModelPricing(model, {
					at: releasedOn,
					contextInputTokens: 900_000,
				}),
			).toMatchObject({
				inputPerMTok: input,
				cacheReadPerMTok: cached,
				cacheWrite5mPerMTok: write5m,
				cacheWrite1hPerMTok: write1h,
				outputPerMTok: output,
			});
			expect(
				resolveModelPricing(model, { at: releasedOn, inferenceGeo: "us" })
					?.inputPerMTok,
			).toBeCloseTo(input * 1.1);
		}

		expect(
			resolveModelPricing("claude-opus-5-5", {
				at: "2026-09-22",
				inferenceSpeed: "fast",
			}),
		).toMatchObject({
			inputPerMTok: 8,
			cacheReadPerMTok: 0.4,
			outputPerMTok: 40,
		});
		for (const model of ["claude-mythos-5-1", "claude-sonnet-5-5"]) {
			expect(
				resolveModelPricing(model, {
					at: "2026-09-29",
					inferenceSpeed: "fast",
				}),
			).toBeNull();
		}
		expect(resolveCanonicalModelIdentity("claude-opus-5")?.model).toBe(
			"claude-opus-5",
		);
		expect(resolveCanonicalModelIdentity("claude-sonnet-5")?.model).toBe(
			"claude-sonnet-5",
		);
		expect(resolveCanonicalModelIdentity("claude-mythos-5")?.model).toBe(
			"claude-mythos-5",
		);
	});

	it("uses the August 21 Sol reduction only for requests on or after that UTC date", () => {
		for (const [at, input, cached, write, output] of [
			["2026-08-20T23:59:59.999Z", 5, 0.5, 6.25, 30],
			["2026-08-21T00:00:00.000Z", 4, 0.4, 5, 20],
			["2026-08-21T01:00:00+02:00", 5, 0.5, 6.25, 30],
		] as const) {
			for (const model of ["gpt-5.6-sol", "gpt-5.6"]) {
				expect(resolveModelPricing(model, { at })).toMatchObject({
					inputPerMTok: input,
					cacheReadPerMTok: cached,
					cacheWrite5mPerMTok: write,
					outputPerMTok: output,
				});
				expect(
					resolveModelPricing(model, { at, contextInputTokens: 272_001 }),
				).toMatchObject({
					inputPerMTok: input * 2,
					cacheReadPerMTok: cached * 2,
					cacheWrite5mPerMTok: write * 2,
					outputPerMTok: output * 1.5,
				});
			}
		}
	});

	it("prices Astra from September 3 with cache, context and Fast tiers", () => {
		expect(resolveCanonicalModelIdentity("gpt-6-astra")?.model).toBe(
			"gpt-6-astra",
		);
		expect(
			resolveModelPricing("gpt-6-astra", { at: "2026-09-02T23:59:59.999Z" }),
		).toBeNull();
		expect(
			resolveModelPricing("gpt-6-astra", {
				at: "2026-09-03",
				contextInputTokens: 272_000,
			}),
		).toMatchObject({
			inputPerMTok: 10,
			cacheReadPerMTok: 1,
			cacheWrite5mPerMTok: 12.5,
			cacheWrite1hPerMTok: null,
			outputPerMTok: 50,
		});
		expect(
			resolveModelPricing("gpt-6-astra", {
				at: "2026-09-03",
				contextInputTokens: 272_001,
			}),
		).toMatchObject({
			inputPerMTok: 20,
			cacheReadPerMTok: 2,
			cacheWrite5mPerMTok: 25,
			outputPerMTok: 75,
		});
		for (const serviceTier of ["fast", "priority"]) {
			expect(
				resolveModelPricing("gpt-6-astra", { at: "2026-09-03", serviceTier }),
			).toMatchObject({ inputPerMTok: 20, outputPerMTok: 100 });
			expect(
				resolveModelPricing("gpt-6-astra", {
					at: "2026-09-03",
					serviceTier,
					contextInputTokens: 272_001,
				}),
			).toMatchObject({ inputPerMTok: 40, outputPerMTok: 150 });
		}
		expect(
			resolveModelPricing("gpt-6-astra", {
				at: "2026-09-03",
				modelProvider: "anthropic",
			}),
		).toBeNull();
	});

	it("prices Astra Ultrafast at 6x from September 29 in both context bands", () => {
		expect(
			resolveModelPricing("gpt-6-astra", {
				at: "2026-09-28",
				serviceTier: "ultrafast",
			}),
		).toBeNull();
		expect(
			resolveModelPricing("gpt-6-astra", {
				at: "2026-09-29",
				serviceTier: "ultrafast",
				contextInputTokens: 272_000,
			}),
		).toMatchObject({
			inputPerMTok: 60,
			cacheReadPerMTok: 6,
			cacheWrite5mPerMTok: 75,
			outputPerMTok: 300,
		});
		expect(
			resolveModelPricing("gpt-6-astra", {
				at: "2026-09-29",
				serviceTier: "ultrafast",
				contextInputTokens: 272_001,
			}),
		).toMatchObject({
			inputPerMTok: 120,
			cacheReadPerMTok: 12,
			cacheWrite5mPerMTok: 150,
			outputPerMTok: 450,
		});
		for (const model of ["gpt-6-sol", "gpt-6.1-sol", "gpt-6-luna"]) {
			expect(
				resolveModelPricing(model, {
					at: "2026-09-29",
					serviceTier: "ultrafast",
				}),
			).toBeNull();
		}
	});

	it("prices GPT-6 Sol, Luna and 6.1 Sol from release in every published tier", () => {
		for (const [model, dayBefore, releasedAt, baseRates, longRates] of [
			[
				"gpt-6-sol",
				"2026-09-21",
				"2026-09-22",
				[2, 0.2, 2.5, 10],
				[4, 0.4, 5, 15],
			],
			[
				"gpt-6-luna",
				"2026-09-21",
				"2026-09-22",
				[0.1, 0.01, 0.125, 0.5],
				[0.2, 0.02, 0.25, 0.75],
			],
			[
				"gpt-6.1-sol",
				"2026-09-28",
				"2026-09-29",
				[2, 0.1, 2.5, 10],
				[4, 0.2, 5, 15],
			],
		] as const) {
			expect(resolveCanonicalModelIdentity(model)?.model).toBe(model);
			expect(resolveModelPricing(model, { at: dayBefore })).toBeNull();

			for (const [contextInputTokens, rates] of [
				[272_000, baseRates],
				[272_001, longRates],
			] as const) {
				const [input, cached, write, output] = rates;
				expect(
					resolveModelPricing(model, {
						at: releasedAt,
						contextInputTokens,
					}),
				).toMatchObject({
					inputPerMTok: input,
					cacheReadPerMTok: cached,
					cacheWrite5mPerMTok: write,
					outputPerMTok: output,
				});
				for (const serviceTier of ["fast", "priority"]) {
					expect(
						resolveModelPricing(model, {
							at: releasedAt,
							contextInputTokens,
							serviceTier,
						}),
					).toMatchObject({
						inputPerMTok: input * 2,
						cacheReadPerMTok: cached * 2,
						cacheWrite5mPerMTok: write * 2,
						outputPerMTok: output * 2,
					});
				}
			}
		}
	});

	it("keeps Fable 5 and 5.1 identities and cache rates separate", () => {
		expect(resolveCanonicalModelIdentity("claude-fable-5-1")?.model).toBe(
			"claude-fable-5-1",
		);
		expect(
			resolveModelPricing("claude-fable-5-1", {
				at: "2026-08-31T23:59:59.999Z",
			}),
		).toBeNull();
		expect(
			resolveModelPricing("claude-fable-5-1", {
				at: "2026-09-01",
				contextInputTokens: 300_000,
			}),
		).toMatchObject({
			inputPerMTok: 10,
			cacheReadPerMTok: 0.25,
			cacheWrite5mPerMTok: 12.5,
			cacheWrite1hPerMTok: 20,
			outputPerMTok: 50,
		});
		expect(
			resolveModelPricing("claude-fable-5", { at: "2026-09-01" })
				?.cacheReadPerMTok,
		).toBe(1);
		expect(
			resolveModelPricing("claude-fable-5-1", {
				at: "2026-09-01",
				inferenceGeo: "us",
			})?.cacheReadPerMTok,
		).toBe(0.275);
	});

	it("prices Claude Haiku 5.5 by prompt length from release", () => {
		const model = "claude-haiku-5-5";
		expect(resolveCanonicalModelIdentity(model)?.model).toBe(model);
		expect(resolveCanonicalModelIdentity(`${model}[1m]`)?.model).toBe(model);
		expect(resolveModelPricing(model, { at: "2026-10-06" })).toBeNull();
		expect(getLongContextThresholdTokens(model)).toBe(100_000);

		const base = {
			inputPerMTok: 0.1,
			cacheReadPerMTok: 0.01,
			cacheWrite5mPerMTok: 0.125,
			cacheWrite1hPerMTok: 0.2,
			outputPerMTok: 0.5,
		};
		const long = {
			inputPerMTok: 0.5,
			cacheReadPerMTok: 0.05,
			cacheWrite5mPerMTok: 0.625,
			cacheWrite1hPerMTok: 1,
			outputPerMTok: 2.5,
		};
		for (const [contextInputTokens, rates] of [
			[undefined, base],
			[100_000, base],
			[100_001, long],
			[900_000, long],
		] as const) {
			expect(
				resolveModelPricing(model, { at: "2026-10-07", contextInputTokens }),
			).toMatchObject(rates);
		}

		// The long band reprices every token class of the request, including
		// the cached prefix that pushed the prompt over the threshold.
		expect(
			calculateEstimatedCost({
				at: "2026-10-07",
				model,
				contextInputTokens: 150_000,
				inputTokens: 40_000,
				cacheReadInputTokens: 100_000,
				cacheCreationInputTokens: 10_000,
				outputTokens: 2_000,
				precision: 6,
			}),
		).toBeCloseTo(0.02 + 0.005 + 0.00625 + 0.005, 6);

		for (const contextInputTokens of [100_000, 100_001]) {
			const standard = resolveModelPricing(model, {
				at: "2026-10-07",
				contextInputTokens,
			});
			expect(
				resolveModelPricing(model, {
					at: "2026-10-07",
					contextInputTokens,
					inferenceGeo: "us",
				})?.outputPerMTok,
			).toBeCloseTo((standard?.outputPerMTok ?? 0) * 1.1);
		}
		expect(
			resolveModelPricing(model, { at: "2026-10-07", inferenceSpeed: "fast" }),
		).toBeNull();

		// Haiku 4.5 keeps its own flat rate; the new threshold is Haiku 5.5's.
		expect(
			resolveModelPricing("claude-haiku-4-5", {
				at: "2026-10-07",
				contextInputTokens: 150_000,
			})?.inputPerMTok,
		).toBe(1);
		expect(getLongContextThresholdTokens("gpt-6-sol")).toBe(272_000);
	});

	it("sets a long-context threshold only on long rows, one per model", () => {
		const thresholds = new Map<string, number | undefined>();
		for (const entry of MODEL_RATE_CARD) {
			if (entry.contextBand === "base") {
				expect(entry.longContextAboveTokens).toBeUndefined();
				continue;
			}
			if (thresholds.has(entry.model)) {
				expect(entry.longContextAboveTokens).toBe(thresholds.get(entry.model));
			}
			thresholds.set(entry.model, entry.longContextAboveTokens);
		}
	});

	it("selects published context bands explicitly", () => {
		const base = resolveModelPricing("gpt-5.6-sol", {
			at: "2026-08-01",
		});
		const long = resolveModelPricing("gpt-5.6-sol", {
			at: "2026-08-01",
			contextBand: "long",
		});

		expect(base?.inputPerMTok).toBe(5);
		expect(long?.inputPerMTok).toBe(10);
	});

	it("selects request-level long-context pricing from context input", () => {
		const belowThreshold = resolveModelPricing("gpt-5.6-sol", {
			at: "2026-08-01",
			contextInputTokens: 272_000,
		});
		const aboveThreshold = resolveModelPricing("gpt-5.6-sol", {
			at: "2026-08-01",
			contextInputTokens: 272_001,
		});
		const modelWithoutLongBand = resolveModelPricing("gpt-5.4-mini", {
			at: "2026-08-01",
			contextInputTokens: 500_000,
		});

		expect(belowThreshold?.inputPerMTok).toBe(5);
		expect(aboveThreshold?.inputPerMTok).toBe(10);
		expect(modelWithoutLongBand?.inputPerMTok).toBe(0.75);
	});

	it("leaves unknown and pre-release models unresolved", () => {
		expect(
			resolveModelPricing("codex-auto-review", { at: "2026-08-02" }),
		).toBeNull();
		expect(
			resolveModelPricing("gpt-5.3-codex-spark", { at: "2026-08-02" }),
		).toBeNull();
		expect(resolveModelPricing("gpt-5.6-sol", { at: "2026-06-25" })).toBeNull();
		expect(
			calculateEstimatedCost({
				at: "2026-08-02",
				model: "unknown-model",
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			}),
		).toBeNull();
	});

	it("separates exact canonical identity from public priceability", () => {
		expect(resolveCanonicalModelIdentity("gpt-5.3-codex-spark")).toEqual({
			model: "gpt-5.3-codex-spark",
			priceability: "unpriced",
			provider: "openai",
			unpricedReason: "no_public_rate",
		});
		expect(resolveCanonicalModelIdentity("claude-opus-4-8 [1m]")).toEqual({
			model: "claude-opus-4-8",
			priceability: "published",
			provider: "anthropic",
		});
		expect(resolveCanonicalModelIdentity("unknown-claude [1m]")).toBeNull();
		expect(resolveCanonicalModelIdentity("gpt-5.1-codex [1m]")).toBeNull();
		expect(resolveCanonicalModelIdentity("gpt-5-codex")?.model).toBe(
			"gpt-5-codex",
		);
		expect(resolveCanonicalModelIdentity("gpt-5.1-codex")?.model).toBe(
			"gpt-5.1-codex",
		);
		expect(resolveCanonicalModelIdentity("gpt-5-codex-mini")).toMatchObject({
			model: "gpt-5-codex-mini",
			priceability: "unpriced",
		});
	});

	it("pins native model and retirement boundaries with authored rates", () => {
		const cases = [
			["o3", "2025-06-09", 10, 40],
			["o3", "2025-06-10", 2, 8],
			["codex-mini-latest", "2026-02-12", 1.5, 6],
			["gpt-5-codex", "2025-09-23", 1.25, 10],
			["gpt-5.2-codex", "2025-12-18", 1.75, 14],
			["claude-3-5-sonnet-20240620", "2025-10-28", 3, 15],
			["claude-3-sonnet-20240229", "2025-07-21", 3, 15],
		] as const;
		for (const [model, at, inputPerMTok, outputPerMTok] of cases) {
			const pricing = resolveModelPricing(model, { at });
			expect(pricing?.inputPerMTok).toBe(inputPerMTok);
			expect(pricing?.outputPerMTok).toBe(outputPerMTok);
		}
		expect(
			resolveModelPricing("codex-mini-latest", { at: "2026-02-13" }),
		).toBeNull();
		expect(
			resolveModelPricing("claude-opus-4-20250514", { at: "2026-06-16" }),
		).toBeNull();
		expect(
			resolveModelPricing("claude-opus-4-1-20250805", {
				at: "2026-08-06",
			}),
		).toBeNull();
	});

	it("pins GPT-5.6 preview and July 30 price boundaries", () => {
		expect(resolveModelPricing("gpt-5.6-sol", { at: "2026-06-25" })).toBeNull();
		expect(
			resolveModelPricing("gpt-5.6-sol", { at: "2026-06-26" })?.inputPerMTok,
		).toBe(5);
		expect(
			resolveModelPricing("gpt-5.6-terra", { at: "2026-07-29" })?.inputPerMTok,
		).toBe(2.5);
		expect(
			resolveModelPricing("gpt-5.6-terra", { at: "2026-07-30" })?.inputPerMTok,
		).toBe(2);
		expect(
			resolveModelPricing("gpt-5.6-luna", {
				at: "2026-07-29",
				contextBand: "long",
			})?.outputPerMTok,
		).toBe(9);
		expect(
			resolveModelPricing("gpt-5.6-luna", {
				at: "2026-07-30",
				contextBand: "long",
			})?.outputPerMTok,
		).toBe(1.8);
	});

	it("prices only published Fast/Priority and Claude routing modifiers", () => {
		expect(
			calculateEstimatedCost({
				at: "2026-08-01",
				model: "gpt-5.4",
				serviceTier: "priority",
				inputTokens: 1_000_000,
				cacheReadInputTokens: 1_000_000,
				outputTokens: 1_000_000,
			}),
		).toBe(35.5);
		expect(
			calculateEstimatedCost({
				at: "2026-08-01",
				model: "gpt-5.6-sol",
				serviceTier: "fast",
				contextInputTokens: 272_001,
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			}),
		).toBeNull();
		expect(
			calculateEstimatedCost({
				at: "2026-08-01",
				model: "claude-opus-4-8",
				modelProvider: "anthropic",
				serviceTier: "priority",
				inferenceSpeed: "fast",
				inferenceGeo: "us",
				inputTokens: 1_000_000,
				cacheReadInputTokens: 1_000_000,
				cacheCreationInputTokens: 1_000_000,
				cacheCreation1hInputTokens: 1_000_000,
				outputTokens: 1_000_000,
			}),
		).toBe(102.85);
		expect(
			resolveModelPricing("claude-opus-4-8", {
				at: "2026-08-01",
				modelProvider: "bedrock",
			}),
		).toBeNull();
	});

	it("pins every historical Fast boundary with authored input rates", () => {
		const cases = [
			["gpt-5.4-mini", "2026-03-16", "serviceTier", "fast", null],
			["gpt-5.4-mini", "2026-03-17", "serviceTier", "fast", 1.5],
			["gpt-5.5", "2026-04-23", "serviceTier", "priority", null],
			["gpt-5.5", "2026-04-24", "serviceTier", "priority", 12.5],
			["gpt-5.6-sol", "2026-06-25", "serviceTier", "fast", null],
			["gpt-5.6-sol", "2026-06-26", "serviceTier", "fast", 10],
			["claude-opus-4-6", "2026-02-06", "inferenceSpeed", "fast", null],
			["claude-opus-4-6", "2026-02-07", "inferenceSpeed", "fast", 30],
			["claude-opus-4-6", "2026-06-28", "inferenceSpeed", "fast", 30],
			["claude-opus-4-6", "2026-06-29", "inferenceSpeed", "fast", null],
			["claude-opus-4-7", "2026-05-11", "inferenceSpeed", "fast", null],
			["claude-opus-4-7", "2026-05-12", "inferenceSpeed", "fast", 30],
			["claude-opus-4-7", "2026-07-23", "inferenceSpeed", "fast", 30],
			["claude-opus-4-7", "2026-07-24", "inferenceSpeed", "fast", null],
			["claude-opus-4-8", "2026-06-14", "inferenceSpeed", "fast", null],
			["claude-opus-4-8", "2026-06-15", "inferenceSpeed", "fast", 10],
		] as const;

		for (const [model, at, dimension, value, expectedInputRate] of cases) {
			const pricing = resolveModelPricing(model, {
				at,
				[dimension]: value,
			});
			expect(pricing?.inputPerMTok ?? null).toBe(expectedInputRate);
		}
	});

	it("pins the Claude US routing boundary independently from Fast", () => {
		expect(
			resolveModelPricing("claude-opus-4-6", {
				at: "2026-02-04",
				inferenceGeo: "us",
			}),
		).toBeNull();
		expect(
			resolveModelPricing("claude-opus-4-6", {
				at: "2026-02-05",
				inferenceGeo: "us",
			})?.inputPerMTok,
		).toBe(5.5);
		expect(
			resolveModelPricing("claude-opus-4-5", {
				at: "2026-08-01",
				inferenceGeo: "us",
			}),
		).toBeNull();
	});

	it("has valid non-overlapping modifier evidence", () => {
		const periodsByKey = new Map<
			string,
			Array<{ effectiveFrom: string; effectiveTo?: string }>
		>();
		for (const modifier of MODEL_RATE_MODIFIERS) {
			expect(modifier.multiplier).toBeGreaterThan(1);
			expect(modifier.values.length).toBeGreaterThan(0);
			expect(new URL(modifier.source).protocol).toBe("https:");
			expect(modifier.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			if (modifier.effectiveTo !== undefined) {
				expect(modifier.effectiveFrom < modifier.effectiveTo).toBe(true);
			}
			for (const value of modifier.values) {
				const key = `${modifier.provider}:${modifier.model}:${modifier.dimension}:${value}:${modifier.contextBand ?? "all"}`;
				const periods = periodsByKey.get(key) ?? [];
				periods.push({
					effectiveFrom: modifier.effectiveFrom,
					effectiveTo: modifier.effectiveTo,
				});
				periodsByKey.set(key, periods);
			}
		}
		for (const periods of periodsByKey.values()) {
			const chronological = [...periods].sort((left, right) =>
				left.effectiveFrom.localeCompare(right.effectiveFrom),
			);
			for (let index = 1; index < chronological.length; index += 1) {
				const previousEnd = chronological[index - 1]?.effectiveTo;
				expect(previousEnd).toBeDefined();
				if (previousEnd === undefined) {
					throw new Error("Overlapping modifier period has no effective end");
				}
				expect(previousEnd < (chronological[index]?.effectiveFrom ?? "")).toBe(
					true,
				);
			}
		}
	});

	it("prices the hand-traced normal Codex session", () => {
		expect(
			calculateEstimatedCost({
				model: "gpt-5.6-sol",
				at: "2026-08-01",
				inputTokens: 118_111,
				cacheReadInputTokens: 2_735_360,
				outputTokens: 18_130,
				precision: 6,
			}),
		).toBe(2.502135);
	});

	it("prices the hand-traced large Codex session", () => {
		expect(
			calculateEstimatedCost({
				model: "gpt-5.6-sol",
				at: "2026-08-02",
				inputTokens: 11_351_520,
				cacheReadInputTokens: 445_070_848,
				outputTokens: 1_017_600,
				precision: 6,
			}),
		).toBe(309.821024);
	});

	it("builds date-aware SQL with a null unresolved branch", () => {
		const sql = buildEstimatedCostSql({
			modelExpr: "model_used",
			dateExpr: "session_date",
			inputExpr: "input_tokens",
			outputExpr: "output_tokens",
		});

		expect(sql).toContain("toDate(session_date)");
		expect(sql).toContain("Nullable(Float64)");
		expect(sql).not.toContain("fallback");
	});

	it("builds request-context-aware SQL without changing token classes", () => {
		const sql = buildEstimatedCostSql({
			modelExpr: "resolved_model",
			dateExpr: "usage_date",
			inputExpr: "uncached_input_tokens",
			outputExpr: "output_tokens",
			cacheReadInputExpr: "cache_read_input_tokens",
			cacheCreationInputExpr: "cache_write_5m_input_tokens",
			cacheCreation1hInputExpr: "cache_write_1h_input_tokens",
			contextInputExpr: "context_input_tokens",
			modelProviderExpr: "model_provider",
			serviceTierExpr: "service_tier",
			inferenceSpeedExpr: "inference_speed",
			inferenceGeoExpr: "inference_geo",
		});

		expect(sql).toContain("(context_input_tokens) > 272000");
		expect(sql).toContain("(context_input_tokens) <= 272000");
		expect(sql).toContain("(context_input_tokens) > 100000");
		expect(sql).toContain("(context_input_tokens) <= 100000");
		expect(sql).toContain("uncached_input_tokens");
		expect(sql).toContain("cache_read_input_tokens");
		expect(sql).toContain("cache_write_5m_input_tokens");
		expect(sql).toContain("cache_write_1h_input_tokens");
		expect(sql).toContain("model_provider");
		expect(sql).toContain("service_tier");
		expect(sql).toContain("inference_speed");
		expect(sql).toContain("inference_geo");
		expect(sql.length).toBeLessThan(100_000);
	});

	it("keeps the generated pricing sheet in sync", async () => {
		const pricingSheet = Bun.file(
			new URL("../../../../MODEL_PRICING.md", import.meta.url),
		);

		expect(await pricingSheet.text()).toBe(renderModelPricingTable());
	});
});
