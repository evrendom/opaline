// Both engines support WAAPI. This isolates the workaround for WebKit's
// rendering cost rather than pretending it is a missing browser feature.
export function usesSafariDemoMotion(userAgent: string): boolean {
	return (
		userAgent.includes("AppleWebKit/") &&
		!/(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent)
	);
}
