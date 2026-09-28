import { getLogger } from "@logtape/logtape";
import { type CRMConfig, syncUserActivityToCRM } from "../crm.js";

const logger = getLogger(["rudel", "api", "customer-activity"]);

interface CustomerActivityUser {
	email: string;
	id: string;
}

export async function handleCustomerActivityRequest(input: {
	crm: CRMConfig | undefined;
	cors: Readonly<Record<string, string>>;
	getUser: () => Promise<CustomerActivityUser | null>;
	request: Request;
}): Promise<Response> {
	if (input.request.method !== "POST") {
		return new Response("Method Not Allowed", {
			headers: { ...input.cors, Allow: "POST" },
			status: 405,
		});
	}
	const user = await input.getUser();
	if (!user) {
		return Response.json(
			{ error: "Unauthorized" },
			{ headers: input.cors, status: 401 },
		);
	}
	try {
		await syncUserActivityToCRM(input.crm, {
			agentRuns30d: undefined,
			email: user.email,
			lastActiveAt: new Date(),
			userId: user.id,
		});
		return new Response(null, { headers: input.cors, status: 204 });
	} catch (error) {
		logger.error("Failed to record customer activity for {userId}: {error}", {
			error,
			userId: user.id,
		});
		return Response.json(
			{ error: "Customer activity sync failed" },
			{ headers: input.cors, status: 502 },
		);
	}
}
