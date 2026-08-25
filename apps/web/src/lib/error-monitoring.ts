let initializationStarted = false;

export function initErrorMonitoring() {
	const dsn = (import.meta.env.VITE_SENTRY_DSN ?? "").trim();
	if (
		typeof window === "undefined" ||
		dsn.length === 0 ||
		initializationStarted
	) {
		return;
	}

	initializationStarted = true;
	void import("@sentry/browser")
		.then(({ init }) => {
			init({ dsn });
		})
		.catch(() => {
			initializationStarted = false;
		});
}
