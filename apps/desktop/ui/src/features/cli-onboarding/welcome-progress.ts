import { z } from "zod";
import type { CliConnectionSnapshot } from "../../../../../../packages/api-routes/src/cli-connection";

const ProgressSchema = z.object({
	step: z.enum(["workspace", "github", "profile", "invite", "done"]),
	organizationId: z.string().nullable(),
	github: z.enum(["pending", "connected", "skipped"]).default("pending"),
});
export type WelcomeSetupProgress = z.infer<typeof ProgressSchema>;

export function readWelcomeProgress(
	key: string,
	snapshot: CliConnectionSnapshot,
): WelcomeSetupProgress {
	try {
		const parsed = ProgressSchema.safeParse(
			JSON.parse(localStorage.getItem(key) ?? "null"),
		);
		if (parsed.success) return parsed.data;
	} catch {}
	return {
		step:
			snapshot.organizationId && snapshot.state !== "awaiting_login"
				? "profile"
				: "workspace",
		organizationId:
			snapshot.state === "awaiting_login" ? null : snapshot.organizationId,
		github: "pending",
	};
}

export function writeWelcomeProgress(
	key: string,
	progress: WelcomeSetupProgress,
): void {
	try {
		localStorage.setItem(key, JSON.stringify(progress));
	} catch {}
}
