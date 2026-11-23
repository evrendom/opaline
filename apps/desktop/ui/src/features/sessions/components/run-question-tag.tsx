import type { SessionRunQuestionTag } from "@rudel/api-routes";
import { IconMessageQuestion } from "@tabler/icons-react";
import { Tag } from "@/app/ui/tag";
import {
	runQuestionTagLabel,
	runQuestionTagTitle,
} from "@/features/sessions/run-question-tags";

// A run question answered yes, as a tag in the sessions list: the question's
// short name, and on how many of the session's runs the answer was yes. The
// wording and how sure the answer is are in the title.

export function RunQuestionTag({
	className,
	tag,
}: {
	className?: string;
	tag: SessionRunQuestionTag;
}) {
	return (
		<Tag
			size="md"
			data-session-overview-question-tag
			data-trace-tag-context="run-question"
			title={`${runQuestionTagTitle(tag)}${tag.runs > 1 ? ` · ${tag.runs} runs` : ""}`}
			className={className}
		>
			<IconMessageQuestion aria-hidden="true" className="text-warning" />
			<span className="truncate">{runQuestionTagLabel(tag)}</span>
			{tag.runs > 1 ? (
				<span className="shrink-0 text-ink-3">×{tag.runs}</span>
			) : null}
		</Tag>
	);
}

/** Question tags shown in a row; the rest are counted. */
const MAX_SESSION_OVERVIEW_QUESTION_TAGS = 2;

/** What run questions found in a session, before its skills: a tag per
 * question answered yes, the rest counted with their names in the title. */
export function SessionOverviewQuestionTags({
	tags,
}: {
	tags: readonly SessionRunQuestionTag[];
}) {
	const rendered = tags.slice(0, MAX_SESSION_OVERVIEW_QUESTION_TAGS);
	const hidden = tags.slice(MAX_SESSION_OVERVIEW_QUESTION_TAGS);
	return (
		<div
			className="flex min-w-0 max-w-full shrink-0 items-center gap-xs"
			data-session-overview-question-tags
		>
			{rendered.map((tag) => (
				<RunQuestionTag
					key={tag.id}
					className="min-w-0 max-w-52 shrink"
					tag={tag}
				/>
			))}
			{hidden.length > 0 ? (
				<span
					className="shrink-0 whitespace-nowrap text-body-xs font-regular text-ink-3"
					data-session-overview-question-overflow-tag
					title={hidden.map((tag) => tag.label ?? tag.question).join(", ")}
				>
					+{hidden.length}
				</span>
			) : null}
		</div>
	);
}
