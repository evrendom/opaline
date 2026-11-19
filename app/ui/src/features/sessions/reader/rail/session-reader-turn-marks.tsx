import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	type Icon,
	IconAlertTriangle,
	IconBolt,
	IconFileMinus,
	IconFilePlus,
	IconPencil,
	IconThumbUp,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { SessionReaderBodyState } from "../detail/use-session-reader-bodies";
import { OpalChip } from "../detail/waterfall/session-reader-waterfall-chips";
import {
	getReaderTurnMarks,
	type SessionReaderTurnMark,
	type SessionReaderTurnMarkKind,
	type SessionReaderTurnSignal,
} from "../model/session-reader-model";

// how the turn went (its signals) and what it touched — a skill, files added,
// edited or removed.

export const TURN_MARKS: Record<
	SessionReaderTurnMarkKind,
	{ className: string; Icon: Icon; label: string; tint: string }
> = {
	"file-added": {
		className: "text-emerald-600 dark:text-emerald-400",
		Icon: IconFilePlus,
		label: "Added",
		tint: "var(--color-emerald-500)",
	},
	"file-edited": {
		className: "text-blue-600 dark:text-blue-400",
		Icon: IconPencil,
		label: "Edited",
		tint: "var(--color-blue-500)",
	},
	"file-removed": {
		className: "text-rose-600 dark:text-rose-400",
		Icon: IconFileMinus,
		label: "Removed",
		tint: "var(--color-rose-500)",
	},
	skill: {
		className: "text-amber-600 dark:text-amber-400",
		Icon: IconBolt,
		label: "Skill",
		tint: "var(--color-amber-500)",
	},
};

/** Names listed in a mark's tooltip before it says "and N more". */
const TOOLTIP_ITEM_LIMIT = 8;

function markTitle(label: string, items: readonly string[]): string {
	const names = items
		.slice(0, TOOLTIP_ITEM_LIMIT)
		.map((item) => item.split("/").at(-1) ?? item);
	const more = items.length - names.length;
	return `${label}: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

type StackMark = {
	className: string;
	Icon: Icon;
	key: string;
	tint: string;
	title: string;
};

/** Small Opaline chips that overlap like a stack, each tucked 4px under the
 * one before it, with what it means on hover. */
function MarkStack({ marks }: { marks: readonly StackMark[] }) {
	if (marks.length === 0) return null;
	return (
		<span className="flex shrink-0 items-center">
			{marks.map((mark, index) => (
				<span
					key={mark.key}
					className={cn("relative flex", index > 0 && "-ml-1")}
					style={{ zIndex: marks.length - index }}
				>
					<OpalChip
						solid
						tint={mark.tint}
						title={mark.title}
						className={cn("size-4", mark.className)}
					>
						<mark.Icon aria-hidden="true" className="size-2.5" />
					</OpalChip>
				</span>
			))}
		</span>
	);
}

const SIGNAL_MARKS: Record<SessionReaderTurnSignal, Omit<StackMark, "key">> = {
	apology: {
		className: "text-amber-600 dark:text-amber-400",
		Icon: IconAlertTriangle,
		tint: "var(--color-amber-500)",
		title: "Apology",
	},
	positive: {
		className: "text-emerald-600 dark:text-emerald-400",
		Icon: IconThumbUp,
		tint: "var(--color-emerald-500)",
		title: "Positive signal",
	},
	trouble: {
		className: "text-rose-600 dark:text-rose-400",
		Icon: IconAlertTriangle,
		tint: "var(--color-rose-500)",
		title: "Error or negative signal",
	},
};

/**
 * One stack of chips for the turn: how it went first — a red warning for
 * errors or negative user language, a yellow one for an apology, a thumbs-up
 * for positive language — then what it touched: a skill used, files added,
 * edited or removed, with the names on hover.
 */
export function TurnRailMarks({
	bodyState,
	signals,
	turn,
}: {
	bodyState: SessionReaderBodyState;
	signals: readonly SessionReaderTurnSignal[];
	turn: Pick<SessionDetailTurnSummary, "editedFiles" | "fileEvents" | "skills">;
}) {
	const touched = getReaderTurnMarks(
		turn,
		bodyState.status === "ready" ? bodyState.body : null,
	);
	return (
		<MarkStack
			marks={[
				...signals.map((signal) => ({ ...SIGNAL_MARKS[signal], key: signal })),
				...touched.map((mark) => {
					const { label, ...look } = TURN_MARKS[mark.kind];
					return {
						...look,
						key: mark.kind,
						title: markTitle(label, mark.items),
					};
				}),
			]}
		/>
	);
}

/** What a run touched, as tags in the run row's own style — each category's
 * icon on its rail-mark pebble and how many skills or files it covers — with
 * the names on hover. */
export function RunTouchTags({
	marks,
}: {
	marks: readonly SessionReaderTurnMark[];
}) {
	return marks.map((mark) => {
		const { className, Icon, label, tint } = TURN_MARKS[mark.kind];
		return (
			<span
				key={mark.kind}
				title={markTitle(label, mark.items)}
				className="inline-flex h-5 items-center gap-1 rounded-full bg-background pr-2 pl-0.5 text-foreground/80 tabular-nums shadow-(--custom-outline-shadow) dark:bg-card"
			>
				<OpalChip tint={tint} className={cn("size-4", className)}>
					<Icon aria-hidden="true" className="size-2.5" />
				</OpalChip>
				{mark.items.length}
			</span>
		);
	});
}
