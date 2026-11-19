export interface DemoFixture {
	readonly method: string;
	readonly path: string;
	readonly search: string;
	readonly body: string;
	readonly status: number;
	readonly type: string;
	readonly file: string;
}

export type DemoFixtureIndex = readonly DemoFixture[];

export type DemoFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

const RECORDED_PATHS: ReadonlyArray<readonly [string, string]> = [
	["/api/demo/rpc/", "/rpc/"],
	["/api/demo/auth/", "/api/auth/"],
];

export function recordedPath(pathname: string): string {
	for (const [demo, recorded] of RECORDED_PATHS)
		if (pathname.startsWith(demo))
			return `${recorded}${pathname.slice(demo.length)}`;
	return pathname;
}

export function servesFromFixtures(pathname: string): boolean {
	return /^\/(?:rpc|api)\//u.test(recordedPath(pathname));
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, entry]) => entry !== undefined)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entry]) => [key, canonical(entry)]),
		);
	return value;
}

function parseBody(body: string): unknown {
	if (!body) return null;
	try {
		return canonical(JSON.parse(body));
	} catch {
		return body;
	}
}

function bodyInput(body: unknown): Record<string, unknown> {
	if (!body || typeof body !== "object") return {};
	const json = (body as { json?: unknown }).json;
	return json && typeof json === "object"
		? (json as Record<string, unknown>)
		: {};
}

function canonicalSearch(search: string): string {
	const params = new URLSearchParams(search);
	params.sort();
	return params.toString();
}

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function createFixtureMatcher(index: DemoFixtureIndex) {
	const byPath = new Map<string, Array<DemoFixture & { parsed: unknown }>>();
	const exact = new Map<string, DemoFixture>();
	for (const fixture of index) {
		const parsed = parseBody(fixture.body);
		const key = `${fixture.method} ${fixture.path}`;
		exact.set(
			`${key}?${canonicalSearch(fixture.search)} ${JSON.stringify(parsed)}`,
			fixture,
		);
		const list = byPath.get(key) ?? [];
		list.push({ ...fixture, parsed });
		byPath.set(key, list);
	}
	return (
		method: string,
		pathname: string,
		search: string,
		body: string,
	): DemoFixture | null => {
		const path = recordedPath(pathname);
		const parsed = parseBody(body);
		const key = `${method} ${path}`;
		const found = exact.get(
			`${key}?${canonicalSearch(search)} ${JSON.stringify(parsed)}`,
		);
		if (found) return found;
		const candidates = byPath.get(key);
		if (!candidates?.length) return null;
		const input = bodyInput(parsed);
		const params = new URLSearchParams(search);
		let best = candidates[0] ?? null;
		let bestScore = -1;
		for (const candidate of candidates) {
			const recorded = bodyInput(candidate.parsed);
			const recordedParams = new URLSearchParams(candidate.search);
			let score = 0;
			for (const [name, value] of Object.entries(input))
				if (sameValue(recorded[name], value)) score += 1;
			for (const [name, value] of params)
				if (recordedParams.get(name) === value) score += 1;
			if (score > bestScore) {
				best = candidate;
				bestScore = score;
			}
		}
		return best;
	};
}

const MISSING = JSON.stringify({
	json: {
		defined: false,
		code: "NOT_FOUND",
		status: 404,
		message: "This part of the app isn’t in the demo.",
	},
	meta: [],
});

const KEYED_BY_SESSION = new Set([
	"/rpc/analytics/sessions/mcpServers",
	"/rpc/analytics/sessions/runQuestionTags",
]);

async function answerBySession(
	index: DemoFixtureIndex,
	path: string,
	body: string,
	readFile: (file: string) => Promise<string>,
): Promise<string | null> {
	const recorded = index.filter(
		(fixture) => fixture.path === path && fixture.status === 200,
	);
	if (recorded.length === 0) return null;
	const sessionIds: unknown = (
		bodyInput(parseBody(body)) as { sessionIds?: unknown }
	).sessionIds;
	if (!Array.isArray(sessionIds)) return null;
	const merged: Record<string, unknown> = {};
	for (const fixture of recorded) {
		const answer = JSON.parse(await readFile(fixture.file)) as {
			json?: Record<string, unknown>;
		};
		Object.assign(merged, answer.json ?? {});
	}
	const json = Object.fromEntries(
		sessionIds
			.filter((id): id is string => typeof id === "string" && id in merged)
			.map((id) => [id, merged[id]]),
	);
	return JSON.stringify({ json, meta: [] });
}

export function createFixtureFetch(
	index: DemoFixtureIndex,
	readFile: (file: string) => Promise<string>,
	passthrough: DemoFetch,
	origin: () => string,
): DemoFetch {
	const match = createFixtureMatcher(index);
	return async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url, origin());
		if (url.origin !== origin() || !servesFromFixtures(url.pathname))
			return passthrough(input, init);
		const body =
			request.method === "GET" || request.method === "HEAD"
				? ""
				: await request.text();
		const path = recordedPath(url.pathname);
		if (KEYED_BY_SESSION.has(path)) {
			const merged = await answerBySession(index, path, body, readFile);
			if (merged)
				return new Response(merged, {
					headers: { "content-type": "application/json" },
				});
		}
		const fixture = match(request.method, url.pathname, url.search, body);
		if (!fixture)
			return new Response(MISSING, {
				status: 404,
				headers: { "content-type": "application/json" },
			});
		const empty = [101, 204, 205, 304].includes(fixture.status);
		return new Response(empty ? null : await readFile(fixture.file), {
			status: fixture.status,
			headers: { "content-type": fixture.type || "application/json" },
		});
	};
}
