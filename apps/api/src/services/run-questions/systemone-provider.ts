import { z } from "zod";
import {
	type AskedQuestion,
	type ProviderAnswers,
	type RunQuestionProvider,
	RunQuestionProviderBusy,
	RunQuestionProviderFatal,
} from "./provider.js";

/**
 * A systemone-compatible decisions API (Typesafe's Jev, SubQ Snap): one
 * request per run (`state`) with every question about it, each a `noul`
 * answered as the probability of yes, evaluated independently. Question ids
 * are ours and never shown to the model. The state is capped per provider;
 * 429 and 5xx are `RunQuestionProviderBusy`, so the job waits and tries
 * again; 402 (no credits) is `RunQuestionProviderFatal`.
 */

/** Estimates assume this few characters per input token, so they err high. */
const ESTIMATE_CHARS_PER_TOKEN = 3;
/** Estimates allow this many output tokens per question (Jev's documented example used 39 for one). */
const ESTIMATE_OUTPUT_TOKENS_PER_QUESTION = 100;
/** Estimates allow this many input tokens per question for the request's framing. */
const ESTIMATE_FRAMING_TOKENS_PER_QUESTION = 30;
const ERROR_BODY_CHARS = 300;

export function createSystemOneProvider(options: {
	name: string;
	url: string;
	model: string;
	apiKey: string;
	usdPerInputToken: number;
	usdPerOutputToken: number;
	state: RunQuestionProvider["state"];
	stateMaxChars: number;
	fetch?: typeof fetch;
}): RunQuestionProvider {
	const send = options.fetch ?? fetch;
	const cost = (usage: { inputTokens: number; outputTokens: number }) =>
		usage.inputTokens * options.usdPerInputToken +
		usage.outputTokens * options.usdPerOutputToken;
	const estimateCall: RunQuestionProvider["estimateCall"] = (
		questions,
		stateChars,
	) => {
		const chars =
			Math.min(Math.max(0, stateChars), options.stateMaxChars) +
			questions.reduce(
				(total, question) =>
					total +
					question.question.length +
					(question.criteria?.true.length ?? 0) +
					(question.criteria?.false.length ?? 0),
				0,
			);
		const usage = {
			inputTokens:
				Math.ceil(chars / ESTIMATE_CHARS_PER_TOKEN) +
				questions.length * ESTIMATE_FRAMING_TOKENS_PER_QUESTION,
			outputTokens: questions.length * ESTIMATE_OUTPUT_TOKENS_PER_QUESTION,
		};
		return { ...usage, costUsd: cost(usage) };
	};
	return {
		name: options.name,
		state: options.state,
		stateMaxChars: options.stateMaxChars,
		estimateCall,
		callCeilingUsd: (questions) =>
			estimateCall(questions, options.stateMaxChars).costUsd,
		async answer({ state, questions, signal }): Promise<ProviderAnswers> {
			const response = await send(options.url, {
				method: "POST",
				headers: {
					authorization: `Bearer ${options.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					state: state.slice(0, options.stateMaxChars),
					model: options.model,
					questions: Object.fromEntries(questions.map(noul)),
				}),
				signal,
			});
			if (!response.ok) throw await refusal(options.name, response);
			const body = ResponseSchema.parse(await response.json());
			const usage = {
				inputTokens: body.usage.input_tokens,
				outputTokens: body.usage.output_tokens,
			};
			const probabilities = new Map<string, number>();
			for (const question of questions) {
				const value = body.answers[question.id]?.noul;
				if (
					typeof value === "number" &&
					Number.isFinite(value) &&
					value >= 0 &&
					value <= 1
				)
					probabilities.set(question.id, value);
			}
			return { probabilities, model: body.model, usage, costUsd: cost(usage) };
		},
	};
}

function noul(question: AskedQuestion): [string, Record<string, unknown>] {
	return [
		question.id,
		{
			type: "noul",
			instructions: question.question,
			...(question.criteria ? { criteria: question.criteria } : {}),
		},
	];
}

/** Why the request failed: busy (429, 5xx), fatal (402, no credits) or refused. */
async function refusal(name: string, response: Response): Promise<Error> {
	const text = (await response.text().catch(() => "")).slice(
		0,
		ERROR_BODY_CHARS,
	);
	const message = `${name} answered HTTP ${response.status}: ${text}`;
	if (response.status === 402)
		return new RunQuestionProviderFatal(
			`${name} has no credits left (HTTP 402); nothing more is asked until credits are added and the questions are asked again. ${text}`.trim(),
		);
	if (response.status === 429 || response.status >= 500)
		return new RunQuestionProviderBusy(
			message,
			response.status === 429,
			retryAfterMs(response.headers.get("retry-after")),
		);
	return new Error(message);
}

/** Retry-After in seconds or as an HTTP date, in milliseconds from now. */
function retryAfterMs(header: string | null): number | null {
	if (!header) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const at = Date.parse(header);
	return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

const ResponseSchema = z.object({
	model: z.string(),
	answers: z.record(
		z.string(),
		z.object({ noul: z.number().optional() }).passthrough(),
	),
	usage: z.object({
		input_tokens: z.number().int().nonnegative(),
		output_tokens: z.number().int().nonnegative(),
	}),
});
