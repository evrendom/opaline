import { type DemoInputRules, demoInputRules } from "./demo-input-rules";

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

function isPlain(value: unknown): boolean {
	return value === null || typeof value !== "object";
}

/** Object keys sorted, undefined left out; with `sets`, arrays of plain values
 *  sorted too: every such array in a demo request's input is a set (filters,
 *  ids, flags, paths), whatever order it was picked in. */
function canonical(value: unknown, sets = false): unknown {
	if (Array.isArray(value)) {
		const items = value.map((item) => canonical(item, sets));
		if (!sets || !items.every(isPlain)) return items;
		return items
			.map((item) => [JSON.stringify(item), item] as const)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([, item]) => item);
	}
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, entry]) => entry !== undefined)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entry]) => [key, canonical(entry, sets)]),
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

/**
 * A request's inputs by name, each as comparable JSON: the oRPC input
 * (`json`) of an `/rpc/` body, any other JSON body's fields and the query
 * string's parameters, with the contract's defaults for those left out.
 */
function requestInputs(
	path: string,
	rules: DemoInputRules,
	body: unknown,
	search: string,
): Map<string, string> {
	const inputs = new Map<string, string>();
	const add = (name: string, value: unknown) => {
		if (value !== undefined && !inputs.has(name))
			inputs.set(name, JSON.stringify(canonical(value, true)));
	};
	const params = new URLSearchParams(search);
	for (const name of new Set(params.keys())) {
		const values = params.getAll(name);
		add(name, values.length === 1 ? values[0] : values);
	}
	const fields = path.startsWith("/rpc/") ? bodyInput(body) : body;
	if (fields && typeof fields === "object" && !Array.isArray(fields))
		for (const [name, value] of Object.entries(fields)) add(name, value);
	else if (fields !== null) add("body", fields);
	for (const [name, value] of Object.entries(rules.defaults ?? {}))
		add(name, value);
	return inputs;
}

/**
 * How well a recording stands in for a request: null unless every identity
 * input is the same (`demo-input-rules.ts`), else how many presentation
 * inputs are the same too.
 */
function standInScore(
	rules: DemoInputRules,
	asked: ReadonlyMap<string, string>,
	recorded: ReadonlyMap<string, string>,
): number | null {
	const presentation = new Set(rules.presentation);
	let score = 0;
	for (const name of new Set([...asked.keys(), ...recorded.keys()])) {
		const same = asked.get(name) === recorded.get(name);
		if (presentation.has(name)) score += same ? 1 : 0;
		else if (!same) return null;
	}
	return score;
}

export function createFixtureMatcher(index: DemoFixtureIndex) {
	const byPath = new Map<
		string,
		Array<{ fixture: DemoFixture; inputs: Map<string, string> }>
	>();
	const exact = new Map<string, DemoFixture>();
	for (const fixture of index) {
		const parsed = parseBody(fixture.body);
		const key = `${fixture.method} ${fixture.path}`;
		exact.set(
			`${key}?${canonicalSearch(fixture.search)} ${JSON.stringify(parsed)}`,
			fixture,
		);
		const list = byPath.get(key) ?? [];
		list.push({
			fixture,
			inputs: requestInputs(
				fixture.path,
				demoInputRules(fixture.path),
				parsed,
				fixture.search,
			),
		});
		byPath.set(key, list);
	}
	/** The recording that answers a request: the exact one, else the one that
	 *  stands in best (ties go to the first in the index), else null. */
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
		const rules = demoInputRules(path);
		const asked = requestInputs(path, rules, parsed, search);
		let best: DemoFixture | null = null;
		let bestScore = -1;
		for (const candidate of byPath.get(key) ?? []) {
			const score = standInScore(rules, asked, candidate.inputs);
			if (score !== null && score > bestScore) {
				best = candidate.fixture;
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

type SessionMerge = (
	answers: readonly unknown[],
	sessionIds: ReadonlySet<string>,
) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Answers about several sessions at once, which the app asks for in pages of
 * whatever sessions it shows. Every recording of the path is merged and the
 * asked sessions are kept, so any page is answered from the recorded ones.
 */
const MERGED_BY_SESSION: Readonly<Record<string, SessionMerge>> = {
	// `{ [sessionId]: { server, at }[] }`
	"/rpc/analytics/sessions/mcpServers": (answers, sessionIds) => {
		const servers: Record<string, unknown> = {};
		for (const answer of answers)
			if (isRecord(answer))
				for (const [id, used] of Object.entries(answer))
					if (sessionIds.has(id)) servers[id] = used;
		return servers;
	},
	// `{ enabled, sessions: { sessionId, questions }[] }`
	"/rpc/analytics/sessions/runQuestionTags": (answers, sessionIds) => {
		let enabled = false;
		const sessions = new Map<string, unknown>();
		for (const answer of answers) {
			if (!isRecord(answer)) continue;
			enabled ||= answer.enabled === true;
			if (!Array.isArray(answer.sessions)) continue;
			for (const session of answer.sessions)
				if (
					isRecord(session) &&
					typeof session.sessionId === "string" &&
					sessionIds.has(session.sessionId)
				)
					sessions.set(session.sessionId, session);
		}
		return { enabled, sessions: [...sessions.values()] };
	},
};

async function answerBySession(
	index: DemoFixtureIndex,
	path: string,
	body: string,
	readFile: (file: string) => Promise<string>,
): Promise<string | null> {
	const merge = MERGED_BY_SESSION[path];
	if (!merge) return null;
	const recorded = index.filter(
		(fixture) => fixture.path === path && fixture.status === 200,
	);
	if (recorded.length === 0) return null;
	const sessionIds: unknown = bodyInput(parseBody(body)).sessionIds;
	if (!Array.isArray(sessionIds)) return null;
	const answers = await Promise.all(
		recorded.map(
			async (fixture) =>
				(JSON.parse(await readFile(fixture.file)) as { json?: unknown }).json,
		),
	);
	const json = merge(
		answers,
		new Set(sessionIds.filter((id): id is string => typeof id === "string")),
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
		const merged = await answerBySession(
			index,
			recordedPath(url.pathname),
			body,
			readFile,
		);
		if (merged)
			return new Response(merged, {
				headers: { "content-type": "application/json" },
			});
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
