import { describe, expect, test } from "bun:test";
import {
	RUN_NOTE_MAX_CHARS,
	RunQuestionProviderBusy,
	RunQuestionProviderFatal,
	readRunQuestionProviders,
	readRunQuestionWorkspaces,
} from "./provider.js";
import { createSystemOneProvider } from "./systemone-provider.js";

/**
 * The systemone-compatible adapter (Jev and SubQ Snap) as the run question
 * worker uses it, against a stand-in for the HTTP API: one request per run
 * with every question about it, the probabilities by our question ids, and
 * the call's model, usage and cost. Never calls a real API.
 */

type Sent = { url: string; init: RequestInit };

function fakeFetch(
	respond: (sent: Sent) => Response,
): typeof fetch & { sent: Sent[] } {
	const sent: Sent[] = [];
	const fake = async (url: string | URL | Request, init?: RequestInit) => {
		const request = { url: String(url), init: init ?? {} };
		sent.push(request);
		return respond(request);
	};
	return Object.assign(fake as typeof fetch, { sent });
}

const json = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

const answered = (answers: Record<string, number>) =>
	json({
		model: "jev-1.13.0",
		answers: Object.fromEntries(
			Object.entries(answers).map(([id, noul]) => [id, { type: "noul", noul }]),
		),
		usage: { input_tokens: 360, output_tokens: 39 },
	});

const settings = {
	name: "jev",
	url: "https://api.typesafe.ai/v1/systemone",
	model: "jev-latest",
	apiKey: "key",
	usdPerInputToken: 0.000_002,
	usdPerOutputToken: 0.000_01,
	state: "note" as const,
	stateMaxChars: RUN_NOTE_MAX_CHARS,
};
const questions = [
	{ id: "rq_a", question: "Did the agent go in circles?", criteria: null },
	{
		id: "rq_b",
		question: "Did the user correct the agent?",
		criteria: {
			true: "The next prompt says the agent got it wrong.",
			false: "The next prompt moves on or thanks the agent.",
		},
	},
];
const ask = (
	provider: ReturnType<typeof createSystemOneProvider>,
	state = "prompt:\nfix the login test",
) =>
	provider.answer({ state, questions, signal: new AbortController().signal });

