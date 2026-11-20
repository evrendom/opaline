import { OpalChip } from "../reader/detail/waterfall/session-reader-waterfall-chips";
import { LANE_LOOK } from "../reader/model/session-reader-step-lanes";

const AgentGlyph = LANE_LOOK.agent.glyph;

export function SubagentPebble({
	small = false,
	tint,
}: {
	small?: boolean;
	tint?: string;
}) {
	return (
		<OpalChip
			solid
			tint={tint ?? LANE_LOOK.agent.tint}
			className={`${small ? "size-3.5" : "size-5"} text-[color-mix(in_oklab,var(--opal-tint)_80%,black)] drop-shadow-none dark:text-[color-mix(in_oklch,var(--opal-tint)_75%,white)] dark:drop-shadow-none [--opal-ring:color-mix(in_oklab,var(--opal-tint)_20%,var(--canvas))] dark:[--opal-ring:color-mix(in_oklab,var(--opal-tint)_30%,var(--canvas))]`}
		>
			<AgentGlyph
				aria-hidden="true"
				className={small ? "size-2.5" : "size-3"}
			/>
		</OpalChip>
	);
}
