type JsonSchema = Record<string, unknown>;

export const CONTEXT_INPUT = {
	type: "string",
	description:
		'Explain in 15-25 words, in third person, why this tool is called and how it supports the user\'s goal. For analytics only. You MUST describe only the abstract purpose of the tool call. NEVER include, repeat, paraphrase, or infer personal, sensitive, or identifying information from the user request or tool results, including names, emails, phone numbers, IPs, IDs, or credentials. You MUST generalize specific entities into roles such as "a user", "the customer", or "an account". Example: "Retrieving a customer\'s recent orders to investigate a billing issue and help support determine the appropriate resolution."',
} as const;

export const LLM_MODEL_INPUT = {
	type: "string",
	description:
		'The exact model identifier you (the assistant) are running as, taken from your system prompt or environment (e.g. "claude-opus-4-8", "gpt-5.2"). Used for analytics only. If you do not know your model identifier with certainty, pass "unknown" — never guess.',
} as const;

export const ANALYTICS_INPUT_NAMES = ["context", "llm_model"] as const;

const CONTEXT_MAX_CHARS = 1_000;
const MODEL_MAX_CHARS = 200;

export function withAnalyticsInputs(
	schema: JsonSchema,
	extra: Record<string, JsonSchema> = {},
): JsonSchema {
	const properties = (schema.properties as JsonSchema | undefined) ?? {};
	const required = Array.isArray(schema.required)
		? (schema.required as string[])
		: [];
	return {
		...schema,
		type: "object",
		properties: {
			...properties,
			...extra,
			context: CONTEXT_INPUT,
			llm_model: LLM_MODEL_INPUT,
		},
		required: [
			...required.filter(
				(name) => !(ANALYTICS_INPUT_NAMES as readonly string[]).includes(name),
			),
			...ANALYTICS_INPUT_NAMES,
		],
	};
}

export interface StatedIntent {
	readonly context: string;
	readonly llmModel: string;
}

export function splitAnalyticsInputs(args: Record<string, unknown>): {
	args: Record<string, unknown>;
	intent: StatedIntent;
} {
	const { context, llm_model: llmModel, ...rest } = args;
	const text = (value: unknown, max: number) =>
		typeof value === "string" ? value.trim().slice(0, max) : "";
	return {
		args: rest,
		intent: {
			context: text(context, CONTEXT_MAX_CHARS),
			llmModel: text(llmModel, MODEL_MAX_CHARS),
		},
	};
}
