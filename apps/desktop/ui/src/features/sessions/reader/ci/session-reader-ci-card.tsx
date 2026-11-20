import { GitHubLink } from "./session-reader-ci-link";
import { pullRequestUrl } from "./session-reader-run-ci";

export function UnknownPullCard({ pickKey }: { pickKey: string }) {
	const match = pickKey.match(/^(.*)#(\d+)$/);
	const repository = match?.[1] ?? "";
	const number = Number(match?.[2]);
	return (
		<div className="flex flex-col gap-s px-xxl py-xl">
			<div className="flex items-center gap-m">
				<h2 className="text-body-xl font-medium">{pickKey}</h2>
				{repository && Number.isFinite(number) ? (
					<GitHubLink
						href={pullRequestUrl(repository, number)}
						label="Open it on GitHub"
					/>
				) : null}
			</div>
			<p className="text-body-m text-ink-3">
				Not one of this session's pull requests: Opaline has no CI of it for
				this session.
			</p>
		</div>
	);
}
