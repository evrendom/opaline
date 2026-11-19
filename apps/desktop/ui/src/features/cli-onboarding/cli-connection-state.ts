import type { CliConnectionSnapshot } from "../../../../../../packages/api-routes/src/cli-connection";

export type CliConnectionTone = "pending" | "connected" | "interrupted";

export function getCliConnectionTone(
	snapshot: CliConnectionSnapshot | null,
	inactive: boolean,
	error: string | null,
): CliConnectionTone {
	if (
		inactive ||
		error ||
		(snapshot && ["failed", "cancelled", "expired"].includes(snapshot.state))
	)
		return "interrupted";
	if (snapshot && ["ready", "uploading", "completed"].includes(snapshot.state))
		return "connected";
	return "pending";
}
