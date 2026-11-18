export function isAuthorizedCronRequest(
	request: Request,
	secret: string | undefined = process.env.CRON_SECRET,
): boolean {
	const normalizedSecret = secret?.trim();
	return (
		normalizedSecret !== undefined &&
		normalizedSecret.length >= 16 &&
		request.headers.get("Authorization") === `Bearer ${normalizedSecret}`
	);
}
