const ACTIVITY_STORAGE_PREFIX = "opaline.customer_activity";
const inFlightUsers = new Set<string>();

export async function recordDailyCustomerActivity(
	userId: string,
): Promise<void> {
	if (
		typeof window === "undefined" ||
		import.meta.env.MODE === "plugin" ||
		inFlightUsers.has(userId)
	)
		return;
	const day = new Date().toISOString().slice(0, 10);
	const storageKey = `${ACTIVITY_STORAGE_PREFIX}:${userId}`;
	try {
		if (window.localStorage.getItem(storageKey) === day) return;
	} catch {
		// Continue without local deduplication when storage is unavailable.
	}

	inFlightUsers.add(userId);
	try {
		const response = await fetch("/api/customer-activity", {
			credentials: "include",
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// The usage digests go out at 09:00 in this time zone.
			body: JSON.stringify({
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			}),
		});
		if (!response.ok) return;
		try {
			window.localStorage.setItem(storageKey, day);
		} catch {
			// The heartbeat succeeded; storage is only an optimization.
		}
	} catch {
		// Customer activity is best-effort and must not affect the dashboard.
	} finally {
		inFlightUsers.delete(userId);
	}
}
