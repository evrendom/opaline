import { hashKey } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { installDemoClock } from "./demo-clock";
import type { DemoFixtureIndex } from "./demo-fixtures";
import { createQueryResolver, type DemoQueries } from "./demo-prerender";
import { createDemoQueryClient, DemoRoot } from "./demo-root";
import { type DemoSeed, DemoSeedSchema } from "./demo-runtime";
import fixture from "./seed.json";

const MAX_PASSES = 8;

function firstScreenQueries(
	seed: DemoSeed,
	resolve: ReturnType<typeof createQueryResolver>,
): DemoQueries {
	const queries: DemoQueries = [];
	const known = new Set<string>();
	for (let pass = 0; pass < MAX_PASSES; pass++) {
		const client = createDemoQueryClient();
		renderToString(<DemoRoot seed={{ ...seed, queries }} client={client} />);
		let added = 0;
		for (const query of client.getQueryCache().getAll()) {
			if (query.state.data !== undefined || known.has(query.queryHash))
				continue;
			known.add(query.queryHash);
			const data = resolve(query.queryKey);
			if (data === undefined) continue;
			queries.push([[...query.queryKey], data]);
			added++;
		}
		if (added === 0) break;
	}
	return queries.filter(
		([key], position) =>
			queries.findIndex(([other]) => hashKey(other) === hashKey(key)) ===
			position,
	);
}

export function renderDemo(fixtures: {
	index: DemoFixtureIndex;
	readFile: (file: string) => string;
}) {
	installDemoClock();
	const base = DemoSeedSchema.parse(fixture);
	const seed = {
		...base,
		queries: firstScreenQueries(
			base,
			createQueryResolver(fixtures.index, fixtures.readFile),
		),
	};
	return {
		html: renderToString(<DemoRoot seed={seed} />),
		seed: JSON.stringify(seed).replaceAll("<", "\\u003c"),
		queries: seed.queries.length,
	};
}
