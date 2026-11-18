import {
	IconGitCommit,
	IconGitMerge,
	IconGitPullRequest,
} from "@tabler/icons-react";
import { LANE_LOOK } from "../model/session-reader-step-lanes";
import { TagChip } from "./session-reader-rail-tags";

type GitAction = "commit" | "merge" | "pullRequest";

const GIT_MARKS: readonly {
	glyph: typeof IconGitCommit;
	key: GitAction;
	label: string;
	tint: string;
}[] = [
	{
		key: "commit",
		label: "Commits",
		glyph: IconGitCommit,
		tint: LANE_LOOK.git.tint,
	},
	{
		key: "pullRequest",
		label: "Pull requests opened",
		glyph: IconGitPullRequest,
		tint: "var(--color-green-500)",
	},
	{
		key: "merge",
		label: "Merges",
		glyph: IconGitMerge,
		tint: "var(--color-purple-500)",
	},
];

export function RailGitMarks({
	counts,
}: {
	counts: Partial<Record<GitAction, number>> | undefined;
}) {
	const shown = GIT_MARKS.flatMap((tag) => {
		const count = counts?.[tag.key] ?? 0;
		return count > 0 ? [{ count, tag }] : [];
	});
	if (shown.length === 0) return null;
	return (
		<span className="flex shrink-0 items-center -space-x-1">
			{shown.map(({ count, tag }) => (
				<TagChip
					key={tag.key}
					flat
					small
					solid
					tag={tag}
					title={`${tag.label}: ${count}`}
				/>
			))}
		</span>
	);
}
