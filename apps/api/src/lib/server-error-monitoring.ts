import { getLogger } from "@logtape/logtape";
import { readBooleanEnv } from "./env.js";

const logger = getLogger(["rudel", "api", "sentry"]);
const SENTRY_FLUSH_TIMEOUT_MS = 2_000;

type SentryNodeSdk = typeof import("@sentry/node");

let sentrySdkPromise: Promise<SentryNodeSdk | null> | undefined;

export async function captureApiServerError(input: {
	readonly error: unknown;
	readonly functionGroup: string;
	readonly request: Request;
	readonly status?: number;
}): Promise<void> {
	try {
		const sentry = await getSentrySdk();
		if (!sentry) {
			return;
		}

		const pathname = new URL(input.request.url).pathname;
		sentry.captureException(input.error, {
			extra: { pathname },
			tags: {
				"http.method": input.request.method,
				...(input.status === undefined
					? {}
					: { "http.status_code": input.status.toString() }),
				"vercel.function_group": input.functionGroup,
			},
		});
		await sentry.flush(SENTRY_FLUSH_TIMEOUT_MS);
	} catch (error) {
		logger.warn("Could not deliver API error to Sentry: {error}", {
			error: String(error),
		});
	}
}

function getSentrySdk(): Promise<SentryNodeSdk | null> {
	sentrySdkPromise ??= initializeSentrySdk();
	return sentrySdkPromise;
}

async function initializeSentrySdk(): Promise<SentryNodeSdk | null> {
	const dsn = process.env.SENTRY_API_DSN?.trim();
	if (!readBooleanEnv("SENTRY_API_ENABLED", false) || !dsn) {
		return null;
	}

	try {
		const sentry = await import("@sentry/node");
		sentry.init({
			dsn,
			environment:
				process.env.SENTRY_ENVIRONMENT ??
				process.env.VERCEL_ENV ??
				process.env.NODE_ENV,
			release: process.env.VERCEL_GIT_COMMIT_SHA,
			registerEsmLoaderHooks: false,
			sendDefaultPii: false,
			tracesSampleRate: 0,
		});
		return sentry;
	} catch (error) {
		logger.warn("Could not initialize API Sentry SDK: {error}", {
			error: String(error),
		});
		return null;
	}
}
