import type { AnalysisScope } from "@rudel/api-routes";

export function formatDay(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
				timeZone: "UTC",
			});
}

export function dataWindow(analysis: {
	scope: AnalysisScope;
	cutoff: string;
}): string {
	const { from, to } = analysis.scope;
	if (from && to) return `Data ${from} to ${to}`;
	if (from) return `Data from ${from}`;
	if (to) return `Data to ${to}`;
	return `Data through ${formatDay(analysis.cutoff)}`;
}
