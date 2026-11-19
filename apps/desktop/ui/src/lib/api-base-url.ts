export function getApiBaseUrl() {
	const configuredUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
	return configuredUrl.length > 0
		? configuredUrl
		: typeof window === "undefined"
			? "https://opaline.so"
			: window.location.origin;
}
