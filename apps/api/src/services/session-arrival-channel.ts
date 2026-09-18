import { createHash } from "node:crypto";

export function sessionArrivalChannel(organizationId: string) {
	return `session_arrival_${createHash("sha256").update(organizationId).digest("hex").slice(0, 40)}`;
}
