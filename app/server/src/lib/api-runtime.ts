export function isVercelRuntime(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return environment.VERCEL === "1";
}
