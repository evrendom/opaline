import { ORPCError } from "@orpc/server";
import { splitL1NodeId } from "../services/l1-edges/l1-edge-ids.js";
import { classifyOpalineUrl, pastedUrlHint } from "./app-links.js";

type Args = Record<string, unknown>;

export const RUN_URL_INPUT = {
	type: "string",
	description:
		"Instead of id: an Opaline link the user pasted (https://opaline.so/…). A session link with its run (?turn=…) opens that run; a session link without one, the session list or the dashboard returns the call that opens it, keeping the link's dates.",
};

export function runFromUrl(
	url: unknown,
	args: Args,
): { hint: string | null; args: Args } {
	if (url === undefined || url === null || url === "")
		return { hint: null, args };
	if (typeof url !== "string")
		throw new ORPCError("BAD_REQUEST", { message: "url must be a link" });
	if (args.id !== undefined)
		throw new ORPCError("BAD_REQUEST", {
			message: "Give id or url, not both",
		});
	const pasted = classifyOpalineUrl(url);
	if (!pasted)
		throw new ORPCError("BAD_REQUEST", {
			message: `url is not an Opaline link (https://opaline.so/…): ${url.slice(0, 200)}`,
		});
	if (pasted.kind === "session" && pasted.record)
		return { hint: null, args: { ...args, id: pasted.record } };
	return { hint: pastedUrlHint(pasted), args };
}

export function sessionOfRunId(id: string): string | null {
	try {
		const parts = splitL1NodeId(id);
		return parts.length === 5 && parts[2] ? parts[2] : null;
	} catch {
		return null;
	}
}
