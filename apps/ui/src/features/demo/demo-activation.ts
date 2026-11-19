// Shared by the tiny boot listener and the lazily loaded React app.
// Preparing the app must not activate it or start live-data requests.
let active = false;
const listeners = new Set<() => void>();

export function getDemoActive() {
	return active;
}

export function getDemoServerActive() {
	return false;
}

export function subscribeDemoActive(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function setDemoActive(value: boolean) {
	if (active === value) return;
	active = value;
	for (const listener of listeners) listener();
}

export function waitForDemoActivation(signal: AbortSignal | null | undefined) {
	if (active) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			unsubscribe();
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			cleanup();
			reject(signal?.reason);
		};
		const unsubscribe = subscribeDemoActive(() => {
			if (!active) return;
			cleanup();
			resolve();
		});
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
	});
}
