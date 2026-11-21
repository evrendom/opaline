import {
	IconArrowsDiagonal,
	IconArrowsDiagonalMinimize2,
	IconBraces,
} from "@tabler/icons-react";

const TOGGLE =
	// design-escape-ok(opacity): no role renders this; text-ink-3/60
	"inline-flex shrink-0 items-center justify-center corner-xs p-xs text-ink-3/60 transition-colors outline-none hover:text-ink aria-pressed:text-ink";

export function StepHeadToggles({
	expanded,
	onExpand,
	onRaw,
	raw,
}: {
	expanded: boolean;
	onExpand?: (expanded: boolean) => void;
	onRaw: () => void;
	raw: boolean;
}) {
	return (
		<>
			{onExpand ? (
				<button
					type="button"
					aria-label="Expand"
					aria-pressed={expanded}
					title={expanded ? "Show the run again" : "Expand the step"}
					className={TOGGLE}
					onClick={() => onExpand(!expanded)}
				>
					{expanded ? (
						<IconArrowsDiagonalMinimize2
							aria-hidden="true"
							className="size-4"
						/>
					) : (
						<IconArrowsDiagonal aria-hidden="true" className="size-4" />
					)}
				</button>
			) : null}
			<button
				type="button"
				aria-label="Raw"
				aria-pressed={raw}
				title={raw ? "Show the overview" : "Show the raw step"}
				className={TOGGLE}
				onClick={onRaw}
			>
				<IconBraces aria-hidden="true" className="size-4" />
			</button>
		</>
	);
}
