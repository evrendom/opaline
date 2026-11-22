import type { SessionPullRequest } from "@rudel/api-routes";
import {
	type Icon,
	IconCircleCheck,
	IconCircleDashed,
	IconCircleX,
	IconGitMerge,
	IconGitPullRequest,
	IconGitPullRequestClosed,
	IconGitPullRequestDraft,
} from "@tabler/icons-react";
import {
	CiViewLink,
	ciRunPicks,
	GitHubLink,
} from "../ci/session-reader-ci-link";
import { ciRunUrl, pullRequestUrl } from "../ci/session-reader-run-ci";
import { pullRequestKey, useSessionPlaces } from "../session-places";
import {
	Empty,
	Glyph,
	Meta,
	type OpenPlace,
	Pending,
	PlaceLink,
	Row,
	ShortList,
} from "./session-reader-summary-sections";
import type { SummaryCiRun } from "./session-summary-model";

export function pullRequestLook(pull: SessionPullRequest): {
	className: string;
	icon: Icon;
	label: string;
} {
	if (pull.mergedAt)
		return {
			// design-escape-ok(colour): data paint; GitHub's merged purple
			className: "text-violet-500",
			icon: IconGitMerge,
			label: "Merged",
		};
	if (pull.state === "closed")
		return {
			className: "text-error",
			icon: IconGitPullRequestClosed,
			label: "Closed",
		};
	if (pull.draft)
		return { className: "", icon: IconGitPullRequestDraft, label: "Draft" };
	if (pull.state === "open")
		return {
			className: "text-success",
			icon: IconGitPullRequest,
			label: "Open",
		};
	return { className: "", icon: IconGitPullRequest, label: "Not synced" };
}

export function SummaryPullRequests({
	pullRequests,
}: {
	pullRequests: readonly SessionPullRequest[] | undefined;
}) {
	const places = useSessionPlaces();
	if (!pullRequests) return <Pending />;
	if (pullRequests.length === 0) return <Empty>No pull requests linked.</Empty>;
	return (
		<ShortList
			items={pullRequests}
			fill
			onShowAll={places ? () => places.openCi({}) : undefined}
			render={(pull) => {
				const look = pullRequestLook(pull);
				return (
					<Row key={`${pull.repository}#${pull.number}`}>
						<span title={look.label} className="shrink-0">
							<Glyph icon={look.icon} className={look.className} />
						</span>
						<CiViewLink
							github={
								pull.repository
									? pullRequestUrl(pull.repository, pull.number)
									: null
							}
							picks={{ pr: pullRequestKey(pull.repository, pull.number) }}
							title={pull.title ?? undefined}
							className="min-w-0 flex-1 truncate hover:underline"
						>
							{pull.title ?? `Pull request #${pull.number}`}
						</CiViewLink>
						<Meta>
							#{pull.number}
							{pull.repository ? ` · ${pull.repository.split("/").at(-1)}` : ""}
						</Meta>
						{pull.repository ? (
							<GitHubLink
								href={pullRequestUrl(pull.repository, pull.number)}
								label={`Open #${pull.number} on GitHub`}
							/>
						) : null}
					</Row>
				);
			}}
		/>
	);
}

export function ciLook(conclusion: string | null): {
	className: string;
	icon: Icon;
} {
	if (conclusion === null)
		return { className: "text-warning", icon: IconCircleDashed };
	if (conclusion === "success")
		return { className: "text-success", icon: IconCircleCheck };
	if (conclusion === "failure" || conclusion === "timed_out")
		return { className: "text-error", icon: IconCircleX };
	return { className: "", icon: IconCircleDashed };
}

export function SummaryCi({
	ci,
	onOpen,
}: {
	ci: readonly SummaryCiRun[];
	onOpen: OpenPlace;
}) {
	const places = useSessionPlaces();
	if (ci.length === 0) return <Empty>No CI linked.</Empty>;
	return (
		<ShortList
			items={ci}
			fill
			onShowAll={places ? () => places.openCi({}) : undefined}
			render={(run) => {
				const look = ciLook(run.conclusion);
				const github = ciRunUrl(run);
				const failed = run.jobs.filter(
					(job) =>
						job.conclusion === "failure" || job.conclusion === "timed_out",
				).length;
				return (
					<Row key={run.ciRunId}>
						<span title={run.conclusion ?? "Running"} className="shrink-0">
							<Glyph icon={look.icon} className={look.className} />
						</span>
						<CiViewLink
							github={github}
							picks={ciRunPicks(run)}
							className="min-w-0 flex-1 truncate hover:underline"
						>
							{run.workflowName || "Workflow"}
							<span className="ml-s text-body-m text-ink-3">
								{run.headBranch}
								{run.headSha ? ` @${run.headSha.slice(0, 7)}` : ""}
							</span>
						</CiViewLink>
						<Meta>
							{failed > 0
								? `${failed} of ${run.jobs.length} job${run.jobs.length === 1 ? "" : "s"} failed`
								: `${run.jobs.length} job${run.jobs.length === 1 ? "" : "s"}`}
							{run.link === "pr_window" ? " · on the PR meanwhile" : ""}
						</Meta>
						<PlaceLink onOpen={onOpen} places={run.places} />
						{github ? (
							<GitHubLink href={github} label="Open the run on GitHub" />
						) : null}
					</Row>
				);
			}}
		/>
	);
}