describe("the systemone adapter", () => {
	test("asks every question about a run in one request and returns the probabilities by question id, with the model, usage and cost", async () => {
		const fetch = fakeFetch(() => answered({ rq_a: 0, rq_b: 1 }));

		const call = await ask(createSystemOneProvider({ ...settings, fetch }));

		expect(fetch.sent).toHaveLength(1);
		const [sent] = fetch.sent;
		expect(sent?.url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(sent?.init.method).toBe("POST");
		const headers = new Headers(sent?.init.headers);
		expect(headers.get("authorization")).toBe("Bearer key");
		expect(headers.get("content-type")).toBe("application/json");
		expect(JSON.parse(String(sent?.init.body))).toEqual({
			state: "prompt:\nfix the login test",
			model: "jev-latest",
			questions: {
				rq_a: { type: "noul", instructions: "Did the agent go in circles?" },
				rq_b: {
					type: "noul",
					instructions: "Did the user correct the agent?",
					criteria: {
						true: "The next prompt says the agent got it wrong.",
						false: "The next prompt moves on or thanks the agent.",
					},
				},
			},
		});
		expect(call).toEqual({
			probabilities: new Map([
				["rq_a", 0],
				["rq_b", 1],
			]),
			model: "jev-1.13.0",
			usage: { inputTokens: 360, outputTokens: 39 },
			costUsd: 360 * 0.000_002 + 39 * 0.000_01,
		});
	});

	test("an answer missing or outside 0 to 1 is left out, so it is asked again", async () => {
		const call = await ask(
			createSystemOneProvider({
				...settings,
				fetch: fakeFetch(() => answered({ rq_a: 1.4 })),
			}),
		);

		expect(call.probabilities.size).toBe(0);
		expect(call.usage).toEqual({ inputTokens: 360, outputTokens: 39 });
	});

	test("a rate limit or a server error says the service is busy and when to come back; no credits is fatal; other refusals are errors", async () => {
		const answer = (status: number, headers: Record<string, string> = {}) =>
			ask(
				createSystemOneProvider({
					...settings,
					fetch: fakeFetch(() => json({ error: "no" }, status, headers)),
				}),
			).catch((error: unknown) => error);

		const limited = await answer(429, { "retry-after": "30" });
		const down = await answer(500);
		const later = await answer(503, {
			"retry-after": new Date(Date.now() + 60_000).toUTCString(),
		});
		const noCredits = await answer(402);
		const refused = await answer(400);

		expect(limited).toBeInstanceOf(RunQuestionProviderBusy);
		expect(limited).toMatchObject({ rateLimited: true, retryAfterMs: 30_000 });
		expect(down).toBeInstanceOf(RunQuestionProviderBusy);
		expect(down).toMatchObject({ rateLimited: false, retryAfterMs: null });
		expect((later as RunQuestionProviderBusy).retryAfterMs).toBeGreaterThan(
			50_000,
		);
		expect((later as RunQuestionProviderBusy).retryAfterMs).toBeLessThanOrEqual(
			60_000,
		);
		expect(noCredits).toBeInstanceOf(RunQuestionProviderFatal);
		expect((noCredits as Error).message).toContain("no credits");
		expect(refused).not.toBeInstanceOf(RunQuestionProviderBusy);
		expect((refused as Error).message).toBe(
			'jev answered HTTP 400: {"error":"no"}',
		);
	});

	test("an estimate prices a call at the state cap with every question's wording and criteria, three characters a token, 30 framing and 100 output tokens a question", () => {
		const provider = createSystemOneProvider(settings);
		const exact = createSystemOneProvider({
			...settings,
			stateMaxChars: 300,
			usdPerInputToken: 1,
			usdPerOutputToken: 1_000,
		});
		const wider = createSystemOneProvider({
			...settings,
			stateMaxChars: RUN_NOTE_MAX_CHARS * 10,
		});

		const one = provider.callCeilingUsd(questions.slice(0, 1));
		const two = provider.callCeilingUsd(questions);

		expect(one).toBeGreaterThan(
			(RUN_NOTE_MAX_CHARS / 4) * settings.usdPerInputToken,
		);
		expect(two).toBeGreaterThan(one);
		expect(wider.callCeilingUsd(questions)).toBeGreaterThan(two);
		// 300 + 28 + 31 + 44 + 45 characters: 150 tokens, 60 framing, 200 output.
		expect(exact.callCeilingUsd(questions)).toBe(150 + 60 + 200_000);
	});
	test("an estimate of one call counts the run's characters up to the state cap, so a short run costs less than the ceiling", () => {
		const provider = createSystemOneProvider({
			...settings,
			stateMaxChars: 300,
			usdPerInputToken: 1,
			usdPerOutputToken: 1_000,
		});
		const one = questions.slice(0, 1);
		// 30 characters of run, 28 of wording: 20 tokens, 30 framing, 100 output.
		expect(provider.estimateCall(one, 30)).toEqual({
			inputTokens: 50,
			outputTokens: 100,
			costUsd: 50 + 100_000,
		});
		expect(provider.estimateCall(one, 10_000)).toEqual(
			provider.estimateCall(one, 300),
		);
		expect(provider.estimateCall(one, 300).costUsd).toBe(
			provider.callCeilingUsd(one),
		);
	});
});

describe("which providers answer", () => {
	const jev = {
		TYPESAFE_API_KEY: "key",
		TYPESAFE_USD_PER_MILLION_INPUT_TOKENS: "2",
		TYPESAFE_USD_PER_MILLION_OUTPUT_TOKENS: "10",
	};
	const names = (env: Record<string, string>) => {
		const read = readRunQuestionProviders(env);
		return {
			default: read.default?.name ?? null,
			all: [...read.byName.keys()],
		};
	};

	test("each preset calls its own API with its model and key, and prices the call from its token prices", async () => {
		const usage = { input_tokens: 2_000_000, output_tokens: 1_000 };
		const fetch = fakeFetch((sent) =>
			json({
				model: JSON.parse(String(sent.init.body)).model,
				answers: {},
				usage,
			}),
		);
		const read = readRunQuestionProviders(
			{
				...jev,
				RUN_QUESTIONS_PROVIDER: "subq,jev",
				SUBQ_API_KEY: "subq-key",
			},
			fetch,
		);
		const call = (name: string) =>
			read.byName.get(name)?.answer({
				state: "s",
				questions,
				signal: new AbortController().signal,
			});

		const [subq, typesafe] = [await call("subq"), await call("jev")];

		expect(
			fetch.sent.map((sent) => [
				sent.url,
				JSON.parse(String(sent.init.body)).model,
				new Headers(sent.init.headers).get("authorization"),
			]),
		).toEqual([
			[
				"https://api.subq.ai/v1/systemone",
				"subq-snap-preview",
				"Bearer subq-key",
			],
			["https://api.typesafe.ai/v1/systemone", "jev-latest", "Bearer key"],
		]);
		expect(subq?.costUsd).toBeCloseTo(0.1, 12);
		expect(typesafe?.costUsd).toBeCloseTo(4.01, 12);
	});

	test("SubQ's prices default to $0.05 per million input tokens and free output, and can be set", async () => {
		const priced = readRunQuestionProviders({
			RUN_QUESTIONS_PROVIDER: "subq",
			SUBQ_API_KEY: "subq-key",
			SUBQ_USD_PER_MILLION_OUTPUT_TOKENS: "1",
		}).default;
		const invalid = readRunQuestionProviders({
			RUN_QUESTIONS_PROVIDER: "subq",
			SUBQ_API_KEY: "subq-key",
			SUBQ_USD_PER_MILLION_INPUT_TOKENS: "-1",
		}).default;

		expect(priced?.callCeilingUsd(questions)).toBeGreaterThan(
			readRunQuestionProviders({ SUBQ_API_KEY: "k" }).default?.callCeilingUsd(
				questions,
			) ?? Number.POSITIVE_INFINITY,
		);
		expect(invalid).toBeNull();
		const read = readRunQuestionProviders({
			RUN_QUESTIONS_PROVIDER: "subq:note",
			SUBQ_API_KEY: "subq-key",
		});

		expect(read.default?.name).toBe("subq:note");
		expect(read.default?.callCeilingUsd([])).toBeCloseTo(
			(Math.ceil(RUN_NOTE_MAX_CHARS / 3) * 0.05) / 1_000_000,
			12,
		);
	});

	test("several providers can be listed for operators to compare; the first answers agents, and :note or :run choose what they read", () => {
		const read = readRunQuestionProviders({
			...jev,
			RUN_QUESTIONS_PROVIDER: "subq, jev, subq:note, jev:run",
			SUBQ_API_KEY: "subq-key",
		});

		expect(read.default?.name).toBe("subq");
		expect([...read.byName.keys()]).toEqual([
			"subq",
			"jev",
			"subq:note",
			"jev:run",
		]);
		expect(read.byName.get("subq")?.state).toBe("run");
		expect(read.byName.get("jev")?.state).toBe("note");
		expect(read.byName.get("subq:note")?.state).toBe("note");
		expect(read.byName.get("jev:run")?.state).toBe("run");
		expect(
			names({
				...jev,
				SUBQ_API_KEY: "subq-key",
				RUN_QUESTIONS_PROVIDER: "subq:run:x, subq:full, jev:",
			}).all,
		).toEqual([]);
		expect(read.byName.get("subq")?.stateMaxChars).toBeGreaterThan(
			read.byName.get("jev:run")?.stateMaxChars ?? Number.POSITIVE_INFINITY,
		);
	});
});

describe("which workspaces may be answered", () => {
	test("Opaline's own workspaces, unless customer workspaces are allowed with exactly true", () => {
		const internal = readRunQuestionWorkspaces({
			VITE_ADMIN_ORGANIZATION_ID: "opaline",
			RUN_QUESTIONS_INTERNAL_WORKSPACES: " data-a, data-b ,",
		});
		const everyone = readRunQuestionWorkspaces({
			RUN_QUESTIONS_CUSTOMER_WORKSPACES: "true",
		});
		const almost = readRunQuestionWorkspaces({
			RUN_QUESTIONS_CUSTOMER_WORKSPACES: "yes",
		});

		expect(
			["opaline", "data-a", "data-b", "customer", ""].map(internal),
		).toEqual([true, true, true, false, false]);
		expect(everyone("customer")).toBe(true);
		expect(almost("customer")).toBe(false);
	});
});
