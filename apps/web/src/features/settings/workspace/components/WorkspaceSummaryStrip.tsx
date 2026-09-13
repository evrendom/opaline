import { Skeleton } from "@/app/ui/skeleton";

export function WorkspaceSummaryStrip({
	tiles,
	isPending,
	isError,
}: {
	tiles: Array<{
		id: string;
		label: string;
		displayValue: string;
	}>;
	isPending: boolean;
	isError: boolean;
}) {
	return (
		<div className="py-8">
			<div className="flex flex-col divide-y divide-border/60">
				{tiles.map((tile) => (
					<div
						key={tile.id}
						className="flex flex-col gap-1 px-4 py-4 first:pt-0 last:pb-0"
					>
						<p className="text-sm text-muted-foreground">{tile.label}</p>
						{isPending ? (
							<Skeleton className="h-6 w-24 rounded-md" />
						) : (
							<p className="truncate text-lg font-semibold tabular-nums">
								{isError ? "—" : tile.displayValue}
							</p>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
