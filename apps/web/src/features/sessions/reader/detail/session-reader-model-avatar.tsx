import { OpalineShape } from "@/features/shell/components/shell-nav-icon";
import { cn } from "@/lib/utils";
import { ModelChip } from "./waterfall/session-reader-waterfall-chips";

export function ModelAvatar({
	flat = false,
	loading,
	model,
	shadowless = false,
	solid = false,
}: {
	shadowless?: boolean;
	flat?: boolean;
	loading: boolean;
	model: string | null;
	solid?: boolean;
}) {
	if (loading) {
		return (
			<span className="relative size-6 shrink-0 animate-pulse [--opal-fill:var(--muted)] [--opal-ring:transparent]">
				<OpalineShape className="absolute inset-0" />
			</span>
		);
	}
	return (
		<ModelChip
			chip={cn(
				"size-6",
				(flat || shadowless) && "drop-shadow-none dark:drop-shadow-none",
			)}
			glyph="size-3.5"
			model={model}
			solid={solid}
		/>
	);
}
