interface SessionOpenStart {
	sessionId: string;
	startedAt: number;
	startSource: "navigation" | "mount";
}

let pendingNavigation: SessionOpenStart | undefined;

export function markSessionOpen(sessionId: string): void {
	pendingNavigation = {
		sessionId,
		startedAt: performance.now(),
		startSource: "navigation",
	};
}

export function markSessionOpenFromClick(
	sessionId: string,
	isActive: boolean,
	event: Pick<
		MouseEvent,
		| "button"
		| "metaKey"
		| "ctrlKey"
		| "altKey"
		| "shiftKey"
		| "defaultPrevented"
	>,
): void {
	if (
		!isActive &&
		event.button === 0 &&
		!event.defaultPrevented &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		!event.shiftKey
	) {
		markSessionOpen(sessionId);
	}
}

export function readSessionOpenStart(sessionId: string): SessionOpenStart {
	const now = performance.now();
	if (
		pendingNavigation?.sessionId === sessionId &&
		now - pendingNavigation.startedAt < 60_000
	) {
		return pendingNavigation;
	}
	return { sessionId, startedAt: now, startSource: "mount" };
}

export function clearSessionOpenStart(start: SessionOpenStart): void {
	if (pendingNavigation === start) pendingNavigation = undefined;
}

export function elapsedMilliseconds(
	startedAt: number,
	endedAt: number,
): number {
	return Math.max(0, Math.round(endedAt - startedAt));
}
