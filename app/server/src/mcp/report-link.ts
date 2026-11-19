import { appUrl } from "./app-links.js";

export function analysisReportUrl(
	workspaceSlug: string,
	analysisId: string,
): string {
	return appUrl("report", { workspaceSlug, analysisId });
}

export function withReportLink(
	text: string,
	workspaceSlug: string,
	analysisId: string,
): string {
	return `${text}\nOpen in Opaline: ${analysisReportUrl(workspaceSlug, analysisId)}`;
}
