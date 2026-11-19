export function readRepositoryEvidenceCapturePauseSeconds(
	environment: Record<string, string | undefined> = process.env,
): number | undefined {
	if (environment.REPOSITORY_EVIDENCE_CAPTURE_ENABLED !== "false")
		return undefined;
	const value = environment.REPOSITORY_EVIDENCE_CAPTURE_PAUSE_SECONDS;
	const seconds = value?.trim() ? Number(value) : Number.NaN;
	return Number.isFinite(seconds)
		? Math.min(604_800, Math.max(3_600, Math.floor(seconds)))
		: 86_400;
}
