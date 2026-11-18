import type { RouterClient } from "@orpc/server";
import type { router } from "../router.js";

type Client = RouterClient<typeof router>;

const WAIT_AFTER_RESULT_MS = 2_000;
const SCOPE_KEYS = ["from", "to", "repository", "latest", "sessions"] as const;

export type CoverageScopeArgs = Partial<
	Record<(typeof SCOPE_KEYS)[number], unknown>
>;

export function startCoverage(
	client: Client,
	scope?: CoverageScopeArgs,
): Promise<string> {
	return Promise.resolve()
		.then(() =>
			client.analysis.coverage(scope ? { scope: pickScope(scope) } : {}),
		)
		.then((coverage) => coverage.line)
		.catch(() => "coverage: unknown (it could not be computed for this call)");
}

export async function withCoverage(
	text: string,
	coverage: Promise<string>,
): Promise<string> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const line = await Promise.race([
		coverage,
		new Promise<string>((resolve) => {
			timer = setTimeout(
				() => resolve("coverage: unknown (it took too long for this call)"),
				WAIT_AFTER_RESULT_MS,
			);
		}),
	]);
	clearTimeout(timer);
	return `${text}\n${line}`;
}

function pickScope(scope: CoverageScopeArgs) {
	return Object.fromEntries(
		SCOPE_KEYS.flatMap((key) =>
			scope[key] === undefined || scope[key] === null
				? []
				: [[key, scope[key]]],
		),
	);
}
