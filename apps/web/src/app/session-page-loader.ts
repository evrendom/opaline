let pending:
	| Promise<typeof import("@/features/sessions/sessions-page")>
	| undefined;

export function loadSessionsPage() {
	pending ??= import("@/features/sessions/sessions-page").catch(
		(error: unknown) => {
			pending = undefined;
			throw error;
		},
	);
	return pending;
}
