import { expect, test } from "bun:test";
import { aaPublicPayloadSchema } from "../../packages/api-routes/src/trends-aa-release";
import { discoverManifest } from "./fetch-artificial-analysis";

test("discovers the public model manifest across Flight chunks without evaluating scripts", () => {
	const provider = { path: "/data/1111111111111111.txt", key: "1".repeat(64) };
	const models = { path: "/data/2222222222222222.txt", key: "2".repeat(64) };
	const flight = JSON.stringify({
		manifest: provider,
		children: { manifest: models },
		modelsAndReleases: {},
	});
	const html = [flight.slice(0, 130), flight.slice(130)]
		.map(
			(chunk) =>
				`<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`,
		)
		.join("");
	expect(discoverManifest(html)).toEqual(models);
});

test("fails loudly when the public manifest structure drifts", () => {
	expect(() =>
		discoverManifest("<html>No public model payload</html>"),
	).toThrow("shape drift");
});

test("allows absent optional metrics but preserves missing intelligence as null", () => {
	const result = aaPublicPayloadSchema.parse({
		models: [
			{
				id: "11111111-1111-4111-8111-111111111111",
				slug: "example-1.5",
				name: "Example (Reasoning)",
				creator: {
					id: "22222222-2222-4222-8222-222222222222",
					slug: "example_lab",
					name: "Example Lab",
				},
				release: { slug: "example-1.5", name: "Example" },
				releaseDate: "2026-09-01",
				isOpenWeights: false,
				deprecated: false,
				isReasoning: true,
				intelligenceIndex: null,
				intelligenceIndexIsEstimated: false,
			},
		],
	});
	expect(result.models[0]?.intelligenceIndex).toBeNull();
	expect(result.models[0]?.intelligenceIndexCost).toBeUndefined();
	expect(
		aaPublicPayloadSchema.safeParse({ models: [{ slug: "broken" }] }).success,
	).toBe(false);
});

test("accepts payloads that no longer publish the estimated-index flag", () => {
	const result = aaPublicPayloadSchema.parse({
		models: [
			{
				id: "11111111-1111-4111-8111-111111111111",
				slug: "example-2",
				name: "Example 2 (Max)",
				creator: {
					id: "22222222-2222-4222-8222-222222222222",
					slug: "example_lab",
					name: "Example Lab",
				},
				release: { slug: "example-2", name: "Example 2" },
				releaseDate: "2026-11-09",
				isOpenWeights: false,
				deprecated: false,
				isReasoning: true,
				intelligenceIndex: 64.5,
				intelligenceIndexEvaluations: [],
			},
		],
	});
	expect(result.models[0]?.intelligenceIndexIsEstimated).toBeUndefined();
});
