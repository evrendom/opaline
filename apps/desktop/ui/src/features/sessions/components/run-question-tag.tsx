import type { SessionRunQuestionTag } from "@rudel/api-routes";
import { IconMessageQuestion } from "@tabler/icons-react";
import { CONVERSATION_TRACE_TAG_CLASS_NAME } from "@/components/conversation/conversation-trace-tag";
import {
	runQuestionTagLabel,
	runQuestionTagTitle,
} from "@/features/sessions/run-question-tags";
import { cn } from "@/lib/utils";

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
		<span
			className={cn(CONVERSATION_TRACE_TAG_CLASS_NAME, className)}
			data-session-overview-question-tag
			data-trace-tag-context="run-question"
			title={`${runQuestionTagTitle(tag)}${tag.runs > 1 ? ` · ${tag.runs} runs` : ""}`}
		>
			<IconMessageQuestion
				aria-hidden="true"
				className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
			/>
			<span className="truncate font-sans">{runQuestionTagLabel(tag)}</span>
			{tag.runs > 1 ? (
				<span className="shrink-0 font-normal text-[#8d8d8d] tabular-nums dark:text-[#8c8c8c]">
					×{tag.runs}
				</span>
			) : null}
		</span>
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
			className="flex min-w-0 max-w-full shrink-0 items-center gap-1"
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
					className="shrink-0 whitespace-nowrap text-[0.625rem] font-normal text-(--session-overview-subtle)"
					data-session-overview-question-overflow-tag
					title={hidden.map((tag) => tag.label ?? tag.question).join(", ")}
				>
					+{hidden.length}
				</span>
			) : null}
		</div>
	);
}
