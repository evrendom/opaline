export const LIVE_DEMO_ORGANIZATION_ID = "1zKtWzbRInKT6uNOqgXdcEGinGo2rXuW";
export const LIVE_DEMO_DESTINATION = "/home#demo";

export async function openLiveDemo(): Promise<void> {
	window.location.assign(LIVE_DEMO_DESTINATION);
}

export async function ensureLiveDemoSession(): Promise<void> {
	const response = await fetch("/api/demo/auth/get-session", {
		credentials: "omit",
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error("The demo could not connect.");
}
