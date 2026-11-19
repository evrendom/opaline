import { getLogger } from "@logtape/logtape";
import {
	postgresTrendsSourceStore,
	readTrendsSources,
} from "../services/trends-sources.service.js";

const logger = getLogger(["rudel", "api", "trends"]);
const CACHE_SECONDS = 300;

/**
 * `GET /api/trends/sources`: the last good capture of each Trends source,
 * as the API's cron stored it, for the marketing build. Public data only
 * (third-party benchmarks and usage, and the public usage aggregate).
 */
export async function handleTrendsSourcesRequest(input: {
	cors: Record<string, string>;
	method: "GET" | "HEAD";
}): Promise<Response> {
	try {
		const sources = await readTrendsSources(postgresTrendsSourceStore());
		return new Response(
			input.method === "HEAD" ? null : JSON.stringify(sources),
			{
				status: 200,
				headers: {
					...input.cors,
					"Access-Control-Allow-Origin": "*",
					"Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
					"Content-Type": "application/json; charset=utf-8",
				},
			},
		);
	} catch (error) {
		logger.error("Reading the stored Trends sources failed: {error}", {
			error,
		});
		return Response.json(
			{ error: "Trends sources are temporarily unavailable" },
			{ status: 503, headers: { ...input.cors, "Retry-After": "300" } },
		);
	}
}
