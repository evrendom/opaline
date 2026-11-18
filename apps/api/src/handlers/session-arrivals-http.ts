import { SessionArrivalsInputSchema } from "@rudel/api-routes";
import { streamSessionArrivals } from "../services/session-arrivals-stream.js";
import { readSessionReader } from "../services/session-reader.service.js";

export async function handleSessionArrivalsRequest(
	request: Request,
	userId: string | null,
) {
	if (request.method !== "GET")
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { Allow: "GET" },
		});
	if (!userId) return new Response("Unauthorized", { status: 401 });
	const url = new URL(request.url);
	const input = SessionArrivalsInputSchema.safeParse({
		organizationId: url.searchParams.get("organizationId"),
		since: request.headers.get("Last-Event-ID") || undefined,
	});
	if (!input.success)
		return new Response("Invalid session stream request", { status: 400 });
	if (!(await readSessionReader(input.data.organizationId, userId)))
		return new Response("Forbidden", { status: 403 });
	return streamSessionArrivals(
		request,
		input.data.organizationId,
		userId,
		input.data.since,
	);
}
