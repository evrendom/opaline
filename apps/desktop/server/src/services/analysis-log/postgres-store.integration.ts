import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AnalysisSavedError } from "./errors.js";
import {
	createPostgresAnalysisStore,
	expirePostgresAnalysisLog,
	MAX_EMBEDDING_MATCHES,
} from "./postgres-store.js";
import { analysisStoreContract } from "./store-contract.js";
import type { StoredAnalysis, StoredQuery, StoredStep } from "./types.js";

const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString)
	throw new Error("PG_CONNECTION_STRING is required for integration tests");

setDefaultTimeout(120_000);

const options = { max: 4, prepare: false, onnotice: () => {} } as const;
const sql = postgres(connectionString, options);
drizzle(sql);
const plain = postgres(connectionString, options);
const connect = async () => sql;
const MODEL = "text-embedding-3-small";
const DAY_MS = 86_400_000;

afterAll(async () => {
	await Promise.all([sql.end({ timeout: 5 }), plain.end({ timeout: 5 })]);
});

analysisStoreContract("postgres, client shared with Drizzle like db.ts", () =>
	createPostgresAnalysisStore(connect),
);
analysisStoreContract("postgres, plain client", () =>
	createPostgresAnalysisStore(async () => plain),
);

test("arguments and results keep every key and character, NUL and lone surrogates included", async () => {
	const store = createPostgresAnalysisStore(connect);
	const { analysis, step, query } = records();
	const args = { "a.b": ["\u0000", "\ud800", "错 ✓"], nested: { $x: null } };
	const output = { text: "line\u0000break", list: [1.5, 1e-7, true] };
	await store.createAnalysis(analysis);
	await store.createStep(step);
	await store.createQuery({ ...query, args, output });
	const stored = await store.getQuery(query.id);
	expect(stored?.args).toEqual(args);
	expect(stored?.output).toEqual(output);
	await store.deleteAnalysesByWorkspace(analysis.workspaceId);
});

test("questions, answers, findings, topics, notes, labels and embedded text keep NUL characters and lone surrogates", async () => {
	const store = createPostgresAnalysisStore(connect);
	const { analysis, step, query } = records();
	const odd = (label: string) => `${label}\u0000tail \ud83d \u0001json:"x"`;
	const saved: StoredAnalysis = {
		...analysis,
		draft: true,
		question: odd("question"),
		scope: {
			from: odd("from"),
			to: null,
			filters: { [odd("key")]: odd("value") },
		},
		topics: [odd("topic"), "\u0001json:plain"],
		notes: [odd("note")],
		changes: [
			{
				step: step.id,
				finding: odd("prior"),
				change: "confirmed",
				evidence: odd("evidence"),
			},
		],
	};
	await store.createAnalysis(saved);
	await store.createStep({
		...step,
		question: odd("step"),
		reply: odd("reply"),
	});
	await store.createQuery({
		...query,
		redaction: { args: { source: "runs" }, label: odd("label") },
	});
	await store.saveAnalysis(analysis.id, {
		findings: [{ stepId: step.id, finding: odd("finding") }],
		clarifications: [],
		patch: { finalAnswer: odd("answer"), status: "finished" },
	});
	await store.addEmbedding(analysis.workspaceId, {
		analysisId: analysis.id,
		stepId: step.id,
		kind: "step",
		text: odd("embedded"),
		model: MODEL,
		vector: vector(1, 0),
	});

	const reopened = createPostgresAnalysisStore(async () => plain);
	expect(await reopened.getAnalysis(analysis.id)).toEqual({
		...saved,
		draft: false,
		status: "finished",
		finalAnswer: odd("answer"),
		queryCount: 1,
		stepCount: 1,
	});
	const [stored] = await reopened.getSteps(analysis.id);
	expect(stored).toMatchObject({
		question: odd("step"),
		reply: odd("reply"),
		finding: odd("finding"),
	});
	expect((await reopened.getQuery(query.id))?.redaction?.label).toBe(
		odd("label"),
	);
	const [match] = await reopened.searchEmbeddings(
		analysis.workspaceId,
		MODEL,
		vector(1, 0),
		1,
	);
	expect(match?.text).toBe(odd("embedded"));
	const [raw] = await plain<{ question: string }[]>`
		SELECT question FROM analysis_log_analysis WHERE id = ${analysis.id}
	`;
	expect(raw?.question.includes("\u0000")).toBe(false);
	await store.deleteAnalysesByWorkspace(analysis.workspaceId);
});

