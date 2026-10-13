import { getLogger } from "@logtape/logtape";
import { createSystemOneProvider } from "./systemone-provider.js";

const logger = getLogger(["rudel", "api", "run-questions"]);

/** Characters of the compact run note, the default state sent to a provider. */
export const RUN_NOTE_MAX_CHARS = 6_000;

/** What a yes and a no look like, where the boundary is subtle. */
export interface RunQuestionCriteria {
	readonly true: string;
	readonly false: string;
}

/** One question as the provider is asked it; the id is ours and never shown to the model. */
export interface AskedQuestion {
	readonly id: string;
	readonly question: string;
	readonly criteria: RunQuestionCriteria | null;
}

/** One call's answers: the probability of yes by question id, and what the call used and cost. */
export interface ProviderAnswers {
	/** Only valid answers (0 to 1); a question left out is asked again later. */
	readonly probabilities: ReadonlyMap<string, number>;
	/** The model version that answered. */
	readonly model: string;
	readonly usage: {
		readonly inputTokens: number;
		readonly outputTokens: number;
	};
	readonly costUsd: number;
}

/**
 * Who answers run questions: every question about one run in one call, each
 * as the probability of yes, with what the call used and cost. The name
 * (with `:note` or `:run` when it reads otherwise than its preset does) is
 * stored with every answer and is part of its key, so two providers can
 * answer the same question about the same run side by side.
 */
export interface RunQuestionProvider {
	readonly name: string;
	/**
	 * What it reads about a run: the run's whole text (the compact note when
	 * the run is larger than `stateMaxChars`), or always the compact note.
	 */
	readonly state: "note" | "run";
	/** Characters of state sent at most. */
	readonly stateMaxChars: number;
	/** At most what one call with these questions costs, for estimates. */
	callCeilingUsd(questions: readonly AskedQuestion[]): number;
	/**
	 * What one call with these questions about `stateChars` characters of
	 * state (capped at `stateMaxChars`) is estimated to use and cost; errs high.
	 */
	estimateCall(
		questions: readonly AskedQuestion[],
		stateChars: number,
	): { inputTokens: number; outputTokens: number; costUsd: number };
	answer(input: {
		state: string;
		questions: readonly AskedQuestion[];
		/** Aborted when the worker's pass runs out of time; the answers are then not used. */
		signal: AbortSignal;
	}): Promise<ProviderAnswers>;
}

/**
 * The provider cannot answer now (rate limited, a server error): the job
 * waits and tries again, after `retryAfterMs` when known.
 */
export class RunQuestionProviderBusy extends Error {
	constructor(
		message: string,
		readonly rateLimited: boolean,
		readonly retryAfterMs: number | null,
	) {
		super(message);
	}
}

/**
 * The provider will not answer until someone acts (no credits left): the job
 * fails at once with this message, and the pass stops asking that provider.
 */
export class RunQuestionProviderFatal extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

interface Preset {
	readonly url: string;
	readonly model: string;
	/** Env variables of the API key and the USD prices per million tokens. */
	readonly keyEnv: string;
	readonly priceEnv: { readonly input: string; readonly output: string };
	/** Prices per million tokens when the env sets none; null where they must be set. */
	readonly defaultPrices: {
		readonly input: number;
		readonly output: number;
	} | null;
	/** Characters of a whole run sent at most, within the provider's input limit. */
	readonly runStateMaxChars: number;
	/** What it reads by default. */
	readonly state: RunQuestionProvider["state"];
}

/** The provider that answers when `RUN_QUESTIONS_PROVIDER` is unset. */
const DEFAULT_PROVIDERS = "subq";

/**
 * The systemone-compatible providers. SubQ Snap is the run question provider:
 * it takes up to 384K input tokens at $0.05 per million, output free, so it
 * reads whole runs (up to the read output ceiling, far below its limit). Jev
 * (Typesafe) is an optional fallback: it documents no pricing or limits, so
 * its prices must be set, it reads the compact note, and whole runs are
 * capped low.
 */
