import { getLogger } from "@logtape/logtape";
import { type CRMConfig, syncUserActivityToCRM } from "../crm.js";

const logger = getLogger(["rudel", "api", "customer-activity"]);

interface CustomerActivityUser {
	email: string;
	id: string;
}

/** An IANA time zone this runtime knows ("Europe/Berlin"), or null. */
export function knownTimeZone(value: unknown): string | null {
	if (typeof value !== "string" || value.length === 0 || value.length > 64)
		return null;
	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone: value,
		}).resolvedOptions().timeZone;
	} catch {
		return null;
	}
}

/**
 * The time zone the browser reports in the body, else the one Vercel infers
 * from the request's IP address.
 */
async function requestTimeZone(request: Request): Promise<string | null> {
	const body: unknown = await request.json().catch(() => null);
	const reported =
		body && typeof body === "object" && "timeZone" in body
			? knownTimeZone(body.timeZone)
			: null;
	return reported ?? knownTimeZone(request.headers.get("x-vercel-ip-timezone"));
}

export async function handleCustomerActivityRequest(input: {
	crm: CRMConfig | undefined;
	cors: Readonly<Record<string, string>>;
	getUser: () => Promise<CustomerActivityUser | null>;
	/** Keeps the user's time zone, for the usage digests' send times. */
	saveTimeZone: (userId: string, timeZone: string) => Promise<void>;
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
	const timeZone = await requestTimeZone(input.request);
	if (timeZone)
		await input.saveTimeZone(user.id, timeZone).catch((error: unknown) => {
			logger.error("Failed to save the time zone of {userId}: {error}", {
				error,
				userId: user.id,
			});
		});
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
