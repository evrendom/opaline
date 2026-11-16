import { useSelfHost } from "@/features/self-hosted/self-host-info";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalDesktopApp(
	selfHosted: boolean,
	userAgent: string,
	hostname: string,
): boolean {
	return (
		selfHosted &&
		userAgent.includes("OpalineDesktop/") &&
		LOOPBACK_HOSTS.has(hostname)
	);
}

export function useLocalDesktopApp(): boolean {
	const selfHost = useSelfHost();
	return isLocalDesktopApp(
		Boolean(selfHost),
		typeof navigator === "undefined" ? "" : navigator.userAgent,
		typeof location === "undefined" ? "" : location.hostname,
	);
}
