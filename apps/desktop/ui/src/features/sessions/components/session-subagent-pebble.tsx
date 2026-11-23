import { OpalChip } from "../reader/detail/waterfall/session-reader-waterfall-chips";
import { LANE_LOOK } from "../reader/model/session-reader-step-lanes";

const AgentGlyph = LANE_LOOK.agent.glyph;

// The pebble's glyph darkens its tint in light and lightens it in dark, and
// its ring mixes in a little more tint on the dark canvas.
const SUBAGENT_PEBBLE_TINT_CLASS_NAME =
	// design-escape-ok(dark): artwork; the opal pebble's glyph and ring tints per mode
	"text-[color-mix(in_oklab,var(--opal-tint)_80%,black)] drop-shadow-none dark:text-[color-mix(in_oklch,var(--opal-tint)_75%,white)] [--opal-ring:color-mix(in_oklab,var(--opal-tint)_20%,var(--canvas))] dark:[--opal-ring:color-mix(in_oklab,var(--opal-tint)_30%,var(--canvas))]";

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
			className={`${small ? "size-3.5" : "size-5"} ${SUBAGENT_PEBBLE_TINT_CLASS_NAME}`}
		>
			<AgentGlyph
				aria-hidden="true"
				className={small ? "size-2.5" : "size-3"}
			/>
		</OpalChip>
	);
}
