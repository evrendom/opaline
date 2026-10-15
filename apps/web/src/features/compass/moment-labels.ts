import {
	COMPASS_FLAGS,
	type MomentKind,
	type MomentLayer,
} from "@rudel/api-routes";
import {
	IconAlertTriangleFilled,
	IconArrowBackUp,
	IconArrowBackUpDouble,
	IconCircleXFilled,
	IconClockFilled,
	IconCoinFilled,
	IconFold,
	IconHandStop,
	IconMoodAngryFilled,
	IconMoodSadFilled,
	IconPencilFilled,
	IconPlayerStopFilled,
	IconRepeat,
	IconSearch,
	type Icon as TablerIcon,
} from "@tabler/icons-react";
import { SERIES_COLORS } from "@/features/costs/chart-colors";

const LABELS = new Map(COMPASS_FLAGS.map((flag) => [flag.kind, flag.label]));
const color = (index: number) => SERIES_COLORS[index] ?? "";
const look = (kind: MomentKind, icon: TablerIcon, colorIndex: number) => ({
	label: LABELS.get(kind) ?? kind,
	icon,
	color: color(colorIndex),
});

/** Each flag as members read it, with its glyph and the dashboard series colour it wears. */
export const MOMENT_KINDS_APPEARANCE: Record<
	MomentKind,
	{ label: string; icon: TablerIcon; color: string }
> = {
	search_before_edit: look("search_before_edit", IconSearch, 0),
	expensive_run: look("expensive_run", IconCoinFilled, 3),
	long_run: look("long_run", IconClockFilled, 6),
	edit_churn: look("edit_churn", IconPencilFilled, 7),
	failing_streak: look("failing_streak", IconAlertTriangleFilled, 1),
	repeated_command: look("repeated_command", IconRepeat, 7),
	ci_failed: look("ci_failed", IconCircleXFilled, 1),
	git_reverted: look("git_reverted", IconArrowBackUpDouble, 4),
	denied_calls: look("denied_calls", IconHandStop, 8),
	interrupted: look("interrupted", IconPlayerStopFilled, 3),
	compaction: look("compaction", IconFold, 6),
	mid_run_redirect: look("mid_run_redirect", IconArrowBackUp, 4),
	model_apology: look("model_apology", IconMoodSadFilled, 5),
	user_frustrated: look("user_frustrated", IconMoodAngryFilled, 1),
};

/** Where a fix belongs, as members read it. */
export const MOMENT_LAYER_LABELS: Record<MomentLayer, string> = {
	navigation: "Navigation pointer",
	automated_check: "Automated check",
	reviewer_rule: "Reviewer rule",
	steering_file: "Steering file",
	tool_economy: "Tool economy",
	information_access: "Information access",
	environment_workaround: "Environment",
	prompt_spec: "Prompt spec",
	context_handoff: "Context hand-off",
	steering_timing: "Steering timing",
	task_size: "Task size",
	verification: "Verification",
	other: "Other",
};

const ENVIRONMENT_LAYERS: ReadonlySet<MomentLayer> = new Set([
	"navigation",
	"automated_check",
	"reviewer_rule",
	"steering_file",
	"tool_economy",
	"information_access",
	"environment_workaround",
]);

/** Whether a layer is about the agent's environment (else the engineer's practice). */
export function isEnvironmentLayer(layer: MomentLayer): boolean {
	return ENVIRONMENT_LAYERS.has(layer);
}

/** A layer's group, as the page names and colours it. */
export function layerGroup(layer: MomentLayer): {
	label: "Environment" | "Practice";
	color: string;
} {
	return isEnvironmentLayer(layer)
		? { label: "Environment", color: SERIES_COLORS[0] ?? "" }
		: { label: "Practice", color: SERIES_COLORS[4] ?? "" };
}
