import { z } from "zod";

export const PullRequestCiSchema = z.enum([
	"failed",
	"passed",
	"noCi",
	"unavailable",
]);
export const CiConclusionSchema = z.enum([
	"success",
	"failure",
	"timedOut",
	"cancelled",
	"skipped",
	"actionRequired",
	"neutral",
	"inProgress",
]);
export const PULL_REQUEST_CI = [
	{ id: "failed", label: "Had CI failures" },
	{ id: "passed", label: "No CI failures" },
	{ id: "noCi", label: "No CI runs" },
	{ id: "unavailable", label: "CI history unavailable" },
] as const;
export const CI_RUN_CONCLUSIONS = [
	{ id: "success", label: "Success" },
	{ id: "failure", label: "Failure" },
	{ id: "timedOut", label: "Timed out" },
	{ id: "cancelled", label: "Cancelled" },
	{ id: "skipped", label: "Skipped" },
	{ id: "actionRequired", label: "Action required" },
	{ id: "neutral", label: "Neutral" },
	{ id: "inProgress", label: "In progress" },
] as const;
export const CI_EVENT_LABELS: Readonly<Record<string, string>> = {
	pull_request: "Pull request",
	push: "Push",
	schedule: "Schedule",
	workflow_dispatch: "Manual",
	merge_group: "Merge queue",
	pull_request_target: "Pull request target",
	release: "Release",
};
export const GITHUB_INACTIVE_FILTER_TOOLTIP =
	"Merged PRs and CI runs include every pull request and run, so member and model filters don't apply here yet. They still filter cost, sessions, agent runs and signals.";
export const GITHUB_RETENTION_TOOLTIP =
	"GitHub deletes workflow runs and checks after each repository's Actions retention period (90 days by default). PRs whose CI history was already gone are left out of CI failures / PR. They aren't counted as passing.";
