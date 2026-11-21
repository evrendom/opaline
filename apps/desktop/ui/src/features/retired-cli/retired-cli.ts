export const RETIRED_CLI_PATH = "/api/selfhost/retired-cli";
export const REMOVE_RETIRED_CLI_PATH = "/api/selfhost/retired-cli/remove";
// "Not now" lasts until the app quits: sessionStorage ends with the window.
export const RETIRED_CLI_DISMISSED_KEY = "opaline:retired-cli-dismissed";

export interface RetiredCliRemoval {
	readonly removed: string[];
	readonly skipped: string[];
	readonly busy: boolean;
	readonly present: boolean;
}

/** False whenever the server cannot say: the banner only shows on a clear yes. */
export async function fetchRetiredCliPresent(
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const response = await fetch(RETIRED_CLI_PATH, {
			credentials: "include",
			headers: { accept: "application/json" },
			signal,
		});
		if (!response.ok) return false;
		const body = (await response.json()) as { present?: unknown };
		return body.present === true;
	} catch {
		return false;
	}
}

export async function removeRetiredCli(): Promise<RetiredCliRemoval> {
	const response = await fetch(REMOVE_RETIRED_CLI_PATH, {
		method: "POST",
		credentials: "include",
		headers: { accept: "application/json" },
	});
	const body = (await response.json().catch(() => null)) as
		| (Partial<RetiredCliRemoval> & { message?: unknown })
		| null;
	if (!response.ok || !body || !Array.isArray(body.removed))
		throw new Error(
			typeof body?.message === "string"
				? body.message
				: "Opaline could not remove the retired CLI. Try again.",
		);
	return {
		removed: body.removed,
		skipped: Array.isArray(body.skipped) ? body.skipped : [],
		busy: body.busy === true,
		present: body.present === true,
	};
}

export function readRetiredCliDismissed(): boolean {
	try {
		return window.sessionStorage.getItem(RETIRED_CLI_DISMISSED_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeRetiredCliDismissed(): void {
	try {
		window.sessionStorage.setItem(RETIRED_CLI_DISMISSED_KEY, "1");
	} catch {
		// Blocked storage: the dismissal lasts for this page load.
	}
}
