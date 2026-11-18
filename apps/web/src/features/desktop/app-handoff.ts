import { SELF_HOST_INFO_PATH } from "@/features/self-hosted/self-host-info";
import { getApiBaseUrl } from "@/lib/api-base-url";

const DESKTOP_APP_TOKEN = "OpalineDesktop/";
const INFO_TIMEOUT_MS = 3_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface HandoffPage {
	readonly userAgent: string;
	readonly hasDesktopBridge: boolean;
	readonly hostname: string;
	readonly pathname: string;
	readonly search: string;
	readonly hash: string;
}

export function isDesktopAppWindow(
	page: Pick<HandoffPage, "userAgent" | "hasDesktopBridge">,
): boolean {
	return page.hasDesktopBridge || page.userAgent.includes(DESKTOP_APP_TOKEN);
}

export function mayHandOff(page: HandoffPage): boolean {
	return !isDesktopAppWindow(page) && LOOPBACK_HOSTS.has(page.hostname);
}

export function desktopAppLink(
	page: Pick<HandoffPage, "pathname" | "search" | "hash">,
): string {
	return `opaline://${page.pathname.replace(/^\/+/u, "")}${page.search}${page.hash}`;
}

export function currentHandoffPage(): HandoffPage {
	return {
		userAgent: navigator.userAgent,
		hasDesktopBridge: "opalineDesktop" in window,
		hostname: window.location.hostname,
		pathname: window.location.pathname,
		search: window.location.search,
		hash: window.location.hash,
	};
}

type FetchInfo = (url: URL, init: RequestInit) => Promise<Response>;

export async function serverHasDesktopApp(
	fetchImpl: FetchInfo = (url, init) => fetch(url, init),
	apiBaseUrl: string = getApiBaseUrl(),
): Promise<boolean> {
	try {
		const response = await fetchImpl(new URL(SELF_HOST_INFO_PATH, apiBaseUrl), {
			credentials: "omit",
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
		});
		if (!response.ok) return false;
		const info: unknown = await response.json();
		return (
			typeof info === "object" &&
			info !== null &&
			"desktopApp" in info &&
			info.desktopApp === true
		);
	} catch {
		return false;
	}
}