test("a failed store call names only the operation, never its arguments", async () => {
	const store = createPostgresAnalysisStore(connect);
	const { analysis, step, query } = records();
	await store.createAnalysis(analysis);
	await store.createStep(step);
	const secret = "export API_KEY=sk-live-should-not-be-logged";
	await store.createQuery({ ...query, output: { quote: secret } });
	const duplicate = await store
		.createQuery({ ...query, output: { quote: secret } })
		.catch((error: unknown) => error);
	expect(String(duplicate)).toMatch(
		/^SanitizedError: Postgres analysis log createQuery failed \(23505\)$/,
	);
	await expect(
		createPostgresAnalysisStore(async () => {
			throw new Error(secret);
		}).getAnalysis(analysis.id),
	).rejects.toThrow(/^Postgres analysis log getAnalysis failed \(Error\)$/);
	await store.deleteAnalysesByWorkspace(analysis.workspaceId);
});

test("a save racing another save of the same draft lets exactly one through", async () => {
	const store = createPostgresAnalysisStore(connect);
	const { analysis, step } = records();
	await store.createAnalysis({ ...analysis, draft: true });
	await store.createStep(step);
	const save = (finding: string) =>
		store.saveAnalysis(analysis.id, {
			findings: [{ stepId: step.id, finding }],
			clarifications: [],
			patch: { status: "finished", finalAnswer: finding },
		});
	const results = await Promise.allSettled([save("first"), save("second")]);
	expect(
		results.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
	const refused = results.find((result) => result.status === "rejected");
	expect(refused?.status === "rejected" && refused.reason).toBeInstanceOf(
		AnalysisSavedError,
	);
	const saved = await store.getAnalysis(analysis.id);
	expect(saved?.draft).toBe(false);
	expect((await store.getSteps(analysis.id))[0]?.finding).toBe(
		saved?.finalAnswer ?? "",
	);
	await store.deleteAnalysesByWorkspace(analysis.workspaceId);
});

test("retention drops results after 90 days, or a year in shared or pinned analyses, and drafts after 7 days", async () => {
	const store = createPostgresAnalysisStore(connect);
	const now = new Date();
	const at = (days: number) =>
		new Date(now.getTime() - days * DAY_MS).toISOString();
	const { analysis, step, query } = records();
	const add = async (
		suffix: string,
		fields: Partial<StoredAnalysis>,
		queryDays: number,
	) => {
		const id = `${analysis.id}_${suffix}`;
		await store.createAnalysis({ ...analysis, id, ...fields });
		await store.createStep({ ...step, id: `${id}_step`, analysisId: id });
		await store.createQuery({
			...query,
			id: `${id}_query`,
			analysisId: id,
			stepId: `${id}_step`,
			createdAt: at(queryDays),
		});
		return id;
	};
	const fresh = await add("fresh", {}, 89);
	const stale = await add("stale", {}, 91);
	const sharedStale = await add("shared", { shared: true }, 200);
	const pinnedOld = await add("pinned", { pinned: true }, 366);
	const draftOld = await add(
		"draft",
		{ draft: true, createdAt: at(8), cutoff: at(8) },
		8,
	);
	const draftNew = await add(
		"draft_new",
		{ draft: true, createdAt: at(6), cutoff: at(6) },
		6,
	);

	const first = await expirePostgresAnalysisLog(sql, now);
	expect(first.results).toBeGreaterThanOrEqual(2);
	expect(first.drafts).toBeGreaterThanOrEqual(1);
	expect(await expirePostgresAnalysisLog(sql, now)).toEqual({
		drafts: 0,
		results: 0,
	});
	const output = async (id: string) =>
		(await store.getQuery(`${id}_query`))?.output ?? null;
	expect(await output(fresh)).toEqual({ runs: [1, 2] });
	expect(await output(sharedStale)).toEqual({ runs: [1, 2] });
	expect(await output(stale)).toBeNull();
	expect(await output(pinnedOld)).toBeNull();
	expect(await store.getQueries(stale)).toMatchObject([
		{ hasOutput: false, removed: false },
	]);
	expect(await store.getAnalysis(draftOld)).toBeNull();
	expect(await store.getQuery(`${draftOld}_query`)).toBeNull();
	expect((await store.getAnalysis(draftNew))?.draft).toBe(true);
	await store.deleteAnalysesByWorkspace(analysis.workspaceId);
});

test("search ranks every vector of the workspace and model, leaves out drafts and returns at most 256, best first", async () => {
	const store = createPostgresAnalysisStore(connect);
	const { analysis } = records();
	const count = 300;
	for (let index = 0; index < count; index++) {
		const id = `${analysis.id}_${index}`;
		await store.createAnalysis({ ...analysis, id });
		await store.addEmbedding(analysis.workspaceId, {
			analysisId: id,
			stepId: null,
			kind: "question",
			text: `question ${index}`,
			model: MODEL,
			vector: vector(1, index / count),
		});
	}
	await store.createAnalysis({
		...analysis,
		id: `${analysis.id}_draft`,
		draft: true,
	});
	await store.addEmbedding(analysis.workspaceId, {
		analysisId: `${analysis.id}_draft`,
		stepId: null,
		kind: "question",
		text: "draft",
		model: MODEL,
		vector: vector(1, 0),
	});
	await expect(
		store.addEmbedding(`${analysis.workspaceId}_other`, {
			analysisId: `${analysis.id}_0`,
			stepId: null,
			kind: "question",
			text: "elsewhere",
			model: MODEL,
			vector: vector(1, 0),
		}),
	).rejects.toThrow();

	const matches = await store.searchEmbeddings(
		analysis.workspaceId,
		MODEL,
		vector(1, 0),
		1_000,
	);
	expect(matches).toHaveLength(MAX_EMBEDDING_MATCHES);
	expect(matches.map((match) => match.text)).toEqual(
		Array.from(
			{ length: MAX_EMBEDDING_MATCHES },
			(_, index) => `question ${index}`,
		),
	);
	const reversed = await createPostgresAnalysisStore(connect).searchEmbeddings(
		analysis.workspaceId,
		MODEL,
		vector(0, 1),
		3,
	);
	expect(reversed.map((match) => match.text)).toEqual([
		"question 299",
		"question 298",
		"question 297",
	]);

	await store.deleteAnalysesByAuthor(analysis.authorId);
	expect(
		await store.searchEmbeddings(analysis.workspaceId, MODEL, vector(1, 0), 10),
	).toEqual([]);
});

function records() {
	const namespace = crypto.randomUUID();
	const now = new Date().toISOString();
	const analysis: StoredAnalysis = {
		id: `a_${namespace}`,
		workspaceId: `workspace_${namespace}`,
		authorId: `author_${namespace}`,
		host: "eval",
		question: "Parity — 错 ✓",
		status: "unfinished",
		draft: false,
		shared: false,
		pinned: false,
		createdAt: now,
		cutoff: now,
		scope: { from: null, to: null, filters: {} },
		finalAnswer: null,
		topics: [],
		updates: null,
		changes: [],
		notes: [],
		cost: null,
		queryCount: 0,
		stepCount: 0,
		visibilityRevision: 0,
	};
	const step: StoredStep = {
		id: `s_${namespace}`,
		analysisId: analysis.id,
		parentId: null,
		ordinal: 1,
		question: "find source=runs",
		reply: null,
		finding: null,
		createdAt: now,
	};
	const query: StoredQuery = {
		id: `q_${namespace}`,
		analysisId: analysis.id,
		stepId: step.id,
		workspaceId: analysis.workspaceId,
		authorId: analysis.authorId,
		tool: "find",
		args: { source: "runs" },
		output: { runs: [1, 2] },
		outputChars: 14,
		sessions: [],
		owners: [],
		createdAt: now,
		removed: false,
		counts: true,
		redaction: null,
	};
	return { analysis, step, query };
}

function vector(first: number, second: number): number[] {
	const values = new Array<number>(1536).fill(0);
	values[0] = first;
	values[1] = second;
	return values;
}
