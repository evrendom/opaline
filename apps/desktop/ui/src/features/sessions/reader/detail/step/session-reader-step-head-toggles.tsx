import {
	IconArrowsDiagonal,
	IconArrowsDiagonalMinimize2,
	IconBraces,
} from "@tabler/icons-react";
import { Button } from "@/app/ui/button";

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
				<Button
					size="icon-sm"
					type="button"
					aria-label="Expand"
					aria-pressed={expanded}
					title={expanded ? "Show the run again" : "Expand the step"}
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
				</Button>
			) : null}
			<Button
				size="icon-sm"
				type="button"
				aria-label="Raw"
				aria-pressed={raw}
				title={raw ? "Show the overview" : "Show the raw step"}
				onClick={onRaw}
			>
				<IconBraces aria-hidden="true" className="size-4" />
			</Button>
		</>
	);
}