const PRESETS: Readonly<Record<string, Preset>> = {
	jev: {
		url: "https://api.typesafe.ai/v1/systemone",
		model: "jev-latest",
		keyEnv: "TYPESAFE_API_KEY",
		priceEnv: {
			input: "TYPESAFE_USD_PER_MILLION_INPUT_TOKENS",
			output: "TYPESAFE_USD_PER_MILLION_OUTPUT_TOKENS",
		},
		defaultPrices: null,
		runStateMaxChars: 32_000,
		state: "note",
	},
	subq: {
		url: "https://api.subq.ai/v1/systemone",
		model: "subq-snap-preview",
		keyEnv: "SUBQ_API_KEY",
		priceEnv: {
			input: "SUBQ_USD_PER_MILLION_INPUT_TOKENS",
			output: "SUBQ_USD_PER_MILLION_OUTPUT_TOKENS",
		},
		defaultPrices: { input: 0.05, output: 0 },
		runStateMaxChars: 240_000,
		state: "run",
	},
};

/**
 * The providers `RUN_QUESTIONS_PROVIDER` lists (comma-separated
 * `<preset>[:note|:run]`, e.g. `subq,jev,subq:note`; default `subq`) whose
 * key and prices are set. The first answers run_questions; the internal form
 * may test with any. An unknown or incomplete entry is left out (logged when
 * named explicitly); with none, nothing is answered or sent anywhere.
 */
export function readRunQuestionProviders(
	env: Env = process.env,
	/** Stands in for the HTTP client in tests. */
	fetchImpl?: typeof fetch,
): {
	default: RunQuestionProvider | null;
	byName: ReadonlyMap<string, RunQuestionProvider>;
} {
	const byName = new Map<string, RunQuestionProvider>();
	const listed = env.RUN_QUESTIONS_PROVIDER?.trim();
	for (const entry of (listed || DEFAULT_PROVIDERS).split(",")) {
		const name = entry.trim();
		if (!name || byName.has(name)) continue;
		const provider = createProvider(name, env, Boolean(listed), fetchImpl);
		if (provider) byName.set(name, provider);
	}
	return { default: byName.values().next().value ?? null, byName };
}

function createProvider(
	name: string,
	env: Env,
	named: boolean,
	fetchImpl: typeof fetch | undefined,
): RunQuestionProvider | null {
	const [presetName = "", mode, ...rest] = name.split(":");
	const preset = PRESETS[presetName];
	if (
		!preset ||
		rest.length > 0 ||
		(mode !== undefined && mode !== "run" && mode !== "note")
	) {
		logger.warn(
			"RUN_QUESTIONS_PROVIDER entry {provider} names no provider; it is left out",
			{ provider: name },
		);
		return null;
	}
	const apiKey = env[preset.keyEnv]?.trim();
	const input = price(env[preset.priceEnv.input], preset.defaultPrices?.input);
	const output = price(
		env[preset.priceEnv.output],
		preset.defaultPrices?.output,
	);
	if (!apiKey || input === null || output === null) {
		if (named)
			logger.warn(
				"Run question provider {provider} needs {key} and its token prices ({input}, {output}); it is left out",
				{
					provider: name,
					key: preset.keyEnv,
					input: preset.priceEnv.input,
					output: preset.priceEnv.output,
				},
			);
		return null;
	}
	const wholeRun = (mode ?? preset.state) === "run";
	return createSystemOneProvider({
		name,
		url: preset.url,
		model: preset.model,
		apiKey,
		usdPerInputToken: input / 1_000_000,
		usdPerOutputToken: output / 1_000_000,
		state: wholeRun ? "run" : "note",
		stateMaxChars: wholeRun ? preset.runStateMaxChars : RUN_NOTE_MAX_CHARS,
		...(fetchImpl ? { fetch: fetchImpl } : {}),
	});
}

/** A price per million tokens in USD, the default when unset, or null when invalid or missing. */
function price(value: string | undefined, fallback?: number): number | null {
	if (!value?.trim()) return fallback ?? null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Which workspaces may have run notes sent to the provider. Opaline's own
 * workspaces (`VITE_ADMIN_ORGANIZATION_ID` and `RUN_QUESTIONS_INTERNAL_WORKSPACES`)
 * always may; customer workspaces only where `RUN_QUESTIONS_CUSTOMER_WORKSPACES`
 * is exactly `true`, which waits on the providers' subprocessor terms.
 */
export function readRunQuestionWorkspaces(
	env: NodeJS.ProcessEnv = process.env,
): (workspaceId: string) => boolean {
	if (env.RUN_QUESTIONS_CUSTOMER_WORKSPACES === "true") return () => true;
	const internal = new Set(
		[
			env.VITE_ADMIN_ORGANIZATION_ID ?? "",
			...(env.RUN_QUESTIONS_INTERNAL_WORKSPACES ?? "").split(","),
		]
			.map((id) => id.trim())
			.filter(Boolean),
	);
	return (workspaceId) => internal.has(workspaceId);
}
