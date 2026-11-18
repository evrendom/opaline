import { getLogger } from "@logtape/logtape";
import { getTrendsUsage } from "../services/trends-usage.service.js";

const logger = getLogger(["rudel", "api", "trends"]);
const CACHE_SECONDS = 3600;

/**
 * `GET /api/trends/usage`: the public, aggregate-only In the wild dataset.
 * No authentication; responses carry no identities and are cached.
 */
export async function handleTrendsUsageRequest(input: {
	cors: Record<string, string>;
	method: "GET" | "HEAD";
}): Promise<Response> {
	try {
		const usage = await getTrendsUsage();
		const body = JSON.stringify(usage);
		return new Response(input.method === "HEAD" ? null : body, {
			status: 200,
			headers: {
				...input.cors,
				"Access-Control-Allow-Origin": "*",
				// s-maxage lets the CDN answer repeats, so serverless cold starts
				// do not each rerun the cross-tenant aggregation.
				"Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 24}`,
				"Content-Type": "application/json; charset=utf-8",
			},
		});
	} catch (error) {
		logger.error("Trends usage aggregation failed: {error}", { error });
		return Response.json(
			{ error: "Trends usage is temporarily unavailable" },
			{ status: 503, headers: { ...input.cors, "Retry-After": "300" } },
		);
	}
}
