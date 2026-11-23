import { Skeleton } from "@/app/ui/skeleton";
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
		return <Skeleton className="size-6 shrink-0 corner-full" />;
	}
	return (
		<ModelChip
			chip={cn("size-6", (flat || shadowless) && "drop-shadow-none")}
			glyph="size-3.5"
			model={model}
			solid={solid}
		/>
	);
}
