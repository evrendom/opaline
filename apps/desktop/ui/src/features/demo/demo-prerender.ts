import type { QueryKey } from "@tanstack/react-query";
import { planUsageSearch } from "@/features/costs/plan-usage/use-plan-usage";
import { createFixtureMatcher, type DemoFixtureIndex } from "./demo-fixtures";

export type DemoQueries = Array<[unknown[], unknown]>;

type OrpcKey = [string[], { input?: unknown; type?: string }];

function isOrpcKey(key: readonly unknown[]): key is OrpcKey {
	return (
		Array.isArray(key[0]) &&
		typeof key[1] === "object" &&
		key[1] !== null &&
		"type" in key[1]
	);
}

function withoutWorkspace(key: QueryKey): readonly unknown[] {
	return key[0] === "org" ? key.slice(2) : key;
}

export function createQueryResolver(
	index: DemoFixtureIndex,
	readFile: (file: string) => string,
) {
	const match = createFixtureMatcher(index);
	const answer = (
		method: string,
		path: string,
		search: string,
		body: string,
	) => {
		const fixture = match(method, path, search, body);
		return fixture && fixture.status === 200 ? readFile(fixture.file) : null;
	};
	return (key: QueryKey): unknown => {
		const inner = withoutWorkspace(key);
		if (inner[0] === "selfhost" && inner[1] === "plan-usage") {
			const [, , startDate, endDate, ...repositories] = inner as string[];
			if (!startDate || !endDate) return undefined;
			const text = answer(
				"GET",
				"/api/selfhost/plan-usage",
				`?${planUsageSearch({ startDate, endDate }, repositories)}`,
				"",
			);
			return text === null ? undefined : JSON.parse(text);
		}
		if (!isOrpcKey(inner)) return undefined;
		const [path, { input, type }] = inner;
		const text = answer(
			"POST",
			`/rpc/${path.join("/")}`,
			"",
			input === undefined ? "{}" : JSON.stringify({ json: input }),
		);
		if (text === null) return undefined;
		const data = (JSON.parse(text) as { json?: unknown }).json;
		if (type !== "infinite") return data;
		const offset = (input as { offset?: number } | undefined)?.offset ?? 0;
		return { pages: [data], pageParams: [offset] };
	};
}
