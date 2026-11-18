import { z } from "zod";

// Released CLI versions are plain x.y.z; anything else (dev builds, junk) is ignored.
const CLI_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/u;

export const CLI_UPDATE_COMMAND = "npx opaline@latest update";

const CliVersionSchema = z.string().regex(CLI_VERSION_PATTERN);

export const CliUpdateStatusSchema = z.object({
	installedVersion: CliVersionSchema.nullable(),
	latestVersion: CliVersionSchema.nullable(),
	outdated: z.boolean(),
});

export type CliUpdateStatus = z.infer<typeof CliUpdateStatusSchema>;

export function parseCliVersion(value: unknown): string | null {
	return typeof value === "string" && CLI_VERSION_PATTERN.test(value)
		? value
		: null;
}

export function isCliVersionOlder(installed: string, latest: string): boolean {
	const a = installed.split(".").map(Number);
	const b = latest.split(".").map(Number);
	for (let index = 0; index < 3; index += 1) {
		if (a[index] !== b[index]) return (a[index] ?? 0) < (b[index] ?? 0);
	}
	return false;
}

export function getCliReleaseUrl(version: string): string {
	return `https://github.com/evrendom/opaline/releases/tag/${encodeURIComponent(`opaline-cli@${version}`)}`;
}
